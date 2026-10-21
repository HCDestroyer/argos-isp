import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import { SORTEO_CORTE_ID, SORTEO_EJECUTADO_ID } from '~~/fixtures/sorteos/datos'
import PaginaSorteo from '~/pages/lealtad/sorteos/[id].vue'
import { esperar } from '../ayudas/esperar'

/**
 * Sorteos, resto de la segunda PR de A3 (`a3/sorteos-2`): evidencias del checklist como archivo,
 * cerrar el acta (PDF con su SHA-256), notificar a los ganadores, dar un premio por no reclamado (pasa
 * al siguiente suplente) y exportar los participantes (CSV y XLSX). Las pantallas encadenan varias
 * peticiones a los fixtures: se espera con `esperar` (plazo holgado).
 */
const PDF = new TextEncoder().encode('%PDF-1.4\n% Resolución 412-2026\n%%EOF\n')

function pdf(nombre = 'resolucion.pdf'): File {
    return new File([PDF.slice()], nombre, { type: 'application/pdf' })
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const huella = await crypto.subtle.digest('SHA-256', bytes.slice())
    return [...new Uint8Array(huella)].map(b => b.toString(16).padStart(2, '0')).join('')
}

async function sorteo(id: number): Promise<SorteoDetalle> {
    const r = await useSorteos().ver(id)
    if (!r.ok) {
        throw new Error('sin sorteo')
    }
    return r.data
}

describe('sorteos · evidencias, acta, notificación, no reclamado y exportación', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    it('utilidades: tipo del archivo por su firma, premio del suplente y plazo de reclamo', () => {
        expect(tipoArchivoSorteo(PDF)).toBe('application/pdf')
        expect(errorArchivoSorteo(new TextEncoder().encode('<svg/>'))).toBe('El archivo debe ser PDF, JPEG, PNG o WebP')
        expect(errorArchivoSorteo(new Uint8Array(5 * 1024 * 1024 + 1))).toBe('El archivo pesa 5121 KB; el máximo es 5120 KB')
        const premios = [{ posicion: 3, nombre: 'Mes gratis' }] as const
        expect(premioDeGanador({ premios: premios.map(p => ({ ...p, id: 1, cantidad: 1, imagen_url: null, valor: '250.00', tipo: 'servicio' as const, premio_id: 2, retiene_isr: false, isr_pct: '0.00' })) }, { premio_posicion: null, premio: null, premio_sustitucion: 3 })?.nombre).toBe('Mes gratis')
        expect(plazoReclamoVencido({ estado: 'notificado', reclamar_antes: '2026-10-06T15:00:00.000Z' }, Date.parse('2026-10-07T00:00:00Z'))).toBe(true)
        expect(plazoReclamoVencido({ estado: 'notificado', reclamar_antes: '2026-10-06T15:00:00.000Z' }, Date.parse('2026-10-05T00:00:00Z'))).toBe(false)
    })

    it('evidencia: el archivo se sube, se cita con archivo_id (sin texto) y se descarga con su huella', async () => {
        const svg = await useSorteos().subirArchivo(SORTEO_CORTE_ID, 'evidencia', new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }))
        expect(!svg.ok && [svg.problema.errors?.[0]?.field, svg.problema.errors?.[0]?.rule]).toEqual(['archivo', 'tipo'])
        const subido = await useSorteos().subirArchivo(SORTEO_CORTE_ID, 'evidencia', pdf('recibo-timbre.pdf'))
        if (!subido.ok) {
            throw new Error(subido.problema.title)
        }
        expect(subido.data).toMatchObject({ uso: 'evidencia', tipo: 'application/pdf', nombre: 'recibo-timbre.pdf', tamano: PDF.length, sha256: await sha256Hex(PDF) })
        const marcado = await useSorteos().marcarRequisito(SORTEO_CORTE_ID, 'timbre_fiscal', { estado: 'cumplido', archivo_id: subido.data.id }, nuevaClaveIdempotencia())
        const timbre = marcado.ok ? marcado.data.find(r => r.clave === 'timbre_fiscal') : undefined
        expect(timbre?.archivo_id).toBe(subido.data.id)
        expect(timbre?.evidencia).toContain(`Archivo ${subido.data.id}: recibo-timbre.pdf`)
        const ajeno = await useSorteos().marcarRequisito(SORTEO_CORTE_ID, 'timbre_fiscal', { estado: 'cumplido', archivo_id: 999_999 }, nuevaClaveIdempotencia())
        expect(!ajeno.ok && ajeno.problema.errors?.[0]?.field).toBe('archivo_id')
        const bajado = await useSorteos().archivo(SORTEO_CORTE_ID, subido.data.id)
        expect(bajado.ok && bajado.data.size).toBe(PDF.length)

        const vista = await mountSuspended(PaginaSorteo, { route: `/lealtad/sorteos/${SORTEO_CORTE_ID}` })
        await esperar(() => expect(vista.find('[data-requisito="timbre_fiscal"] [data-prueba="archivo-sorteo"]').text()).toBe('recibo-timbre.pdf'))
        vista.unmount()
    })

    it('cerrar acta: 422 sin la publicación de resultados; con ella, acta_cerrada y el PDF con su SHA-256', async () => {
        const sinPublicacion = await useSorteos().cerrarActa(SORTEO_EJECUTADO_ID, 'Lic. Marta Sosa, colegiado 9921', nuevaClaveIdempotencia())
        expect(!sinPublicacion.ok && problemaSorteoLegible(sinPublicacion.problema).title).toBe('Falta el requisito «Resultados publicados»')
        await useSorteos().marcarRequisito(SORTEO_EJECUTADO_ID, 'publicacion_resultados', { estado: 'cumplido', evidencia: 'Portal y Facebook, 5/9/2026' }, nuevaClaveIdempotencia())
        const sinConstancia = await useSorteos().cerrarActa(SORTEO_EJECUTADO_ID, ' ', nuevaClaveIdempotencia())
        expect(!sinConstancia.ok && sinConstancia.problema.errors?.[0]?.field).toBe('constancia')
        const cerrada = await useSorteos().cerrarActa(SORTEO_EJECUTADO_ID, 'Lic. Marta Sosa, colegiado 9921', nuevaClaveIdempotencia())
        if (!cerrada.ok) {
            throw new Error(cerrada.problema.title)
        }
        expect(cerrada.data).toMatchObject({ estado: 'acta_cerrada', acta_constancia: 'Lic. Marta Sosa, colegiado 9921' })
        expect(cerrada.data.acta_hash).toMatch(/^[0-9a-f]{64}$/)
        const acta = await useSorteos().acta(SORTEO_EJECUTADO_ID)
        const bytes = acta.ok ? new Uint8Array(await acta.data.arrayBuffer()) : new Uint8Array()
        expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
        expect(await sha256Hex(bytes)).toBe(cerrada.data.acta_hash)
        const otraVez = await useSorteos().cerrarActa(SORTEO_EJECUTADO_ID, 'Otra', nuevaClaveIdempotencia())
        expect(!otraVez.ok && codigoProblema(otraVez.problema)).toBe('estado_sorteo')

        const vista = await mountSuspended(PaginaSorteo, { route: `/lealtad/sorteos/${SORTEO_EJECUTADO_ID}` })
        await esperar(() => expect(vista.find('[data-prueba="acta-hash"]').text()).toContain(cerrada.data.acta_hash ?? '-'))
        expect(vista.find('[data-prueba="sorteo-estado"]').text()).toBe('Acta cerrada')
        expect(vista.find('[data-prueba="descargar-acta"]').exists()).toBe(true)
        expect(vista.find('[data-prueba="cerrar-acta"]').exists()).toBe(false)
        // Con el acta cerrada se sigue entregando.
        expect(vista.findAll('[data-prueba="entregar-premio"]').length).toBe(3)
        vista.unmount()
    })

    it('notificar: los ganadores con premio por notificar quedan notificados con plazo; repetir no cambia nada', async () => {
        const antes = await sorteo(SORTEO_EJECUTADO_ID)
        expect(ganadoresPorNotificar(antes.ganadores).map(g => g.posicion)).toEqual([1, 2])
        const hecho = await useSorteos().notificarGanadores(SORTEO_EJECUTADO_ID, nuevaClaveIdempotencia())
        if (!hecho.ok) {
            throw new Error(hecho.problema.title)
        }
        const primero = hecho.data.ganadores.find(g => g.posicion === 1)
        expect(primero?.estado).toBe('notificado')
        expect(Date.parse(primero?.reclamar_antes ?? '') - Date.parse(primero?.notificado_en ?? '')).toBe(30 * 86_400_000)
        expect(hecho.data.ganadores.filter(g => g.tipo === 'suplente').every(g => g.estado === 'por_notificar')).toBe(true)
        const otraVez = await useSorteos().notificarGanadores(SORTEO_EJECUTADO_ID, nuevaClaveIdempotencia())
        expect(otraVez.ok && otraVez.data.ganadores.find(g => g.posicion === 1)?.notificado_en).toBe(primero?.notificado_en)
    })

    it('no reclamado: con el plazo vigente es 422; vencido, el premio pasa al primer suplente, que se notifica y se le entrega', async () => {
        const antes = await sorteo(SORTEO_EJECUTADO_ID)
        await useSorteos().notificarGanadores(SORTEO_EJECUTADO_ID, nuevaClaveIdempotencia())
        const vigente = antes.ganadores.find(g => g.posicion === 1)
        const vencido = antes.ganadores.find(g => g.posicion === 3)
        if (!vigente || !vencido) {
            throw new Error('sin ganadores')
        }
        const temprano = await useSorteos().noReclamado(SORTEO_EJECUTADO_ID, vigente.id, 'No se presentó', nuevaClaveIdempotencia())
        expect(!temprano.ok && codigoProblema(temprano.problema)).toBe('plazo_reclamo_vigente')
        const hecho = await useSorteos().noReclamado(SORTEO_EJECUTADO_ID, vencido.id, 'No se presentó en 30 días', nuevaClaveIdempotencia())
        if (!hecho.ok) {
            throw new Error(hecho.problema.title)
        }
        const original = hecho.data.ganadores.find(g => g.id === vencido.id)
        const suplente = hecho.data.ganadores.find(g => g.sustituye_a === vencido.id)
        expect(original?.estado).toBe('sustituido')
        expect(suplente && [suplente.posicion, suplente.premio_sustitucion, suplente.estado]).toEqual([4, 3, 'notificado'])
        // El resultado no cambia: puestos y premios del sorteo siguen iguales.
        expect(hecho.data.ganadores.map(g => [g.posicion, g.tipo, g.premio_posicion])).toEqual(antes.ganadores.map(g => [g.posicion, g.tipo, g.premio_posicion]))
        const entrega = suplente ? await useSorteos().entregar(SORTEO_EJECUTADO_ID, suplente.id, {}, nuevaClaveIdempotencia()) : null
        expect(entrega?.ok && entrega.data.ganadores.find(g => g.id === suplente?.id)?.contrapartida).toBe('canje')

        const vista = await mountSuspended(PaginaSorteo, { route: `/lealtad/sorteos/${SORTEO_EJECUTADO_ID}` })
        await esperar(() => expect(vista.find('[data-suplente="4"] [data-prueba="ganador-sustituye"]').text()).toContain('3.º puesto'))
        expect(vista.find('[data-ganador="3"] [data-prueba="ganador-no-reclamado"]').text()).toContain('suplente 4.º')
        vista.unmount()
    })

    it('participantes: orden canónico con lista_hash al pie; CSV y XLSX como archivo; 409 antes del corte', async () => {
        const s = await sorteo(SORTEO_EJECUTADO_ID)
        const r = await useSorteos().participantes(SORTEO_EJECUTADO_ID)
        if (!r.ok) {
            throw new Error(r.problema.title)
        }
        expect(r.data.filas.map(f => f.orden)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
        expect(r.data.filas.map(f => f.codigo_publico)).toEqual([...r.data.filas.map(f => f.codigo_publico)].sort())
        expect(r.data.totales.codigo_publico).toBe(`lista_hash ${s.lista_hash}`)
        const csv = await useSorteos().descargarParticipantes(SORTEO_EJECUTADO_ID, 'csv')
        const texto = csv.ok ? await csv.data.text() : ''
        expect(texto.split('\n')[0]).toContain('Orden,Código público,Boletos')
        expect(texto).toContain(`lista_hash ${s.lista_hash}`)
        const xlsx = await useSorteos().descargarParticipantes(SORTEO_EJECUTADO_ID, 'xlsx')
        expect(xlsx.ok && xlsx.data.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        const temprano = await useSorteos().participantes(3)
        expect(!temprano.ok && codigoProblema(temprano.problema)).toBe('estado_sorteo')
    })

    it('ficha ejecutada: notificar, no reclamado solo con el plazo vencido, cerrar acta y exportar, según el permiso', async () => {
        const vista = await mountSuspended(PaginaSorteo, { route: `/lealtad/sorteos/${SORTEO_EJECUTADO_ID}` })
        await esperar(() => expect(vista.find('[data-prueba="notificar-ganadores"]').text()).toBe('Notificar ganadores (2)'))
        expect(vista.findAll('[data-prueba="no-reclamado"]')).toHaveLength(1)
        expect(vista.find('[data-ganador="3"] [data-prueba="no-reclamado"]').exists()).toBe(true)
        expect(vista.find('[data-ganador="3"] [data-prueba="ganador-plazo"]').text()).toContain('el plazo venció')
        expect(vista.find('[data-prueba="cerrar-acta"]').exists()).toBe(true)
        expect(vista.find('[data-prueba="exportar-participantes-csv"]').exists()).toBe(true)
        vista.unmount()

        useUsuarioActual().value = { ...meAdmin, permisos: meAdmin.permisos.filter(p => !['sorteos.entregar', 'sorteos.ejecutar', 'sorteos.exportar'].includes(p)) }
        const lectura = await mountSuspended(PaginaSorteo, { route: `/lealtad/sorteos/${SORTEO_EJECUTADO_ID}` })
        await esperar(() => expect(lectura.find('[data-prueba="sorteo-resultado"]').exists()).toBe(true))
        for (const boton of ['notificar-ganadores', 'no-reclamado', 'cerrar-acta', 'exportar-participantes-csv', 'exportar-participantes-xlsx']) {
            expect(lectura.find(`[data-prueba="${boton}"]`).exists(), boton).toBe(false)
        }
        lectura.unmount()

        useUsuarioActual().value = meAdmin
        const corte = await mountSuspended(PaginaSorteo, { route: `/lealtad/sorteos/${SORTEO_CORTE_ID}` })
        await esperar(() => expect(corte.find('[data-prueba="exportar-participantes-xlsx"]').exists()).toBe(true))
        corte.unmount()
    })
})
