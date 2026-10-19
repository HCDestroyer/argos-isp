import Decimal from 'decimal.js'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import PaginaLibro from '~/pages/libro/index.vue'
import { esperar } from '../ayudas/esperar'

describe('tarea 15 · libro diario y mayor', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
    })

    afterEach(() => {
        sesionFixture(null)
    })

    it('diario: filtros por fecha contable y origen; cada asiento cuadra', async () => {
        const resultado = await useLibro().diario({ desde: '2026-10-01', hasta: '2026-10-31', origen_tipo: 'pago', limit: 200 })
        expect(resultado.ok).toBe(true)
        if (!resultado.ok) {
            return
        }
        expect(resultado.data.data.length).toBeGreaterThan(0)
        expect(resultado.data.data.every(a => a.origen_tipo === 'pago' && a.fecha >= '2026-10-01' && a.fecha <= '2026-10-31')).toBe(true)
        expect(resultado.data.data.every(a => cuadra(totalesPartida(a.movimientos)))).toBe(true)
        expect(cuadra(totalesAsientos(resultado.data.data))).toBe(true)
    })

    it('mayor de CxC: saldo inicial + movimientos del rango = saldo final', async () => {
        const cuentas = await useLibro().cuentas()
        const cxc = cuentas.ok ? cuentas.data.find(c => c.codigo === '1.1.03') : undefined
        expect(cxc?.auxiliar_cliente).toBe(true)
        const mayor = await useLibro().mayor({ cuenta_id: cxc?.id ?? 0, desde: '2026-10-01', limit: 200 })
        expect(mayor.ok).toBe(true)
        if (!mayor.ok) {
            return
        }
        const totales = totalesPartida(mayor.data.data)
        const esperado = new Decimal(mayor.data.saldo_inicial).plus(totales.debe).minus(totales.haber)
        expect(esperado.toFixed(2)).toBe(mayor.data.saldo_final)
        expect(mayor.data.data.at(-1)?.saldo).toBe(mayor.data.saldo_final)
    })

    it('mayor: auxiliar de un cliente y cuenta obligatoria', async () => {
        const auxiliar = await useLibro().mayor({ cuenta_id: 7, cliente_id: 2, limit: 200 })
        expect(auxiliar.ok && auxiliar.data.data.every(l => l.cliente_id === 2)).toBe(true)
        // El saldo del auxiliar del cliente 2 es lo que debe (Q 300.00 en fixtures).
        expect(auxiliar.ok && auxiliar.data.saldo_final).toBe('300.00')
    })

    it('la página muestra los totales Debe/Haber de la página y que cuadra', async () => {
        const vista = await mountSuspended(PaginaLibro, { route: '/libro?origen=factura' })
        await esperar(() => expect(vista.find('[data-prueba="totales-diario"]').exists()).toBe(true))
        const debe = vista.get('[data-prueba="diario-debe"]').text()
        expect(vista.get('[data-prueba="diario-haber"]').text()).toBe(debe)
        expect(vista.get('[data-prueba="totales-diario"]').text()).toContain('Cuadra')
    })

    it('el mayor abierto desde la URL respeta el auxiliar del cliente', async () => {
        const vista = await mountSuspended(PaginaLibro, { route: '/libro?tab=mayor&cuenta=7&cliente=2' })
        await esperar(() => expect(vista.find('[data-prueba="resumen-mayor"]').exists()).toBe(true))
        expect(vista.get('[data-prueba="resumen-mayor"]').text()).toContain('Q 300.00')
    })

    it('con el diario en error: aviso y "Reintentar", sin totales', async () => {
        simularFalla('GET /api/v1/libro/diario', 500)
        const vista = await mountSuspended(PaginaLibro, { route: '/libro' })
        await esperar(() => expect(vista.text()).toContain('Reintentar'))
        expect(vista.find('[data-prueba="totales-diario"]').exists()).toBe(false)
    })
})
