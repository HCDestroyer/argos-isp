import { createHash, createHmac } from 'node:crypto'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import { SORTEO_ABIERTO_ID, SORTEO_BORRADOR_ID, SORTEO_CORTE_ID, SORTEO_EJECUTADO_ID, SORTEO_PUBLICADO_ID } from '~~/fixtures/sorteos/datos'
import PaginaSorteo from '~/pages/lealtad/sorteos/[id].vue'
import PaginaSorteos from '~/pages/lealtad/sorteos/index.vue'
import { esperar } from '../ayudas/esperar'

/**
 * Sorteos (A3, `contratos/lealtad.md` §7, §8 y §15.3): estados y acciones por paso, checklist legal
 * con su 422 `requisito_pendiente` legible, premios por tipo con su contrapartida al entregar y el
 * resultado verificable con `argos-sorteo-v1`.
 */

/** Copia con `node:crypto` de `apps/api/app/lealtad/sorteo_v1.ts` (la referencia del contrato). */
function sortearReferencia(s: Buffer, listaHash: string, basesHash: string, valorPublico: string, lista: { codigo: string, boletos: number }[], cuantos: number): string[] {
    const hmac = (clave: Buffer, mensaje: string) => createHmac('sha256', clave).update(mensaje, 'utf8').digest()
    const final = hmac(s, `${listaHash}${basesHash}${valorPublico}`)
    const restantes = [...lista]
    const elegidos: string[] = []
    for (let i = 0; elegidos.length < cuantos && restantes.length > 0; i++) {
        const total = BigInt(restantes.reduce((n, p) => n + p.boletos, 0))
        const r = BigInt(`0x${hmac(final, `argos-sorteo-v1:${i}`).toString('hex')}`)
        if (r >= (2n ** 256n / total) * total) {
            continue
        }
        let boleto = r % total
        const k = restantes.findIndex(p => (boleto -= BigInt(p.boletos)) < 0n)
        elegidos.push(restantes[k]?.codigo ?? '')
        restantes.splice(k, 1)
    }
    return elegidos
}

describe('sorteos · utilidades', () => {
    it('estados, acciones por estado y un estado nuevo por su nombre', () => {
        expect(estadoSorteoVisual('corte_cerrado').etiqueta).toBe('Corte cerrado')
        expect(estadoSorteoVisual('acta_cerrada').etiqueta).toBe('Acta cerrada')
        expect(accionesSorteo('borrador')).toEqual(['editar', 'publicar_bases', 'cancelar'])
        expect(accionesSorteo('corte_cerrado')).toEqual(['ejecutar', 'cancelar'])
        expect(accionesSorteo('ejecutado')).toEqual([])
        expect(requisitosDelPaso('abrir')).toEqual(['bases_diaco'])
        // Decisión del PM: Gobernación y fianza se marcan, pero no bloquean la ejecución.
        expect(requisitosDelPaso('ejecutar')).toEqual(['bases_diaco', 'isr_premios', 'timbre_fiscal', 'delegado_o_notario'])
        expect(REQUISITOS_SORTEO.autorizacion_gobernacion.noBloquea && REQUISITOS_SORTEO.fianza.noBloquea).toBe(true)
    })

    it('422 requisito_pendiente y bases_incompletas, legibles', () => {
        const requisito = problemaSorteoLegible({ type: 'urn:argosisp:problema:requisito_pendiente', title: 'Requisito legal pendiente', status: 422, detail: 'Para ejecutar el sorteo falta marcar el requisito timbre_fiscal', errors: [{ field: 'requisitos', message: 'timbre_fiscal', rule: 'requisito_pendiente' }] })
        expect(requisito.title).toBe('Falta el requisito «Timbre fiscal»')
        expect(requisito.detail).toContain('Timbre del 3 %')
        const bases = problemaSorteoLegible({ type: 'urn:argosisp:problema:bases_incompletas', title: 'Bases incompletas', status: 422, errors: [{ field: 'bases.publicacion_resultados', message: 'Falta la forma y el medio de publicar los resultados' }] })
        expect(bases.detail).toBe('Falta la forma y el medio de publicar los resultados')
    })

    it('ISR y neto del premio con decimal.js; cuerpo de la entrega solo con la contrapartida de su tipo', () => {
        const efectivo = { valor: '1000.00', retiene_isr: true, isr_pct: '10.00', tipo: 'efectivo' as const }
        expect(isrPremio(efectivo).toFixed(2)).toBe('100.00')
        expect(netoPremio(efectivo).toFixed(2)).toBe('900.00')
        expect(netoPremio({ ...efectivo, tipo: 'bien' }).toFixed(2)).toBe('1000.00')
        expect(cuerpoEntregaPremio({ tipo: 'efectivo', metodo: 'caja', caja_id: 2, banco_id: 1, cuenta_bancaria_id: null, contrapartida: null, compra_linea_id: null, cuenta_codigo: '', nota: '' }))
            .toEqual({ metodo: 'caja', caja_id: 2, banco_id: null, cuenta_bancaria_id: null, nota: null })
        expect(cuerpoEntregaPremio({ tipo: 'bien', metodo: null, caja_id: null, banco_id: null, cuenta_bancaria_id: null, contrapartida: 'cuenta', compra_linea_id: 11, cuenta_codigo: '1.1.14', nota: 'Recibió el titular' }))
            .toEqual({ contrapartida: 'cuenta', cuenta_codigo: '1.1.14', nota: 'Recibió el titular' })
        expect(cuerpoEntregaPremio({ tipo: 'bien', metodo: null, caja_id: null, banco_id: null, cuenta_bancaria_id: null, contrapartida: 'compra', compra_linea_id: 11, cuenta_codigo: '1.1.14', nota: '' }))
            .toEqual({ contrapartida: 'compra', compra_linea_id: 11, nota: null })
        expect(cuerpoEntregaPremio({ tipo: 'servicio', metodo: null, caja_id: null, banco_id: null, cuenta_bancaria_id: null, contrapartida: null, compra_linea_id: null, cuenta_codigo: '', nota: '' })).toEqual({ nota: null })
    })

    it('cuerpo del sorteo: fechas en hora de Guatemala a UTC, montos con 2 decimales, premio_id solo en servicio', () => {
        const entrada = entradaSorteoVacia()
        Object.assign(entrada, { nombre: 'Prueba', corte_en: '2026-12-20T23:59', fecha_sorteo: '2026-12-22T16:00', inscripcion_desde: '2026-11-01' })
        entrada.premios = [{ ...entradaPremioVacia(), nombre: 'Efectivo', valor: '500', premio_id: 3 }, { ...entradaPremioVacia(), nombre: 'Mes', tipo: 'servicio', valor: '250', premio_id: 2, retiene_isr: false }]
        const cuerpo = cuerpoSorteo(esquemaSorteo.parse(entrada))
        expect(cuerpo.corte_en).toBe('2026-12-21T05:59:00.000Z')
        expect(cuerpo.fecha_sorteo).toBe('2026-12-22T22:00:00.000Z')
        expect(cuerpo.premios?.map(p => [p.valor, p.premio_id, p.isr_pct])).toEqual([['500.00', null, '10.00'], ['250.00', 2, '10.00']])
        expect(esquemaSorteo.safeParse({ ...entrada, fecha_sorteo: '2026-12-01T10:00' }).success).toBe(false)
        expect(esquemaSorteo.safeParse({ ...entrada, premios: [{ ...entradaPremioVacia(), nombre: 'Mes', tipo: 'servicio', valor: '250', premio_id: null }] }).success).toBe(false)
    })

    it('el asiento de un premio (origen sorteo, aún fuera del contrato) se rotula sin romper el libro', () => {
        expect(origenAsiento('sorteo')).toEqual({ etiqueta: 'Premio de sorteo', icono: 'i-lucide-ticket' })
        expect(origenAsiento('pago').etiqueta).toBe('Pago')
        expect(origenAsiento('otro_origen').etiqueta).toBe('Otro origen')
    })

    it('argos-sorteo-v1 con Web Crypto da lo mismo que la referencia de la API', async () => {
        const semilla = Buffer.from('7f'.repeat(32), 'hex')
        const lista = Array.from({ length: 9 }, (_, i) => ({ codigo: `S${String(i).padStart(10, '0')}`, boletos: (i % 3) + 1 }))
        const listaHash = await hashListaSorteo(lista)
        expect(listaHash).toBe(createHash('sha256').update(lista.map(p => `${p.codigo}|${p.boletos}\n`).join('')).digest('hex'))
        const basesHash = 'b'.repeat(64)
        const nuestro = await sortearV1(bytesDeHex(semilla.toString('hex')), listaHash, basesHash, 'Lotería 48213', lista, 5)
        expect(nuestro).toEqual(sortearReferencia(semilla, listaHash, basesHash, 'Lotería 48213', lista, 5))
        expect(new Set(nuestro).size).toBe(5)
        expect(jsonCanonicoSorteo({ b: 1, a: { d: [1, { z: null, y: 'x' }], c: undefined } })).toBe('{"a":{"d":[1,{"y":"x","z":null}]},"b":1}')
    })
})

describe('sorteos · pasos contra los fixtures', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    it('lista con filtro por estado; el cajero no tiene sorteos.ver (403)', async () => {
        const todos = await useSorteos().listar()
        expect(todos.ok && todos.data.data.length).toBe(7)
        const ejecutados = await useSorteos().listar({ estado: 'ejecutado' })
        expect(ejecutados.ok && ejecutados.data.data.map(s => [s.id, s.bases_hash?.length, s.compromiso?.length])).toEqual([[SORTEO_EJECUTADO_ID, 64, 64]])
        sesionFixture('fixture-cajero')
        const cajero = await useSorteos().listar()
        expect(!cajero.ok && cajero.problema.status).toBe(403)
    })

    it('borrador: publicar sin la publicación de resultados es 422 bases_incompletas; editada, publica con hash y compromiso', async () => {
        const incompleto = await useSorteos().publicarBases(SORTEO_BORRADOR_ID, nuevaClaveIdempotencia())
        expect(!incompleto.ok && incompleto.problema.errors?.[0]?.field).toBe('bases.publicacion_resultados')
        const actual = await useSorteos().ver(SORTEO_BORRADOR_ID)
        if (!actual.ok) {
            throw new Error('sin sorteo')
        }
        const entrada = entradaDeSorteo(actual.data)
        entrada.publicacion_resultados = 'En el portal y en Facebook, el mismo día'
        const editado = await useSorteos().editar(SORTEO_BORRADOR_ID, cuerpoEdicionSorteo(actual.data, esquemaSorteo.parse(entrada)))
        // La imagen subida se queda con el premio de la misma posición (no es una URL que mande el panel).
        expect(editado.ok && [editado.data.version, editado.data.premios.map(p => p.imagen_url)]).toEqual([2, [null, `/api/v1/lealtad/sorteos/${SORTEO_BORRADOR_ID}/premios/2/imagen`]])
        const publicado = await useSorteos().publicarBases(SORTEO_BORRADOR_ID, nuevaClaveIdempotencia())
        expect(publicado.ok && publicado.data.estado).toBe('bases_publicadas')
        expect(publicado.ok && [publicado.data.bases_hash, publicado.data.compromiso].every(h => /^[0-9a-f]{64}$/.test(h ?? ''))).toBe(true)
        const otraVez = editado.ok ? await useSorteos().editar(SORTEO_BORRADOR_ID, { version: 3, nombre: 'Otro' }) : null
        expect(otraVez && !otraVez.ok && codigoProblema(otraVez.problema)).toBe('estado_sorteo')
    })

    it('abrir exige bases_diaco (422 requisito_pendiente); marcado con evidencia, abre', async () => {
        const sinRequisito = await useSorteos().abrir(SORTEO_PUBLICADO_ID, nuevaClaveIdempotencia())
        expect(!sinRequisito.ok && problemaSorteoLegible(sinRequisito.problema).title).toBe('Falta el requisito «Bases publicadas (DIACO)»')
        const sinEvidencia = await useSorteos().marcarRequisito(SORTEO_PUBLICADO_ID, 'bases_diaco', { estado: 'cumplido' }, nuevaClaveIdempotencia())
        expect(!sinEvidencia.ok && sinEvidencia.problema.errors?.[0]?.field).toBe('evidencia')
        const marcado = await useSorteos().marcarRequisito(SORTEO_PUBLICADO_ID, 'bases_diaco', { estado: 'cumplido', valor: 'Prensa Libre', evidencia: 'Página 14' }, nuevaClaveIdempotencia())
        expect(marcado.ok && marcado.data.find(r => r.clave === 'bases_diaco')?.estado).toBe('cumplido')
        const abierto = await useSorteos().abrir(SORTEO_PUBLICADO_ID, nuevaClaveIdempotencia())
        expect(abierto.ok && abierto.data.estado).toBe('participacion_abierta')
    })

    it('cerrar corte: participantes con seudónimo (servicios activos sin vencidas) y lista_hash', async () => {
        const cerrado = await useSorteos().cerrarCorte(SORTEO_ABIERTO_ID, nuevaClaveIdempotencia())
        expect(cerrado.ok).toBe(true)
        if (!cerrado.ok) {
            return
        }
        expect(cerrado.data.estado).toBe('corte_cerrado')
        expect(cerrado.data.participantes).toBeGreaterThan(10)
        expect(cerrado.data.boletos).toBeGreaterThanOrEqual(cerrado.data.participantes)
        expect(cerrado.data.lista_hash).toMatch(/^[0-9a-f]{64}$/)
    })

    it('ejecutar: 422 sin el timbre fiscal; marcado, elige titulares y suplentes reproducibles; entregar por tipo', async () => {
        const sinTimbre = await useSorteos().ejecutar(SORTEO_CORTE_ID, { valor_publico: '48213', valor_publico_evidencia: 'Leído en el acto' }, nuevaClaveIdempotencia())
        expect(!sinTimbre.ok && sinTimbre.problema.errors?.[0]?.message).toBe('timbre_fiscal')
        await useSorteos().marcarRequisito(SORTEO_CORTE_ID, 'timbre_fiscal', { estado: 'cumplido', evidencia: 'Recibo 63' }, nuevaClaveIdempotencia())
        const sinValor = await useSorteos().ejecutar(SORTEO_CORTE_ID, { valor_publico: ' ', valor_publico_evidencia: ' ' }, nuevaClaveIdempotencia())
        expect(!sinValor.ok && sinValor.problema.errors?.map(e => e.field)).toEqual(['valor_publico', 'valor_publico_evidencia'])
        const ejecutado = await useSorteos().ejecutar(SORTEO_CORTE_ID, { valor_publico: 'Lotería Santa Lucía: 48213', valor_publico_evidencia: 'Leído por la notaria en loteria.gob.gt', asistentes: [{ nombre: 'Lic. Marta Sosa', rol: 'Notaria' }] }, nuevaClaveIdempotencia())
        if (!ejecutado.ok) {
            throw new Error(ejecutado.problema.title)
        }
        expect(ejecutado.data.estado).toBe('ejecutado')
        expect(ejecutado.data.ganadores.map(g => [g.posicion, g.tipo, g.premio_posicion])).toEqual([[1, 'titular', 1], [2, 'titular', 2], [3, 'suplente', null], [4, 'suplente', null]])

        const verificacion = await useSorteos().verificacion(SORTEO_CORTE_ID)
        if (!verificacion.ok) {
            throw new Error('sin verificación')
        }
        const comprobacion = await comprobarSorteo(verificacion.data)
        expect(comprobacion).toMatchObject({ compromiso: true, lista: true, bases: true, ganadores: true })

        const [efectivo, servicio] = ejecutado.data.ganadores
        if (!efectivo || !servicio) {
            throw new Error('sin titulares')
        }
        const sinMetodo = await useSorteos().entregar(SORTEO_CORTE_ID, efectivo.id, {}, nuevaClaveIdempotencia())
        expect(!sinMetodo.ok && sinMetodo.problema.errors?.[0]?.field).toBe('metodo')
        const pagado = await useSorteos().entregar(SORTEO_CORTE_ID, efectivo.id, { metodo: 'caja', caja_id: 2 }, nuevaClaveIdempotencia())
        const ganadorPagado = pagado.ok ? pagado.data.ganadores.find(g => g.id === efectivo.id) : null
        expect(ganadorPagado).toMatchObject({ estado: 'entregado', retencion_isr: '75.00', contrapartida: 'caja' })
        expect(pagado.ok && pagado.data.estado).toBe('ejecutado')
        const canje = await useSorteos().entregar(SORTEO_CORTE_ID, servicio.id, {}, nuevaClaveIdempotencia())
        expect(canje.ok && [canje.data.estado, canje.data.ganadores.find(g => g.id === servicio.id)?.contrapartida]).toEqual(['ejecutado', 'canje'])
    })

    it('la verificación es 404 antes de ejecutar y el sorteo sembrado ya ejecutado se reproduce', async () => {
        const antes = await useSorteos().verificacion(SORTEO_CORTE_ID)
        expect(!antes.ok && antes.problema.status).toBe(404)
        const sembrado = await useSorteos().verificacion(SORTEO_EJECUTADO_ID)
        expect(sembrado.ok && sembrado.data.lista.length).toBe(8)
        expect(sembrado.ok && (await comprobarSorteo(sembrado.data)).ganadores).toBe(true)
    })

    it('ficha en corte cerrado: el aviso del checklist y el 422 del timbre legible en el modal de ejecutar', async () => {
        const vista = await mountSuspended(PaginaSorteo, { route: `/lealtad/sorteos/${SORTEO_CORTE_ID}` })
        await esperar(() => expect(vista.find('[data-prueba="sorteo-estado"]').text()).toBe('Corte cerrado'))
        expect(vista.find('[data-prueba="sorteo-faltantes"]').text()).toContain('Timbre fiscal')
        expect(vista.find('[data-requisito="timbre_fiscal"] [data-prueba="requisito-estado"]').text()).toBe('Pendiente')
        expect(vista.find('[data-prueba="ejecutar-sorteo"]').exists()).toBe(true)
        expect(vista.find('[data-prueba="publicar-bases"]').exists()).toBe(false)
        expect(vista.findAll('[data-prueba="premio-tipo"]').map(b => b.text())).toEqual(['Efectivo', 'Servicio'])
        vista.unmount()
    })

    it('ficha ejecutada: titulares, suplentes, entregar y «Comprobar resultado» que reproduce el sorteo', async () => {
        const vista = await mountSuspended(PaginaSorteo, { route: `/lealtad/sorteos/${SORTEO_EJECUTADO_ID}` })
        await esperar(() => expect(vista.find('[data-prueba="sorteo-resultado"]').exists()).toBe(true))
        expect(vista.findAll('[data-ganador]')).toHaveLength(3)
        expect(vista.findAll('[data-suplente]')).toHaveLength(2)
        expect(vista.findAll('[data-prueba="entregar-premio"]')).toHaveLength(3)
        expect(vista.find('[data-prueba="enlace-verificacion"]').attributes('href')).toMatch(/\/api\/v1\/lealtad\/sorteos\/5\/verificacion$/)
        await vista.find('[data-prueba="comprobar-sorteo"]').trigger('click')
        await esperar(() => expect(vista.find('[data-prueba="resultado-comprobacion"]').text()).toContain('El resultado se reproduce'))
        vista.unmount()
    })

    it('sin sorteos.entregar ni sorteos.ejecutar no hay botones de esos pasos', async () => {
        useUsuarioActual().value = { ...meAdmin, permisos: meAdmin.permisos.filter(p => p !== 'sorteos.entregar' && p !== 'sorteos.ejecutar') }
        const ejecutada = await mountSuspended(PaginaSorteo, { route: `/lealtad/sorteos/${SORTEO_EJECUTADO_ID}` })
        await esperar(() => expect(ejecutada.find('[data-prueba="sorteo-resultado"]').exists()).toBe(true))
        expect(ejecutada.find('[data-prueba="entregar-premio"]').exists()).toBe(false)
        ejecutada.unmount()
        const cerrado = await mountSuspended(PaginaSorteo, { route: `/lealtad/sorteos/${SORTEO_CORTE_ID}` })
        await esperar(() => expect(cerrado.find('[data-prueba="sorteo-estado"]').exists()).toBe(true))
        expect(cerrado.find('[data-prueba="ejecutar-sorteo"]').exists()).toBe(false)
        cerrado.unmount()
    })

    it('la lista muestra estado y premios; «Nuevo sorteo» solo con sorteos.gestionar', async () => {
        const vista = await mountSuspended(PaginaSorteos, { route: '/lealtad/sorteos' })
        await esperar(() => expect(vista.findAll('[data-prueba="tabla-sorteos"] tbody tr').length).toBe(7))
        await flushPromises()
        expect(vista.find('[data-estado="ejecutado"]').text()).toBe('Ejecutado')
        expect(vista.text()).toContain('3 premios · Q 3,750.00')
        expect(vista.find('[data-prueba="nuevo-sorteo"]').exists()).toBe(true)
        vista.unmount()
    })
})
