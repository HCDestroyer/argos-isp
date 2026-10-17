import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import meCajero from '~~/fixtures/auth/me.cajero.json'
import { resumenDashboard } from '~~/fixtures/reportes/datos'
import PaginaInicio from '~/pages/index.vue'

describe('semana 2 · dashboard', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    it('series de 12 meses con el mes corto en el eje y el largo en el tooltip', () => {
        const series = seriesDashboard(resumenDashboard)
        expect(series.categorias).toHaveLength(12)
        expect(series.categorias.at(-1)).toBe('oct')
        expect(series.categoriasLargas.at(0)).toBe('noviembre 2025')
        expect(series.montos.map(s => s.id)).toEqual(['facturado', 'cobrado'])
        expect(series.montos[1]?.valores.at(-1)).toBe('61230.75')
        expect(series.conteos[0]?.valores.at(-1)).toBe(520)
    })

    it('pendiente del mes con decimal.js, nunca negativo, y porcentaje para la barra', () => {
        expect(pendienteMes({ facturado: '98450.00', cobrado: '61230.75' }).toFixed(2)).toBe('37219.25')
        expect(pendienteMes({ facturado: '100.10', cobrado: '120.00' }).toFixed(2)).toBe('0.00')
        expect(porcentajeCobranza(62.19)).toEqual({ texto: '62.19 %', barra: 62.19 })
        expect(porcentajeCobranza(130)).toEqual({ texto: '130 %', barra: 100 })
    })

    it('la actualización es la de la vista más vieja; null si ninguna se refrescó', () => {
        expect(actualizacionDashboard(resumenDashboard)).toBe('2026-10-16T17:31:45.000Z')
        expect(actualizacionDashboard({ actualizado_en: { resumen_mensual: null, resumen_cobros_diarios: null, resumen_servicios: null, resumen_cartera: null, resumen_promesas: null } })).toBeNull()
        expect(haySerie({ series: resumenDashboard.series.slice(0, 1) })).toBe(false)
        expect(haySerie(resumenDashboard)).toBe(true)
    })

    it('muestra los indicadores y las dos gráficas', async () => {
        const vista = await mountSuspended(PaginaInicio, { route: '/' })
        await vi.waitFor(() => expect(vista.find('[data-prueba="kpi-mes"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="servicios-activo"]').text()).toContain('412')
        expect(vista.find('[data-prueba="servicios-suspendido"]').text()).toContain('37')
        expect(vista.find('[data-prueba="servicios-limitado"]').text()).toContain('18')
        expect(vista.find('[data-prueba="kpi-mes"]').text()).toContain('Q 98,450.00')
        expect(vista.find('[data-prueba="kpi-mes"]').text()).toContain('62.19 %')
        expect(vista.find('[data-prueba="kpi-mes"]').text()).toContain('Q 37,219.25')
        expect(vista.find('[data-prueba="kpi-cartera"]').text()).toContain('Q 15,840.50')
        expect(vista.find('[data-prueba="kpi-cartera"]').text()).toContain('64 facturas · 41 clientes')
        expect(vista.find('[data-prueba="kpi-hoy"]').text()).toContain('19 pagos')
        expect(vista.find('[data-prueba="kpi-promesas"]').text()).toContain('Q 2,135.00')
        expect(vista.find('[data-prueba="grafica-montos"]').exists()).toBe(true)
        expect(vista.find('[data-prueba="grafica-conteos"]').exists()).toBe(true)
    })

    it('con error muestra el aviso con Reintentar y ninguna cifra', async () => {
        simularFalla('GET /api/v1/dashboard/resumen', 500)
        const vista = await mountSuspended(PaginaInicio, { route: '/' })
        await vi.waitFor(() => expect(vista.find('[data-prueba="tablero-error"]').exists()).toBe(true))
        expect(vista.text()).toContain('Reintentar')
        expect(vista.text()).not.toContain('Q ')
        expect(vista.find('[data-prueba="kpi-mes"]').exists()).toBe(false)
        expect(vista.find('[data-prueba="tablero-servicios"]').exists()).toBe(false)
    })

    it('sin reportes.ver no pide el resumen y solo muestra los accesos', async () => {
        sesionFixture('fixture-cajero')
        useUsuarioActual().value = meCajero
        const vista = await mountSuspended(PaginaInicio, { route: '/' })
        await vi.waitFor(() => expect(vista.text()).toContain('Accesos'))
        expect(vista.find('[data-prueba="tablero-servicios"]').exists()).toBe(false)
        expect(vista.find('[data-prueba="tablero-error"]').exists()).toBe(false)
    })
})
