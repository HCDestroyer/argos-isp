import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import meCajero from '~~/fixtures/auth/me.cajero.json'
import { bd } from '~~/fixtures/bd'
import { calcularVencimiento, PLAZOS } from '~~/fixtures/calendario/datos'
import PaginaCalendario from '~/pages/fiscal/calendario.vue'
import PaginaFiscal from '~/pages/configuracion/fiscal.vue'
import { esperar } from '../ayudas/esperar'
import { fijarHoyFixtures, soltarReloj } from '../ayudas/reloj'

/**
 * Calendario fiscal y feriados (A3, fase 7 PR A). Hoy es el jueves 15/10/2026 (`fijarHoyFixtures`).
 * ArgosNet: retenciones de ISR de agosto (10/09) y septiembre (sábado 10/10 → lunes 12/10) vencidas;
 * retenciones de IVA de septiembre al 21/10 (15.º día hábil); julio sin aplicar; IVA de julio y agosto
 * presentado. La tabla de feriados arranca vacía.
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

describe('calendario fiscal', () => {
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

    it('textos: periodo, plazo restante, motivos, regla y cuadrícula del mes', () => {
        expect(periodoObligacion({ periodicidad: 'mensual', periodo_desde: '2026-09-01' })).toBe('septiembre 2026')
        expect(periodoObligacion({ periodicidad: 'trimestral', periodo_desde: '2026-07-01' })).toBe('3.er trimestre 2026')
        expect(periodoObligacion({ periodicidad: 'trimestral', periodo_desde: '2026-10-01' })).toBe('4.º trimestre 2026')
        expect(periodoObligacion({ periodicidad: 'anual', periodo_desde: '2026-01-01' })).toBe('año 2026')
        expect([0, 1, 6, -1, -35].map(d => textoDiasRestantes({ estado: 'pendiente', dias_restantes: d }))).toEqual(['Vence hoy', 'Vence mañana', 'Faltan 6 días', 'Venció ayer', 'Venció hace 35 días'])
        expect(textoDiasRestantes({ estado: 'presentada', dias_restantes: -5 })).toBeNull()
        expect(colorDiasRestantes({ vencida: false, dias_restantes: 6 })).toBe('warning')
        expect(colorDiasRestantes({ vencida: true, dias_restantes: -3 })).toBe('error')
        expect(estadoVisible({ estado: 'pendiente', vencida: true }).etiqueta).toBe('Vencida')
        expect(estadoVisible({ estado: 'presentada', vencida: false })).toMatchObject({ etiqueta: 'Presentada', color: 'success' })
        expect(motivoObligacion('regimen_pequeno_contribuyente')).toContain('Pequeño contribuyente')
        expect(motivoObligacion('cuarto_trimestre_con_la_anual')).toBe('El cuarto trimestre se paga con la declaración anual')
        expect(motivoObligacion(null)).toBeNull()
        expect(textoPlazo({ dias: 15, dias_habiles: true })).toBe('15.º día hábil del mes siguiente')
        expect(textoPlazo({ dias: 10 })).toBe('Día 10 del mes siguiente')
        expect(textoPlazo({ vence: '03-31' })).toBe('El 31 de marzo del año siguiente')
        expect(textoPlazo({ plazo: 'mes_siguiente' })).toBe('Último día del mes siguiente al periodo')
        expect(reglaVencimiento({ vence_en: '2026-10-12', regla: { parametro: 'isr_retenciones_plazo', valor: { dias: 10 }, vence_base: '2026-10-10', corrido_a_habil: true } })).toMatchObject({ corrido: true, venceBase: '2026-10-10', parametro: 'isr_retenciones_plazo' })

        const octubre = semanasDelMes('2026-10')
        expect(octubre.length).toBe(5)
        expect(octubre[0]?.[0]).toMatchObject({ fecha: '2026-09-28', delMes: false })
        expect(octubre.at(-1)?.at(-1)).toMatchObject({ fecha: '2026-11-01', delMes: false, finDeSemana: true })
        expect([etiquetaMes('2026-10'), moverMes('2026-12', 1), moverMes('2026-01', -1)]).toEqual(['Octubre 2026', '2027-01', '2025-12'])
        expect(rangoMes('2026-02')).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' })
        expect(diaSemana('2026-10-10')).toBe('sábado')
    })

    it('esquemas espejo del validador de feriados y el vencimiento de los fixtures como la API', () => {
        expect(esquemaFeriado.safeParse({ fecha: '2026-10-20', nombre: 'Día de la Revolución', motivo: 'Decreto 19-2018' }).data).toEqual({ fecha: '2026-10-20', nombre: 'Día de la Revolución', activo: true, motivo: 'Decreto 19-2018' })
        expect(esquemaFeriado.safeParse({ fecha: '2026-10-20', nombre: 'Re', motivo: 'Decreto' }).error?.issues[0]?.path).toEqual(['nombre'])
        expect(esquemaFeriado.safeParse({ fecha: '20/10/2026', nombre: 'Revolución', motivo: 'Decreto' }).error?.issues[0]?.path).toEqual(['fecha'])
        expect(esquemaRetiroFeriado.safeParse({ motivo: 'no' }).success).toBe(false)

        const sinFeriados = new Set<string>()
        expect(calcularVencimiento('2026-09-30', PLAZOS.retenciones_iva, sinFeriados)).toEqual({ base: '2026-10-21', vence_en: '2026-10-21' })
        expect(calcularVencimiento('2026-09-30', PLAZOS.retenciones_iva, new Set(['2026-10-20']))).toEqual({ base: '2026-10-22', vence_en: '2026-10-22' })
        expect(calcularVencimiento('2026-09-30', PLAZOS.iva_mensual, sinFeriados)).toEqual({ base: '2026-10-31', vence_en: '2026-11-02' })
        expect(calcularVencimiento('2026-09-30', PLAZOS.retenciones_isr, sinFeriados)).toEqual({ base: '2026-10-10', vence_en: '2026-10-12' })
        expect(calcularVencimiento('2026-12-31', PLAZOS.isr_anual, sinFeriados)).toEqual({ base: '2027-03-31', vence_en: '2027-03-31' })
    })

    it('API de los fixtures: orden por vencimiento, filtros, consolidado, permisos y feriados con recálculo', async () => {
        const o = useObligacionesFiscales()
        const todas = await o.delRango('2026-01-01', '2027-12-31')
        expect(todas.ok && todas.data.every(x => x.empresa_id === 1)).toBe(true)
        const fechas = todas.ok ? todas.data.map(x => x.vence_en) : []
        expect(fechas).toEqual([...fechas].sort())
        const vencidas = await o.listar({ estado: ['pendiente'], hasta: '2026-10-14' })
        expect(vencidas.ok && vencidas.data.data.map(x => [x.id, x.dias_restantes, x.vencida])).toEqual([[5, -35, true], [8, -3, true]])
        const noAplica = await o.listar({ estado: ['no_aplica'] })
        expect(noAplica.ok && noAplica.data.data.map(x => x.motivo_estado)).toEqual(['sin_retenciones_isr', 'no_es_agente_retencion_iva'])
        const mal = await o.listar({ impuesto: ['iva_anual' as ImpuestoObligacion] })
        expect(!mal.ok && mal.problema.status).toBe(422)

        useEmpresaActiva().elegir('todas')
        const consolidado = await o.listar({ impuesto: ['pc_mensual'] })
        expect(consolidado.ok && consolidado.data.data.map(x => x.empresa_id)).toEqual([2, 2, 2])
        useEmpresaActiva().elegir(1)
        const ajena = await o.ver(18)
        expect(!ajena.ok && ajena.problema.status).toBe(403)

        // Feriado del 20/10: las retenciones de IVA de septiembre (15.º día hábil) corren al 22/10.
        const f = useFeriadosFiscales()
        const vacio = await f.listar(2026)
        expect(vacio.ok && [vacio.data.vigentes, vacio.data.historial]).toEqual([[], []])
        const alta = await f.agregar({ fecha: '2026-10-20', nombre: 'Día de la Revolución', motivo: 'Decreto 19-2018' }, nuevaClaveIdempotencia())
        expect(alta.ok && [alta.data.activo, alta.data.calendario.actualizadas, alta.data.calendario.empresas]).toEqual([true, 1, 2])
        const corrida = await o.ver(9)
        expect(corrida.ok && [corrida.data.vence_en, corrida.data.version, corrida.data.regla.vence_base]).toEqual(['2026-10-22', 2, '2026-10-22'])
        const duplicado = await f.agregar({ fecha: '2026-10-20', nombre: 'Día de la Revolución', motivo: 'Otra vez' }, nuevaClaveIdempotencia())
        expect(!duplicado.ok && [duplicado.problema.status, codigoProblema(duplicado.problema)]).toEqual([409, 'feriado_duplicado'])
        const sinNombre = await f.agregar({ fecha: '2026-10-21', motivo: 'Sin nombre' }, nuevaClaveIdempotencia())
        expect(!sinNombre.ok && sinNombre.problema.errors?.[0]?.field).toBe('nombre')
        const inexistente = await f.agregar({ fecha: '2026-10-21', activo: false, motivo: 'No era' }, nuevaClaveIdempotencia())
        expect(!inexistente.ok && codigoProblema(inexistente.problema)).toBe('feriado_inexistente')
        const retiro = await f.agregar({ fecha: '2026-10-20', activo: false, motivo: 'Error de captura' }, nuevaClaveIdempotencia())
        expect(retiro.ok && [retiro.data.activo, retiro.data.nombre]).toEqual([false, 'Día de la Revolución'])
        const despues = await f.listar(2026)
        expect(despues.ok && [despues.data.vigentes.length, despues.data.historial.map(h => h.activo)]).toEqual([0, [true, false]])
        const devuelta = await o.ver(9)
        expect(devuelta.ok && [devuelta.data.vence_en, devuelta.data.version]).toEqual(['2026-10-21', 3])
        expect(bd.acciones.filter(a => a.accion === 'fiscal.agregar_feriado').map(a => [a.entidad_tipo, a.empresa_id])).toEqual([['feriado', null], ['feriado', null]])

        // Sin alcance global: 403 alcance_global_requerido (el cajero ni siquiera tiene el permiso).
        sesionFixture('fixture-cajero')
        useUsuarioActual().value = meCajero
        const cajero = await o.listar()
        expect(!cajero.ok && cajero.problema.status).toBe(403)
    })

    it('mes: vencidas en rojo, plazo corto en ámbar, aviso de vencidas y detalle con el día corrido', async () => {
        const vista = await mountSuspended(PaginaCalendario, { route: '/fiscal/calendario' })
        await esperar(() => expect(vista.find('[data-prueba="calendario-mes"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="calendario-titulo-mes"]').text()).toBe('Octubre 2026')
        await esperar(() => expect(vista.find('[data-prueba="calendario-vencidas"]').text()).toContain('2 obligaciones vencidas sin presentar'))
        const vencida = vista.find('[data-fecha="2026-10-12"] [data-obligacion="8"]')
        expect(vencida.attributes('data-estado')).toBe('vencida')
        expect(vencida.attributes('aria-label')).toContain('Vencida')
        expect(vista.find('[data-fecha="2026-10-21"] [data-obligacion="9"]').attributes('data-estado')).toBe('pendiente')
        const agenda = vista.find('[data-prueba="calendario-agenda"]')
        expect(agenda.text()).toContain('Faltan 6 días')
        expect(agenda.text()).toContain('Venció hace 3 días')
        expect(agenda.text()).toContain('Formulario por confirmar')

        await vista.find('[data-agenda="8"]').trigger('click')
        await esperar(() => expect(document.querySelector('[data-prueba="detalle-corrido"]')?.textContent).toContain('Caía el sábado 10/10/2026 (inhábil): corrido al siguiente día hábil, 12/10/2026.'))
        expect(document.querySelector('[data-prueba="detalle-formulario-por-confirmar"]')).not.toBeNull()
        expect(useRoute().query.obligacion).toBe('8')

        // Julio: las que no aplican van atenuadas con su motivo.
        await vista.find('[data-prueba="mes-anterior"]').trigger('click')
        await vista.find('[data-prueba="mes-anterior"]').trigger('click')
        await esperar(() => expect(vista.find('[data-prueba="calendario-titulo-mes"]').text()).toBe('Agosto 2026'))
        await esperar(() => expect(vista.findAll('[data-prueba="agenda-motivo"]').map(m => m.text())).toEqual(['No hubo retenciones de ISR en el mes (según el libro)', 'La empresa no era agente de retención de IVA en ese periodo']))
        expect(vista.find('[data-obligacion="2"]').classes()).toContain('line-through')
        expect(vista.find('[data-fecha="2026-08-31"] [data-obligacion="1"]').attributes('data-estado')).toBe('presentada')
    })

    it('lista: filtros por estado e impuesto en la URL, motivo de las que no aplican y error visible con Reintentar', async () => {
        const vista = await mountSuspended(PaginaCalendario, { route: '/fiscal/calendario?vista=lista&estado=no_aplica' })
        await esperar(() => expect(vista.findAll('[data-prueba="fila-motivo"]').length).toBe(2))
        expect(vista.find('[data-prueba="tabla-obligaciones"] tbody tr').classes()).toContain('bg-elevated/50')

        simularFalla('GET /api/v1/fiscal/obligaciones', 500)
        const rota = await mountSuspended(PaginaCalendario, { route: '/fiscal/calendario' })
        await esperar(() => expect(rota.text()).toContain('Reintentar'))
        expect(rota.find('[data-prueba="calendario-mes"]').exists()).toBe(false)
        expect(rota.find('[data-prueba="calendario-vencidas"]').exists()).toBe(false)
    })

    it('Configuración → Fiscal → Feriados: vacía con «confirmar con contador», alta con aviso de recálculo y retiro', async () => {
        useEmpresaActiva().elegir('todas')
        const vista = await mountSuspended(PaginaFiscal, { route: '/configuracion/fiscal?pestana=feriados' })
        await esperar(() => expect(vista.find('[data-prueba="feriados-confirmar-contador"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="elegir-empresa"]').exists()).toBe(false)
        await esperar(() => expect(vista.find('[data-prueba="tabla-feriados"]').text()).toContain('Sin feriados en 2026'))

        await vista.find('[data-prueba="abrir-feriado"]').trigger('click')
        await esperar(() => expect(document.querySelector('[data-prueba="feriado-aviso-recalculo"]')?.textContent).toContain('Recalcula el calendario de todas las empresas'))
        escribir('[data-prueba="feriado-fecha"] input, input[data-prueba="feriado-fecha"]', '2026-10-20')
        escribir('[data-prueba="feriado-nombre"] input, input[data-prueba="feriado-nombre"]', 'Día de la Revolución')
        escribir('[data-prueba="feriado-motivo"] textarea, textarea[data-prueba="feriado-motivo"]', 'Decreto 19-2018')
        botonDelDialogo('Agregar y recalcular')?.click()
        await esperar(() => expect(vista.find('[data-feriado="2026-10-20"]').exists()).toBe(true))
        expect(bd.obligacionesFiscales.find(x => x.id === 9)?.vence_en).toBe('2026-10-22')
        expect(vista.find('[data-prueba="tabla-feriados-historial"]').text()).toContain('Agregado')

        await vista.find('button[aria-label="Retirar feriado del 20/10/2026"]').trigger('click')
        await esperar(() => expect(document.querySelector('[role="dialog"]')?.textContent).toContain('vuelve a ser hábil'))
        escribir('[data-prueba="feriado-motivo"] textarea, textarea[data-prueba="feriado-motivo"]', 'Captura repetida')
        botonDelDialogo('Retirar y recalcular')?.click()
        await esperar(() => expect(vista.find('[data-prueba="tabla-feriados-historial"]').text()).toContain('Retirado'))
        expect(vista.find('[data-feriado="2026-10-20"]').exists()).toBe(false)
        expect(bd.obligacionesFiscales.find(x => x.id === 9)?.vence_en).toBe('2026-10-21')
    })
})
