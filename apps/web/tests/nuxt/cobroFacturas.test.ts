import Decimal from 'decimal.js'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Schema } from '@argosisp/contracts'
import { reiniciarFixtures } from '~~/fixtures'
import PaginaCobro from '~/pages/cobro/index.vue'

type Factura = Schema<'Factura'>

function factura(id: number, vence: string, total: string, pagado = '0.00', estado: Factura['estado'] = 'vencida'): Factura {
    return {
        id, cliente_id: 1, servicio_id: 1, periodo: `${vence.slice(0, 7)}-01`, clave_unica: `1-${id}`,
        emitida_en: `${vence.slice(0, 7)}-01T14:00:00.000Z`, vence_en: vence, estado,
        subtotal: total, iva: '0.00', total, pagado, fel_uuid: null, fel_serie: null, fel_numero: null, fel_estado: null,
        tipo: 'servicio', factura_origen_id: null, vencida_en: null, version: 1,
        created_at: '2026-09-01T14:00:00.000Z', updated_at: '2026-09-01T14:00:00.000Z',
    }
}

describe('cobro · elegir facturas (pedido del PM)', () => {
    const vieja = factura(1, '2026-09-10', '150.00')
    const media = factura(2, '2026-10-10', '150.00', '50.00', 'vencida')
    const nueva = factura(3, '2026-11-10', '150.00', '0.00', 'emitida')
    const todas = [vieja, media, nueva]

    beforeEach(() => {
        reiniciarFixtures()
        useNuxtApp().$tokenSesion.value = 'fixture-cajero'
    })

    afterEach(() => {
        useNuxtApp().$tokenSesion.value = null
    })

    it('por defecto las vencidas, y el monto es la suma de las marcadas', () => {
        const resumen = resumenPendiente(todas, '2026-10-15')
        const marcadas = marcadasPorDefecto(resumen, '2026-10-15')
        expect(marcadas).toEqual([1, 2])
        expect(sumaMarcadas(resumen.facturas, marcadas).toFixed(2)).toBe('250.00')
    })

    it('monto corto: avisa cuál queda parcial y cuál no recibe nada', () => {
        const d = distribuirPago(new Decimal('120.00'), todas, [1, 2])
        expect(d.parcial?.factura.id).toBe(1)
        expect(d.parcial?.aplicado.toFixed(2)).toBe('120.00')
        expect(d.sinCubrir.map(f => f.id)).toEqual([2])
        expect(d.excedente.isZero()).toBe(true)
    })

    it('monto de más: el resto va a las demás facturas y luego a saldo a favor', () => {
        const d = distribuirPago(new Decimal('450.00'), todas, [2, 1])
        expect(d.marcadas.map(l => [l.factura.id, l.aplicado.toFixed(2)])).toEqual([[2, '100.00'], [1, '150.00']])
        expect(d.excedente.toFixed(2)).toBe('200.00')
        expect(d.otras.map(l => [l.factura.id, l.aplicado.toFixed(2)])).toEqual([[3, '150.00']])
        expect(d.aFavor.toFixed(2)).toBe('50.00')
    })

    it('la API (fixtures) aplica en el orden de facturas[] y rechaza una sin saldo en facturas.<i>', async () => {
        const cobro = await usePagos().registrar({ cliente_id: 2, metodo: 'caja', monto: '150.00', facturas: [210, 209] }, nuevaClaveIdempotencia())
        expect(cobro.ok && cobro.data.aplicaciones).toEqual([{ factura_id: 210, monto: '150.00', cliente_id: 2, cliente_nombre: 'Juan Carlos Ramírez' }])

        const sinSaldo = await usePagos().registrar({ cliente_id: 2, metodo: 'caja', monto: '10.00', facturas: [209, 99999] }, nuevaClaveIdempotencia())
        expect(!sinSaldo.ok && sinSaldo.problema.errors?.[0]?.field).toBe('facturas.1')
    })

    it('la pantalla marca las vencidas, cambia el monto al desmarcar y avisa del parcial', async () => {
        const vista = await mountSuspended(PaginaCobro, { route: '/cobro?cliente=2' })
        await vi.waitFor(() => expect(vista.find('[data-factura="209"]').exists()).toBe(true))
        const monto = vista.get<HTMLInputElement>('input[inputmode="decimal"]')
        await vi.waitFor(() => expect(monto.element.value).toBe('300.00'))
        expect(vista.get('[data-prueba="total-marcadas"]').text()).toContain('2 marcadas')

        await vista.get('[data-factura="210"] button[role="checkbox"]').trigger('click')
        await vi.waitFor(() => expect(monto.element.value).toBe('150.00'))

        await monto.setValue('100.00')
        await vi.waitFor(() => expect(vista.find('[data-prueba="aviso-parcial"]').exists()).toBe(true))
        expect(vista.get('[data-prueba="aviso-parcial"]').text()).toContain('#209')

        await monto.setValue('200.00')
        await vi.waitFor(() => expect(vista.find('[data-prueba="aviso-excedente"]').exists()).toBe(true))
        expect(vista.get('[data-prueba="aviso-excedente"]').text()).toContain('#210')
    })
})
