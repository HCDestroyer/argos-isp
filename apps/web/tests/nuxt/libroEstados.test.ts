import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import Decimal from 'decimal.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import PaginaLibro from '~/pages/libro/index.vue'
import { esperar } from '../ayudas/esperar'

/**
 * Balance de saldos y estado de resultados por empresa (A3): una sección por empresa y el total
 * del grupo con "Todas"; con una empresa elegida, solo la suya.
 */
describe('libro · balance y estado de resultados por empresa', () => {
    beforeEach(async () => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
        await flushPromises()
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
        localStorage.clear()
    })

    it('API: consolidado con una sección por empresa; cada una cuadra y el total es la suma', async () => {
        const balance = await useLibro().balance('2026-10-31')
        expect(balance.ok).toBe(true)
        if (!balance.ok) {
            return
        }
        expect(balance.data.consolidado).toBe(true)
        expect(balance.data.empresas.map(e => e.empresa_id)).toEqual([1, 2])
        expect(balance.data.empresas.every(e => e.totales.cuadra)).toBe(true)
        const suma = balance.data.empresas.reduce((s, e) => s.plus(e.totales.activo), new Decimal(0))
        expect(suma.toFixed(2)).toBe(balance.data.total.totales.activo)

        const resultados = await useLibro().estadoResultados('2026-01-01', '2026-10-31')
        expect(resultados.ok && resultados.data.empresas.every(e => e.cuentas.every(c => c.tipo === 'ingreso' || c.tipo === 'gasto'))).toBe(true)
    })

    it('API: con una empresa elegida, una sola sección igual al total', async () => {
        useEmpresaActiva().elegir(2)
        const balance = await useLibro().balance()
        expect(balance.ok && balance.data.consolidado).toBe(false)
        expect(balance.ok && balance.data.empresas.map(e => e.empresa_id)).toEqual([2])
        expect(balance.ok && balance.data.empresas[0]?.totales).toEqual(balance.ok && balance.data.total.totales)
    })

    it('en pantalla: pestaña Balance con el total del grupo y una sección por empresa', async () => {
        const vista = await mountSuspended(PaginaLibro, { route: '/libro?tab=balance' })
        await esperar(() => expect(vista.find('[data-prueba="total-grupo"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="libro-balance"] section[data-empresa="1"]').text()).toContain('ArgosNet')
        expect(vista.find('[data-prueba="libro-balance"] section[data-empresa="2"]').text()).toContain('Fibra del Sur')
        expect(vista.findAll('[data-prueba="cuadra"]').every(b => b.text() === 'Cuadra')).toBe(true)
    })

    it('en pantalla: pestaña Resultados muestra ingresos, gastos y resultado por empresa', async () => {
        const vista = await mountSuspended(PaginaLibro, { route: '/libro?tab=resultados' })
        await esperar(() => expect(vista.find('[data-prueba="libro-resultados"]').exists()).toBe(true))
        await esperar(() => expect(vista.find('[data-prueba="libro-resultados"]').text()).toMatch(/Estado de resultados|sin movimientos/))
        expect(vista.find('[data-prueba="cuadra"]').exists()).toBe(false)
    })
})
