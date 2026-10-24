import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import { cambiarDatosDeclaracionFixture } from '~~/fixtures/declaraciones/rutas'
import PaginaDeclaraciones from '~/pages/declaraciones/index.vue'
import PaginaDeclaracion from '~/pages/declaraciones/[id].vue'
import PaginaCalendario from '~/pages/fiscal/calendario.vue'
import { esperar } from '../ayudas/esperar'
import { fijarHoyFixtures, soltarReloj } from '../ayudas/reloj'

/**
 * Declaraciones de IVA y pequeño contribuyente (A3, fase 7 PR B). Hoy es el 15/10/2026. ArgosNet: julio
 * presentada y pagada (1); agosto v1 sustituida (2) y v2 sustitutiva presentada el 02/10, vencida el
 * 30/09 y sin pagar (3); septiembre sin calcular (obligación 7). Fibra del Sur: agosto PC presentada (4).
 */

function botonDelDialogo(texto: string): HTMLButtonElement | undefined {
    return [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(b => b.textContent?.trim() === texto)
}

function escribir(selector: string, valor: string) {
    const campo = document.querySelector<HTMLInputElement>(`[role="dialog"] ${selector}`)
    if (!campo) {
        throw new Error(`Sin ${selector}`)
    }
    campo.value = valor
    campo.dispatchEvent(new Event('input'))
}

describe('declaraciones', () => {
    beforeEach(() => {
        fijarHoyFixtures()
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
        useEmpresaActiva().elegir(1)
    })

    afterEach(() => {
        soltarReloj()
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    it('secciones, acciones por estado, problemas con qué hacer y esquemas espejo del validador', () => {
        expect(seccionesTotales('iva_mensual').map(s => s.id)).toEqual(['debitos', 'creditos', 'retenciones', 'determinado', 'liquidacion'])
        expect(seccionesTotales('pc_mensual').flatMap(s => s.filas.map(f => f.clave))).toContain('iva_en_ventas')
        const base = { pago: null, totales: { a_pagar: '534.00' } }
        expect(accionesDeclaracion({ ...base, estado: 'borrador' })).toEqual({ revisar: true, presentar: false, pagar: false, anularPago: false, recalcular: true, sustitutiva: false })
        expect(accionesDeclaracion({ ...base, estado: 'revisada' })).toMatchObject({ presentar: true, pagar: true, sustitutiva: true })
        expect(accionesDeclaracion({ ...base, estado: 'presentada', totales: { a_pagar: '0.00' } }).pagar).toBe(false)
        expect(accionesDeclaracion({ ...base, estado: 'sustituida' }).recalcular).toBe(false)
        expect(totalDe({ totales: {} }, 'a_pagar')).toBeNull()
        expect(tasaPequenoContribuyente({ parametros: [{ clave: 'impuesto:IVA_PC', valor: '5.00', vigente_desde: null, nivel: 'paquete' }] })).toBe('5.00')
        expect(mesPorDeclarar('2026-01-15')).toBe('2025-12')
        const revisada = { type: 'urn:argosisp:problema:declaracion_revisada', title: 'x', status: 409 }
        expect([pideSustitutiva(revisada), problemaDeclaracionLegible(revisada).detail]).toEqual([true, 'Para corregirla, calcule una sustitutiva: su revisión liquida solo la diferencia.'])
        expect(problemaDeclaracionLegible({ type: 'urn:argosisp:problema:periodo_en_curso', title: 'x', status: 422, detail: 'El mes 2026-10 no ha terminado' }).title).toBe('El mes todavía no termina')

        const calcular = esquemaCalcularDeclaracion('2026-10-15')
        expect(calcular.safeParse({ impuesto: 'iva_mensual', periodo: '2026-09', sustitutiva: false }).data).toEqual({ impuesto: 'iva_mensual', periodo: '2026-09' })
        expect(calcular.safeParse({ impuesto: 'iva_mensual', periodo: '2026-11', sustitutiva: false }).error?.issues[0]?.message).toBe('El periodo no puede ser futuro')
        const presentar = esquemaPresentarDeclaracion('2026-10-15')
        expect(presentar.safeParse({ numero_formulario: '22', fecha_presentacion: '2026-10-15', boleta: '' }).error?.issues[0]?.path).toEqual(['numero_formulario'])
        expect(presentar.safeParse({ numero_formulario: '2237-1', fecha_presentacion: '2026-10-16', boleta: '' }).error?.issues[0]?.message).toBe('No puede ser futura')
        const pago = esquemaPagoDeclaracion('2026-10-15')
        expect(pago.safeParse({ metodo: 'caja', caja_id: null, banco_id: null, cuenta_bancaria_id: null, fecha: '', boleta: '' }).error?.issues[0]?.path).toEqual(['caja_id'])
        expect(pago.safeParse({ metodo: 'banco', caja_id: 1, banco_id: null, cuenta_bancaria_id: null, fecha: '', boleta: 'B-1' }).data).toEqual({ metodo: 'banco', boleta: 'B-1' })
    })

    it('API de los fixtures: versiones, sustitutiva, revisar con sus reglas, presentar y pagar con mora y multa', async () => {
        const d = useDeclaraciones()
        const v1 = await d.calcular({ impuesto: 'iva_mensual', periodo: '2026-09' }, nuevaClaveIdempotencia())
        if (!v1.ok) {
            throw new Error(v1.problema.title)
        }
        // Débito 864 + 480 − 60, crédito 720, retenciones 30; los remanentes salen de agosto v2 (en cero).
        expect([v1.data.totales.debito, v1.data.totales.credito, v1.data.totales.impuesto_determinado, v1.data.totales.a_pagar, v1.data.detalle.anterior_id, v1.data.sustitutiva]).toEqual(['1284.00', '720.00', '534.00', '534.00', 3, false])
        expect(bd.obligacionesFiscales.find(o => o.id === 7)).toMatchObject({ estado: 'borrador', declaracion_id: v1.data.id })
        const v2 = await d.calcular({ impuesto: 'iva_mensual', periodo: '2026-09' }, nuevaClaveIdempotencia())
        expect(v2.ok && [v2.data.version, v2.data.sustitutiva, bd.declaraciones.find(x => x.id === v1.data.id)?.estado]).toEqual([2, false, 'sustituida'])
        const vieja = await d.revisar(v1.data.id, nuevaClaveIdempotencia())
        expect(!vieja.ok && codigoProblema(vieja.problema)).toBe('declaracion_sustituida')
        if (!v2.ok) {
            return
        }
        const sinRevisar = await d.marcarPresentada(v2.data.id, { numero_formulario: '2237-1', fecha_presentacion: '2026-10-15' }, nuevaClaveIdempotencia())
        expect(!sinRevisar.ok && codigoProblema(sinRevisar.problema)).toBe('declaracion_no_revisada')

        // iva_cuadrado en anomalía: 422 checks_pendientes; sin ella, revisa, liquida y bloquea.
        bd.calculosChecks.push({ empresa_id: 1, tipo: 'impuestos', periodo: '2026-09-01', clave: 'iva_cuadrado', esperado: 'V_IVA 1284.00', obtenido: 'V_IVA 1224.00', resultado: 'anomalia', detalle: null })
        const descuadre = await d.revisar(v2.data.id, nuevaClaveIdempotencia())
        expect(!descuadre.ok && [codigoProblema(descuadre.problema), descuadre.problema.errors?.map(e => e.field)]).toEqual(['checks_pendientes', ['iva_cuadrado']])
        bd.calculosChecks.pop()
        const revisada = await d.revisar(v2.data.id, nuevaClaveIdempotencia())
        expect(revisada.ok && [revisada.data.estado, revisada.data.asiento_id !== null]).toEqual(['revisada', true])
        expect(bd.bloqueosLibro.filter(b => b.empresa_id === 1 && b.tipo === 'impuestos').at(-1)?.hasta).toBe('2026-09-30')
        // Como la API: la verificación previa deja `iva_liquidado` sin liquidar; la posterior, en orden.
        expect(bd.checksCierre.filter(c => c.tipo === 'impuestos' && c.periodo === '2026-09-01').map(c => [c.clave, c.resultado])).toEqual([['iva_cuadrado', 'ok'], ['iva_liquidado', 'anomalia'], ['retenciones_cuadradas', 'ok'], ['iva_liquidado', 'ok']])
        const otra = await d.calcular({ impuesto: 'iva_mensual', periodo: '2026-09' }, nuevaClaveIdempotencia())
        expect(!otra.ok && codigoProblema(otra.problema)).toBe('declaracion_revisada')
        const sustitutiva = await d.calcular({ impuesto: 'iva_mensual', periodo: '2026-09', sustitutiva: true }, nuevaClaveIdempotencia())
        expect(sustitutiva.ok && [sustitutiva.data.version, sustitutiva.data.sustitutiva, sustitutiva.data.sustituye_a]).toEqual([3, true, v2.data.id])

        // Los datos cambian: la versión queda desactualizada.
        cambiarDatosDeclaracionFixture(1, '2026-09')
        const ficha = sustitutiva.ok ? await d.ver(sustitutiva.data.id) : null
        expect(ficha?.ok && ficha.data.desactualizada).toBe(true)
        const desactualizada = sustitutiva.ok ? await d.revisar(sustitutiva.data.id, nuevaClaveIdempotencia()) : null
        expect(desactualizada && !desactualizada.ok && codigoProblema(desactualizada.problema)).toBe('declaracion_desactualizada')

        // Octubre no ha terminado, diciembre de 2024 es anterior al inicio de los libros y ArgosNet no es pequeño contribuyente.
        const octubre = await d.calcular({ impuesto: 'iva_mensual', periodo: '2026-10' }, nuevaClaveIdempotencia())
        const enCurso = octubre.ok ? await d.revisar(octubre.data.id, nuevaClaveIdempotencia()) : null
        expect(enCurso && !enCurso.ok && codigoProblema(enCurso.problema)).toBe('periodo_en_curso')
        const antes2025 = await d.calcular({ impuesto: 'iva_mensual', periodo: '2024-12' }, nuevaClaveIdempotencia())
        expect(!antes2025.ok && codigoProblema(antes2025.problema)).toBe('antes_de_inicio_libros')
        const pc = await d.calcular({ impuesto: 'pc_mensual', periodo: '2026-09' }, nuevaClaveIdempotencia())
        expect(!pc.ok && codigoProblema(pc.problema)).toBe('obligacion_no_aplica')

        // Agosto v2: presentada el 02/10 (venció el 30/09) y pagada hoy, 15 días tarde.
        const pago = await d.registrarPago(3, { metodo: 'banco' }, nuevaClaveIdempotencia())
        expect(pago.ok && pago.data.pago && [pago.data.pago.impuesto, pago.data.pago.mora, pago.data.pago.multa, pago.data.pago.total, pago.data.pago.dias_atraso]).toEqual(['755.00', '5.66', '100.00', '860.66', 15])
        const otraVez = await d.registrarPago(3, { metodo: 'banco' }, nuevaClaveIdempotencia())
        expect(!otraVez.ok && codigoProblema(otraVez.problema)).toBe('declaracion_pagada')
        const ajena = await d.registrarPago(4, { metodo: 'caja', caja_id: 1 }, nuevaClaveIdempotencia())
        expect(!ajena.ok && ajena.problema.status).toBe(403)
        expect(bd.acciones.filter(a => a.accion.startsWith('declaraciones.')).map(a => a.accion)).toContain('declaraciones.pagar')
    })

    it('NCRE sin certificar: revisar responde 409 con la nota enlazada', async () => {
        const nota = bd.notasCredito.find(n => n.id === 3)
        if (nota) {
            nota.fecha = '2026-09-20'
        }
        const v = await useDeclaraciones().calcular({ impuesto: 'iva_mensual', periodo: '2026-09' }, nuevaClaveIdempotencia())
        if (!v.ok) {
            throw new Error(v.problema.title)
        }
        const vista = await mountSuspended(PaginaDeclaracion, { route: `/declaraciones/${v.data.id}` })
        await esperar(() => expect(vista.find('[data-prueba="abrir-revisar"]').exists()).toBe(true))
        await vista.find('[data-prueba="abrir-revisar"]').trigger('click')
        await esperar(() => expect(document.querySelector('[data-prueba="revisar-aviso"]')?.textContent).toContain('bloquea los impuestos del mes'))
        expect(botonDelDialogo('Revisar y liquidar')?.disabled).toBe(true)
        document.querySelector<HTMLButtonElement>('[role="dialog"] button[role="checkbox"]')?.click()
        await esperar(() => expect(botonDelDialogo('Revisar y liquidar')?.disabled).toBe(false))
        botonDelDialogo('Revisar y liquidar')?.click()
        await esperar(() => expect(document.querySelector('[data-prueba="declaracion-ncre"]')?.textContent).toContain('Nota de crédito #3'))
        expect(document.querySelector('[data-prueba="problema-declaracion"]')?.textContent).toContain('Hay notas de crédito sin certificar')
    })

    it('lista: filtros, consolidado y «Calcular» desde el calendario; error visible con Reintentar', async () => {
        const vista = await mountSuspended(PaginaDeclaraciones, { route: '/declaraciones?estado=sustituida' })
        await esperar(() => expect(vista.findAll('[data-prueba="tabla-declaraciones"] [data-declaracion]').map(f => f.attributes('data-declaracion'))).toEqual(['2']))

        const calcular = await mountSuspended(PaginaDeclaraciones, { route: '/declaraciones?calcular=iva_mensual&periodo=2026-09' })
        await esperar(() => expect(document.querySelector('[data-prueba="calcular-periodo"] input, input[data-prueba="calcular-periodo"]')).not.toBeNull())
        botonDelDialogo('Calcular')?.click()
        await esperar(() => expect(useRoute().path).toMatch(/^\/declaraciones\/\d+$/))
        expect(bd.declaraciones.at(-1)?.periodo_desde).toBe('2026-09-01')
        calcular.unmount()

        simularFalla('GET /api/v1/declaraciones', 500)
        const rota = await mountSuspended(PaginaDeclaraciones, { route: '/declaraciones' })
        await esperar(() => expect(rota.text()).toContain('Reintentar'))
        expect(rota.find('[data-prueba="tabla-declaraciones"]').exists()).toBe(false)
    })

    it('ficha: totales por sección, versiones, pago con mora y multa y la sustitutiva', async () => {
        const vista = await mountSuspended(PaginaDeclaracion, { route: '/declaraciones/3' })
        await esperar(() => expect(vista.find('[data-prueba="declaracion-ficha"]').exists()).toBe(true))
        expect(vista.find('[data-total="impuesto_determinado"]').text()).toContain('755.00')
        expect(vista.find('[data-total="a_pagar"]').text()).toContain('755.00')
        await esperar(() => expect(vista.findAll('[data-prueba="declaracion-versiones"] [data-version]').map(v => v.attributes('data-version'))).toEqual(['2', '1']))
        expect(vista.find('[data-prueba="abrir-presentar"]').exists()).toBe(false)
        expect(vista.find('[data-prueba="abrir-recalcular"]').text()).toBe('Calcular sustitutiva')

        await vista.find('[data-prueba="abrir-pagar"]').trigger('click')
        await esperar(() => expect(document.querySelector('[data-prueba="pago-pendiente"]')?.textContent).toContain('755.00'))
        botonDelDialogo('Registrar pago')?.click()
        await esperar(() => expect(vista.find('[data-prueba="pago-total"]').text()).toContain('860.66'))
        expect(vista.find('[data-prueba="abrir-pagar"]').exists()).toBe(false)

        await vista.find('[data-prueba="abrir-recalcular"]').trigger('click')
        await esperar(() => expect(botonDelDialogo('Calcular sustitutiva')).toBeDefined())
        botonDelDialogo('Calcular sustitutiva')?.click()
        await esperar(() => expect(useRoute().path).toBe(`/declaraciones/${bd.declaraciones.at(-1)?.id}`))
        expect(bd.declaraciones.find(d => d.id === 3)?.estado).toBe('sustituida')
    })

    it('presentar: aclara que no se envía nada a la SAT; pequeño contribuyente con su tasa', async () => {
        const v = await useDeclaraciones().calcular({ impuesto: 'iva_mensual', periodo: '2026-09' }, nuevaClaveIdempotencia())
        const r = v.ok ? await useDeclaraciones().revisar(v.data.id, nuevaClaveIdempotencia()) : null
        if (!r?.ok) {
            throw new Error('sin revisar')
        }
        const vista = await mountSuspended(PaginaDeclaracion, { route: `/declaraciones/${r.data.id}` })
        await esperar(() => expect(vista.find('[data-prueba="abrir-presentar"]').exists()).toBe(true))
        await vista.find('[data-prueba="abrir-presentar"]').trigger('click')
        await esperar(() => expect(document.querySelector('[data-prueba="presentar-aviso"]')?.textContent).toContain('ArgosIsp no presenta nada a la SAT'))
        escribir('[data-prueba="presentar-numero"] input, input[data-prueba="presentar-numero"]', '2237-0004700001')
        botonDelDialogo('Marcar presentada')?.click()
        await esperar(() => expect(vista.find('[data-prueba="declaracion-estado"]').text()).toBe('Presentada'))
        expect(bd.obligacionesFiscales.find(o => o.id === 7)?.estado).toBe('presentada')

        useEmpresaActiva().elegir('todas')
        const pc = await mountSuspended(PaginaDeclaracion, { route: '/declaraciones/4' })
        await esperar(() => expect(pc.find('[data-prueba="declaracion-tasa"]').text()).toBe('5.00 %'))
        expect(pc.find('[data-total="impuesto"]').text()).toContain('900.00')
        expect(pc.find('[data-total="iva_en_ventas"]').text()).toContain('0.00')
    })

    it('calendario: vencidas por `vencida=true`, la obligación enlaza su declaración o lleva a calcularla', async () => {
        const vencidas = await useObligacionesFiscales().vencidas()
        expect(vencidas.ok && vencidas.data.map(o => o.id)).toEqual([5, 8])
        const vista = await mountSuspended(PaginaCalendario, { route: '/fiscal/calendario?obligacion=4' })
        await esperar(() => expect(document.querySelector('[data-prueba="detalle-declaracion"]')?.getAttribute('href')).toBe('/declaraciones/3'))
        vista.unmount()
        await mountSuspended(PaginaCalendario, { route: '/fiscal/calendario?obligacion=7' })
        await esperar(() => expect(document.querySelector('[data-prueba="detalle-calcular"]')?.getAttribute('href')).toBe('/declaraciones?calcular=iva_mensual&periodo=2026-09'))
    })

    it('cascada de remanentes (H34): una sustitutiva de julio rectifica agosto; bloqueada si agosto no se puede', async () => {
        // Llega una compra de julio con Q2,000.00 de crédito: julio deja remanente y agosto lo arrastra.
        cambiarDatosDeclaracionFixture(1, '2026-07', { seccion: 'compras', origen: 'compra', documento: 'Compra 12 · FACT D-77', fecha: '2026-07-30', tipo: 'FACT', nit: '3321456-1', base: '16666.67', iva: '2000.00', total: '18666.67', estado: 'registro' })
        const d = useDeclaraciones()
        const julio = await d.calcular({ impuesto: 'iva_mensual', periodo: '2026-07', sustitutiva: true }, nuevaClaveIdempotencia())
        if (!julio.ok) {
            throw new Error(julio.problema.title)
        }

        // Con una NCRE de agosto sin certificar, agosto no se puede rectificar: nada se guarda.
        const nota = bd.notasCredito.find(n => n.id === 3)
        const fecha = nota?.fecha ?? ''
        if (nota) {
            nota.fecha = '2026-08-20'
        }
        const bloqueada = await d.revisar(julio.data.id, nuevaClaveIdempotencia())
        expect(!bloqueada.ok && [codigoProblema(bloqueada.problema), bloqueada.problema.errors?.map(e => [e.field, e.rule])]).toEqual(['cascada_bloqueada', [['2026-08', 'ncre_sin_certificar']]])
        expect(bd.declaraciones.find(x => x.id === julio.data.id)?.estado).toBe('borrador')
        expect(bd.declaraciones.find(x => x.id === 3)?.estado).toBe('presentada')
        if (nota) {
            nota.fecha = fecha
        }

        // Desde la ficha: el aviso de la sustitutiva y, tras revisar, los meses rectificados.
        const vista = await mountSuspended(PaginaDeclaracion, { route: `/declaraciones/${julio.data.id}` })
        await esperar(() => expect(vista.find('[data-prueba="abrir-revisar"]').exists()).toBe(true))
        await vista.find('[data-prueba="abrir-revisar"]').trigger('click')
        await esperar(() => expect(document.querySelector('[data-prueba="revisar-cascada"]')?.textContent).toContain('Puede rectificar meses posteriores'))
        document.querySelector<HTMLButtonElement>('[role="dialog"] button[role="checkbox"]')?.click()
        await esperar(() => expect(botonDelDialogo('Revisar y liquidar')?.disabled).toBe(false))
        botonDelDialogo('Revisar y liquidar')?.click()
        await esperar(() => expect(vista.find('[data-prueba="declaracion-cascada"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="declaracion-cascada"]').text()).toContain('agosto 2026, versión 3 (estaba presentada: hay que presentar la rectificativa)')
        const agosto = bd.declaraciones.find(x => x.periodo_desde === '2026-08-01' && x.version === 3)
        expect(agosto && [agosto.estado, agosto.sustitutiva, agosto.totales.remanente_credito_anterior, agosto.totales.a_pagar]).toEqual(['revisada', true, '776.00', '0.00'])
        expect(bd.obligacionesFiscales.find(o => o.id === 4)).toMatchObject({ estado: 'borrador', motivo_estado: 'rectificativa', declaracion_id: agosto?.id })
        expect(bd.acciones.filter(a => a.accion === 'declaraciones.revisar').map(a => (a.entrada as { motivo?: string }).motivo ?? null)).toEqual([null, 'cascada'])

        // El calendario la marca como rectificativa por presentar.
        const calendario = await mountSuspended(PaginaCalendario, { route: '/fiscal/calendario?vista=lista&impuesto=iva_mensual' })
        await esperar(() => expect(calendario.findAll('[data-prueba="fila-rectificativa"]').length).toBe(1))
        expect(motivoObligacion('rectificativa')).toContain('hay que presentarla de nuevo')
    })
})
