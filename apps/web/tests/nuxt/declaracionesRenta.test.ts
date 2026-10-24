import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import PaginaDeclaracion from '~/pages/declaraciones/[id].vue'
import PaginaAjustes from '~/pages/declaraciones/ajustes.vue'
import PaginaDeclaraciones from '~/pages/declaraciones/index.vue'
import PaginaLibro from '~/pages/libro/index.vue'
import PaginaCalendario from '~/pages/fiscal/calendario.vue'
import { esperar } from '../ayudas/esperar'
import { fijarHoyFixtures, soltarReloj } from '../ayudas/reloj'

/**
 * Fase 7 PR C: ISR (trimestral por renta presunta, anual), ISO (sin `iso_base_periodo`: 422),
 * retenciones de IVA e ISR, anular el pago, ajustes fiscales, cuentas de pago y el cierre anual con el
 * ISR de la declaración. Hoy es el 15/10/2026. ArgosNet: ISR anual 2025 presentado y pagado (5),
 * retenciones de IVA de agosto presentadas y pagadas (6), ejercicio 2024 cerrado, 2025 abierto.
 */

function botonDelDialogo(texto: string): HTMLButtonElement | undefined {
    return [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(b => b.textContent?.trim() === texto)
}

function escribir(selector: string, valor: string) {
    const campo = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[role="dialog"] ${selector}`)
    if (!campo) {
        throw new Error(`Sin ${selector}`)
    }
    campo.value = valor
    campo.dispatchEvent(new Event('input'))
}

function marcar() {
    document.querySelector<HTMLButtonElement>('[role="dialog"] button[role="checkbox"]')?.click()
}

describe('declaraciones de ISR, ISO y retenciones', () => {
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

    it('periodos por impuesto, secciones, efecto de revisar, problemas y esquemas', () => {
        expect(periodoDeclaracion({ impuesto: 'isr_trimestral', periodo_desde: '2026-07-01' })).toBe('2026-T3')
        expect(periodoDeclaracion({ impuesto: 'isr_anual', periodo_desde: '2025-01-01' })).toBe('2025')
        expect(periodoDeclaracion({ impuesto: 'retenciones_isr', periodo_desde: '2026-09-01' })).toBe('2026-09')
        expect(etiquetaPeriodoDeclaracion({ impuesto: 'iso_trimestral', periodo_desde: '2026-10-01' })).toBe('4.º trimestre 2026')
        expect(etiquetaPeriodoDeclaracion({ impuesto: 'isr_anual', periodo_desde: '2025-01-01' })).toBe('año 2025')
        expect([periodoPorDeclarar('isr_trimestral', '2026-10-15'), periodoPorDeclarar('iso_trimestral', '2026-02-10'), periodoPorDeclarar('isr_anual', '2026-03-01'), periodoPorDeclarar('retenciones_iva', '2026-10-15')]).toEqual(['2026-T3', '2025-T4', '2025', '2026-09'])
        expect(etiquetaPeriodoTexto('2026-T3')).toBe('3.er trimestre 2026')
        expect(seccionesTotales('isr_anual').map(s => s.id)).toEqual(['renta', 'determinado', 'acreditamientos', 'liquidacion'])
        expect(seccionesTotales('retenciones_isr').flatMap(s => s.filas.map(f => f.clave))).toEqual(['base', 'retenido', 'a_pagar'])
        expect(seccionesTotales('iso_trimestral').flatMap(s => s.filas.map(f => f.clave))).toContain('base_activo')
        expect([CLAVE_DETERMINADO.isr_trimestral, CLAVE_DETERMINADO.retenciones_iva, formularioImpuesto('retenciones_isr')]).toEqual(['isr', 'retenido', 'formulario por confirmar'])
        expect([sinAsiento('isr_anual'), sinAsiento('retenciones_iva'), sinAsiento('isr_trimestral')]).toEqual([true, true, false])
        expect(efectoRevision('retenciones_iva', 'agosto 2026').titulo).toBe('Revisar bloquea los impuestos del mes (sin asiento)')
        expect(efectoRevision('isr_trimestral', '3.er trimestre 2026').puntos.join(' ')).toContain('No fija el bloqueo de impuestos')
        expect(accionesDeclaracion({ estado: 'presentada', pago: { id: 1, fecha: '2026-08-20', impuesto: '1.00', mora: '0.00', multa: '0.00', total: '1.00', dias_atraso: 0, boleta: null, asiento_id: 1, registrado_por: 1, created_at: '2026-08-20T00:00:00Z' }, totales: { a_pagar: '1.00' } })).toMatchObject({ pagar: false, anularPago: true })
        const noSoportada = { type: 'urn:argosisp:problema:regla_no_soportada', title: 'x', status: 422, detail: 'Solo se calcula el ISO acreditable al ISR (iso_a_isr)', errors: [{ field: 'iso_acreditamiento', message: 'Valor "isr_a_iso"', rule: 'regla_no_soportada' }] }
        expect(reglaNoSoportadaDe(noSoportada)).toEqual({ parametro: 'iso_acreditamiento', valor: '"isr_a_iso"', explicacion: 'Solo se calcula el ISO acreditable al ISR (iso_a_isr)' })
        expect(problemaDeclaracionLegible(noSoportada).title).toBe('El sistema todavía no calcula esa regla')

        const calcular = esquemaCalcularDeclaracion('2026-10-15')
        expect(calcular.safeParse({ impuesto: 'isr_trimestral', periodo: '2026-T3', sustitutiva: false }).success).toBe(true)
        expect(calcular.safeParse({ impuesto: 'isr_trimestral', periodo: '2026-09', sustitutiva: false }).error?.issues[0]?.message).toBe('Elige el año y el trimestre')
        expect(calcular.safeParse({ impuesto: 'isr_anual', periodo: '2027', sustitutiva: false }).error?.issues[0]?.message).toBe('El periodo no puede ser futuro')
        const anular = esquemaAnularPago('2026-10-15', '2026-08-20')
        expect(anular.safeParse({ motivo: 'Pagado dos veces', fecha: '' }).data).toEqual({ motivo: 'Pagado dos veces' })
        expect(anular.safeParse({ motivo: 'Pagado dos veces', fecha: '2026-08-19' }).error?.issues[0]?.message).toContain('anterior al pago')
        expect(esquemaAjusteFiscal.safeParse({ anio: 2026, trimestre: null, efecto: 'resta', concepto: 'Intereses', monto: '0' }).error?.issues[0]?.path).toEqual(['monto'])
        expect(esquemaAjusteFiscal.safeParse({ anio: 2026, trimestre: 3, efecto: 'suma', concepto: 'Multas', monto: '125.5' }).data).toEqual({ anio: 2026, trimestre: 3, efecto: 'suma', concepto: 'Multas', monto: '125.50' })
        expect(esquemaIsrManual.safeParse({ monto: '100.00', acreditado_trimestral: '80.00', acreditado_iso: '30.00', nota: '' }).error?.issues[0]?.path).toEqual(['acreditado_trimestral'])
        expect(esquemaIsrManual.safeParse({ monto: '0', acreditado_trimestral: '', acreditado_iso: '', nota: '' }).data).toEqual({ monto: '0.00', nota: null })
    })

    it('API de los fixtures: ISR trimestral y anual, ISO, retenciones, pago anulado, ajustes y cuentas de pago', async () => {
        const d = useDeclaraciones()
        const trimestral = await d.calcular({ impuesto: 'isr_trimestral', periodo: '2026-T3' }, nuevaClaveIdempotencia())
        if (!trimestral.ok) {
            throw new Error(trimestral.problema.title)
        }
        // Renta presunta: 8 % de las ventas gravadas del trimestre (34,400.00) × 25 %.
        expect([trimestral.data.periodo_desde, trimestral.data.periodo_hasta, trimestral.data.totales.renta_imponible, trimestral.data.totales.a_pagar, trimestral.data.detalle.notas?.length, trimestral.data.formulario, trimestral.data.calculada_por_nombre]).toEqual(['2026-07-01', '2026-09-30', '2752.00', '688.00', 2, 'SAT-1361', 'Ana Administradora'])
        const bloqueos = bd.bloqueosLibro.length
        const revisada = await d.revisar(trimestral.data.id, nuevaClaveIdempotencia())
        expect(revisada.ok && [revisada.data.estado, revisada.data.asiento_id !== null, revisada.data.cascada, revisada.data.revisada_por_nombre]).toEqual(['revisada', true, [], 'Ana Administradora'])
        expect(bd.bloqueosLibro.length).toBe(bloqueos)

        const formato = await d.calcular({ impuesto: 'isr_trimestral', periodo: '2026-09' }, nuevaClaveIdempotencia())
        expect(!formato.ok && formato.problema.status).toBe(422)
        const iso = await d.calcular({ impuesto: 'iso_trimestral', periodo: '2026-T3' }, nuevaClaveIdempotencia())
        expect(!iso.ok && [codigoProblema(iso.problema), iso.problema.errors?.[0]?.field]).toEqual(['parametro_sin_confirmar', 'iso_base_periodo'])

        // ISR anual 2026: resultado del libro ± el ajuste vigente (resta 350.00), menos el trimestral revisado.
        const anual = await d.calcular({ impuesto: 'isr_anual', periodo: '2026' }, nuevaClaveIdempotencia())
        expect(anual.ok && [anual.data.totales.renta_imponible, anual.data.totales.isr, anual.data.totales.pagos_trimestrales, anual.data.totales.a_pagar, anual.data.detalle.calculo?.map(c => c.seccion)]).toEqual(['34710.66', '8677.67', '688.00', '7989.67', ['resultados', 'resultados', 'resultados', 'resultados', 'ajustes', 'declaraciones']])
        const enCurso = anual.ok ? await d.revisar(anual.data.id, nuevaClaveIdempotencia()) : null
        expect(enCurso && !enCurso.ok && codigoProblema(enCurso.problema)).toBe('periodo_en_curso')

        // Retenciones de ISR de septiembre: sin asiento, con check y bloqueo de impuestos.
        const ret = await d.calcular({ impuesto: 'retenciones_isr', periodo: '2026-09' }, nuevaClaveIdempotencia())
        const retRevisada = ret.ok ? await d.revisar(ret.data.id, nuevaClaveIdempotencia()) : null
        expect(retRevisada?.ok && [retRevisada.data.totales.retenido, retRevisada.data.asiento_id, retRevisada.data.formulario]).toEqual(['300.00', null, null])
        expect(bd.bloqueosLibro.filter(b => b.empresa_id === 1 && b.tipo === 'impuestos').at(-1)?.hasta).toBe('2026-09-30')
        expect(bd.checksCierre.filter(c => c.periodo === '2026-09-01' && c.clave === 'retenciones_cuadradas').map(c => c.resultado)).toEqual(['ok'])

        // Anular el pago de julio y registrar otro: lo pagado no cuenta el anulado.
        const fechaAntes = await d.anularPago(1, { motivo: 'Boleta equivocada', fecha: '2026-08-19' }, nuevaClaveIdempotencia())
        expect(!fechaAntes.ok && fechaAntes.problema.errors?.[0]?.field).toBe('fecha')
        const anulado = await d.anularPago(1, { motivo: 'Boleta equivocada' }, nuevaClaveIdempotencia())
        expect(anulado.ok && [anulado.data.pago, anulado.data.pagos_anulados?.map(p => [p.id, p.anulacion.motivo, p.anulacion.anulado_por_nombre])]).toEqual([null, [[1, 'Boleta equivocada', 'Ana Administradora']]])
        const otraVez = await d.anularPago(1, { motivo: 'Otra vez' }, nuevaClaveIdempotencia())
        expect(!otraVez.ok && codigoProblema(otraVez.problema)).toBe('declaracion_sin_pago')
        const nuevo = await d.registrarPago(1, { metodo: 'banco', fecha: '2026-08-21' }, nuevaClaveIdempotencia())
        expect(nuevo.ok && [nuevo.data.pago?.impuesto, nuevo.data.pagos_anulados?.length]).toEqual(['1206.00', 1])

        // Ajustes: alta trimestral, anular uno vigente (otra fila) y 409 si ya estaba anulado o el año está cerrado.
        const ajustes = await d.ajustes(2026)
        expect(ajustes.ok && ajustes.data.map(a => [a.id, a.anula_a, a.anulado_por_ajuste])).toEqual([[1, null, 2], [2, 1, null], [3, null, null]])
        const alta = await d.ajustar({ anio: 2026, trimestre: 3, efecto: 'suma', concepto: 'Multas no deducibles', monto: '125.50' }, nuevaClaveIdempotencia())
        expect(alta.ok && [alta.data.trimestre, alta.data.monto]).toEqual([3, '125.50'])
        const anula = await d.ajustar({ anula_a: 3, concepto: 'No eran exentos' }, nuevaClaveIdempotencia())
        expect(anula.ok && [anula.data.anula_a, bd.ajustesFiscales.find(a => a.id === 3)?.anulado_por_ajuste]).toEqual([3, anula.ok ? anula.data.id : 0])
        const repetida = await d.ajustar({ anula_a: 1, concepto: 'Otra vez' }, nuevaClaveIdempotencia())
        expect(!repetida.ok && codigoProblema(repetida.problema)).toBe('ajuste_anulado')
        const cerrado = await d.ajustar({ anio: 2024, efecto: 'suma', concepto: 'Tarde', monto: '10.00' }, nuevaClaveIdempotencia())
        expect(!cerrado.ok && codigoProblema(cerrado.problema)).toBe('ejercicio_cerrado')
        // El ajuste anulado desactualiza el ISR anual de 2026.
        const ficha = anual.ok ? await d.ver(anual.data.id) : null
        expect(ficha?.ok && ficha.data.desactualizada).toBe(true)

        const cuentas = await d.cuentasPago()
        expect(cuentas.ok && cuentas.data.map(b => b.id)).toEqual([1, 2])
        expect(bd.acciones.filter(a => ['declaraciones.anular_pago', 'declaraciones.ajustar'].includes(a.accion)).map(a => a.accion)).toEqual(['declaraciones.anular_pago', 'declaraciones.ajustar', 'declaraciones.ajustar'])
    })

    it('cierre anual: el ISR sale de la declaración (sin pedirlo), sin revisar 422, manual sin declaración y reapertura', async () => {
        const e = useEjercicios()
        const conIsr = await e.cerrar({ anio: 2025, isr: { monto: '100.00' } }, nuevaClaveIdempotencia())
        expect(!conIsr.ok && codigoProblema(conIsr.problema)).toBe('isr_de_declaracion')
        const sustitutiva = await useDeclaraciones().calcular({ impuesto: 'isr_anual', periodo: '2025', sustitutiva: true }, nuevaClaveIdempotencia())
        expect(sustitutiva.ok && sustitutiva.data.version).toBe(2)
        const sinRevisar = await e.cerrar({ anio: 2025 }, nuevaClaveIdempotencia())
        expect(!sinRevisar.ok && codigoProblema(sinRevisar.problema)).toBe('declaracion_sin_revisar')
        const revisada = sustitutiva.ok ? await useDeclaraciones().revisar(sustitutiva.data.id, nuevaClaveIdempotencia()) : null
        expect(revisada?.ok && revisada.data.asiento_id).toBeNull()
        const cierre = await e.cerrar({ anio: 2025 }, nuevaClaveIdempotencia())
        expect(cierre.ok && [cierre.data.isr, cierre.data.resultado_antes_isr, cierre.data.resultado, cierre.data.reserva_legal, cierre.data.isr_nota]).toEqual(['12500.00', '46000.00', '33500.00', '1675.00', 'Declaración ISR anual 2025, versión 2'])
        const recalcular = await useDeclaraciones().calcular({ impuesto: 'isr_anual', periodo: '2025', sustitutiva: true }, nuevaClaveIdempotencia())
        expect(!recalcular.ok && codigoProblema(recalcular.problema)).toBe('ejercicio_cerrado')
        const fueraDeOrden = await e.reabrir({ anio: 2024, motivo: 'Corrección' }, nuevaClaveIdempotencia())
        expect(!fueraDeOrden.ok && codigoProblema(fueraDeOrden.problema)).toBe('reapertura_fuera_de_orden')
        const reabierto = await e.reabrir({ anio: 2025, motivo: 'Falta una factura' }, nuevaClaveIdempotencia())
        expect(reabierto.ok && [reabierto.data.estado, reabierto.data.motivo_reapertura]).toEqual(['reabierto', 'Falta una factura'])
        const enCurso = await e.cerrar({ anio: 2026, isr: { monto: '0.00' } }, nuevaClaveIdempotencia())
        // 2025 quedó reabierto: también falta cerrar el año anterior.
        expect(!enCurso.ok && enCurso.problema.errors?.map(x => x.rule)).toEqual(['meses_abiertos', 'ejercicio_anterior_abierto'])

        useEmpresaActiva().elegir(2)
        const sinMonto = await e.cerrar({ anio: 2025 }, nuevaClaveIdempotencia())
        expect(!sinMonto.ok && sinMonto.problema.errors?.[0]?.field).toBe('isr.monto')
        const manual = await e.cerrar({ anio: 2025, isr: { monto: '0.00' } }, nuevaClaveIdempotencia())
        expect(manual.ok && [manual.data.empresa_id, manual.data.isr]).toEqual([2, '0.00'])
    })

    it('ficha: notas a confirmar, cálculo por secciones, nombres, ajustes y sin checks en ISR; anular pago y registrar otro', async () => {
        const vista = await mountSuspended(PaginaDeclaracion, { route: '/declaraciones/5' })
        await esperar(() => expect(vista.find('[data-prueba="declaracion-notas"]').exists()).toBe(true))
        expect(vista.findAll('[data-prueba="declaracion-nota"]').length).toBe(4)
        expect(vista.find('[data-total="isr"]').text()).toContain('12,500.00')
        expect(vista.find('[data-prueba="tabla-calculo"]').text()).toContain('4.1.01 Servicios de internet')
        expect(vista.find('[data-prueba="declaracion-calculada"]').text()).toContain('Ana Administradora')
        expect(vista.find('[data-prueba="declaracion-ajustes"]').attributes('href')).toBe('/declaraciones/ajustes?anio=2025')
        expect(vista.find('#declaracion-checks').exists()).toBe(false)
        expect(vista.find('[data-prueba="declaracion-libros"]').exists()).toBe(false)

        const julio = await mountSuspended(PaginaDeclaracion, { route: '/declaraciones/1' })
        await esperar(() => expect(julio.find('[data-prueba="abrir-anular-pago"]').exists()).toBe(true))
        expect(julio.find('[data-prueba="abrir-pagar"]').exists()).toBe(false)
        await julio.find('[data-prueba="abrir-anular-pago"]').trigger('click')
        await esperar(() => expect(document.querySelector('[data-prueba="anular-pago-aviso"]')?.textContent).toContain('Se revierte el asiento del pago'))
        escribir('[data-prueba="anular-pago-motivo"] textarea, textarea[data-prueba="anular-pago-motivo"]', 'Boleta equivocada')
        expect(botonDelDialogo('Anular pago')?.disabled).toBe(true)
        marcar()
        await esperar(() => expect(botonDelDialogo('Anular pago')?.disabled).toBe(false))
        botonDelDialogo('Anular pago')?.click()
        await esperar(() => expect(julio.find('[data-prueba="declaracion-pagos-anulados"]').text()).toContain('Boleta equivocada'))
        expect(julio.find('[data-prueba="abrir-pagar"]').exists()).toBe(true)
    })

    it('calcular trimestral, ajustes, ejercicios y el calendario que lleva a calcular', async () => {
        const lista = await mountSuspended(PaginaDeclaraciones, { route: '/declaraciones?calcular=isr_trimestral&periodo=2026-T3' })
        await esperar(() => expect(document.querySelector('[data-prueba="calcular-trimestre"]')).not.toBeNull())
        botonDelDialogo('Calcular')?.click()
        await esperar(() => expect(useRoute().path).toMatch(/^\/declaraciones\/\d+$/))
        expect(bd.declaraciones.at(-1)).toMatchObject({ impuesto: 'isr_trimestral', periodo_desde: '2026-07-01' })
        lista.unmount()

        const ajustes = await mountSuspended(PaginaAjustes, { route: '/declaraciones/ajustes?anio=2026' })
        await esperar(() => expect(ajustes.findAll('[data-ajuste]').length).toBe(3))
        expect(ajustes.find('[data-ajuste="1"] [data-prueba="ajuste-anulado"]').exists()).toBe(true)
        await ajustes.find('[data-prueba="abrir-ajuste"]').trigger('click')
        await esperar(() => expect(document.querySelector('[data-prueba="ajuste-monto"]')).not.toBeNull())
        escribir('[data-prueba="ajuste-monto"] input, input[data-prueba="ajuste-monto"]', '200')
        escribir('[data-prueba="ajuste-concepto"] textarea, textarea[data-prueba="ajuste-concepto"]', 'Gastos sin factura')
        botonDelDialogo('Registrar ajuste')?.click()
        await esperar(() => expect(ajustes.findAll('[data-ajuste]').length).toBe(4))
        ajustes.unmount()

        const libro = await mountSuspended(PaginaLibro, { route: '/libro?tab=ejercicios' })
        await esperar(() => expect(libro.find('[data-ejercicio="2024"]').exists()).toBe(true))
        await libro.find('[data-prueba="abrir-cerrar-ejercicio"]').trigger('click')
        await esperar(() => expect(document.querySelector('[data-prueba="cerrar-isr-declaracion"]')?.textContent).toContain('El ISR sale de la declaración ISR anual 2025'))
        expect(document.querySelector('[data-prueba="cerrar-isr-manual"]')).toBeNull()
        marcar()
        await esperar(() => expect(botonDelDialogo('Cerrar 2025')?.disabled).toBe(false))
        botonDelDialogo('Cerrar 2025')?.click()
        await esperar(() => expect(libro.find('[data-ejercicio="2025"]').attributes('data-estado')).toBe('cerrado'))
        expect(libro.find('[data-ejercicio="2025"] [data-prueba="ejercicio-isr-nota"]').text()).toContain('Declaración ISR anual 2025')
        libro.unmount()

        // El ISR trimestral ya enlaza su declaración; el ISO del mismo trimestre lleva a calcularlo.
        await mountSuspended(PaginaCalendario, { route: '/fiscal/calendario?obligacion=11' })
        await esperar(() => expect(document.querySelector('[data-prueba="detalle-calcular"]')?.getAttribute('href')).toBe('/declaraciones?calcular=iso_trimestral&periodo=2026-T3'))
    })
})
