import { mountSuspended } from '@nuxt/test-utils/runtime'
import Decimal from 'decimal.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import ClienteEstadoCuenta from '~/components/ClienteEstadoCuenta.vue'
import PaginaFactura from '~/pages/facturas/[id].vue'
import { esperar } from '../ayudas/esperar'

/**
 * Decisión B (A3, `a3.md`): el saldo pequeño que deja un pago se cierra como gasto (asiento
 * `diferencia_cobro`, 5.3.05 / CxC). `POST /pagos/:id/cerrar-diferencia` responde `diferencias[]`;
 * la factura queda `pagada` con `pagado < total` (el panel no le muestra saldo); el estado de
 * cuenta trae el movimiento `diferencia_cobro` y anular el pago lo revierte.
 */
describe('decisión B · diferencia de cobro como gasto', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    it('saldo de una factura: manda el estado (pagada o acreditada no deben nada)', () => {
        expect(saldoFactura({ total: '150.00', pagado: '149.67', estado: 'pagada' }).toFixed(2)).toBe('0.00')
        expect(saldoFactura({ total: '150.00', pagado: '0.00', estado: 'acreditada' }).toFixed(2)).toBe('0.00')
        expect(saldoFactura({ total: '150.00', pagado: '149.67', estado: 'parcial' }).toFixed(2)).toBe('0.33')
        expect(saldoFactura({ total: '150.00', pagado: '20.00' }).toFixed(2)).toBe('130.00')
        expect(pendienteDeFacturas([
            { total: '150.00', pagado: '149.67', estado: 'pagada' },
            { total: '100.00', pagado: '40.00', estado: 'parcial' },
        ]).toFixed(2)).toBe('60.00')
    })

    it('origen del asiento: diferencia_cobro con etiqueta propia; uno desconocido no rompe', () => {
        expect(origenAsiento('diferencia_cobro')).toEqual({ etiqueta: 'Diferencia de cobro', icono: 'i-lucide-scissors' })
        expect(origenAsiento('pago').etiqueta).toBe('Pago')
        expect(origenAsiento('otro_origen').etiqueta).toBe('Otro origen')
    })

    async function pagoConDiferencia() {
        const factura = bd.facturas.find(f => f.estado === 'emitida' && (f.empresa_id ?? 1) === 1 && new Decimal(f.pagado).isZero())
        if (!factura) {
            throw new Error('sin factura emitida')
        }
        const pagado = new Decimal(factura.total).minus('0.33').toFixed(2)
        const pago = await usePagos().registrar({ cliente_id: factura.cliente_id, metodo: 'caja', caja_id: 2, monto: pagado, facturas: [factura.id] }, nuevaClaveIdempotencia())
        if (!pago.ok) {
            throw new Error('no se registró el pago')
        }
        return { factura, pago: pago.data, pagado }
    }

    it('cerrar: diferencias[] con su asiento; la factura queda pagada sin cambiar pagado ni mostrar saldo', async () => {
        const { factura, pago, pagado } = await pagoConDiferencia()
        const cerrada = await usePagos().cerrarDiferencia(pago.id, 'Redondeo', nuevaClaveIdempotencia())
        expect(cerrada.ok).toBe(true)
        if (!cerrada.ok) {
            return
        }
        expect(cerrada.data).toMatchObject({ pago_id: pago.id, monto: '0.33', tope: '1.00' })
        expect(cerrada.data.diferencias).toHaveLength(1)
        expect(cerrada.data.diferencias[0]).toMatchObject({ factura_id: factura.id, monto: '0.33', diferencia_id: expect.any(Number), asiento_id: expect.any(Number) })
        expect(cerrada.data).not.toHaveProperty('notas')

        const leida = await useFacturas().ver(factura.id)
        expect(leida.ok && [leida.data.estado, leida.data.pagado]).toEqual(['pagada', pagado])

        const vista = await mountSuspended(PaginaFactura, { route: `/facturas/${factura.id}` })
        await esperar(() => expect(vista.find('[data-prueba="factura-estado"]').text()).toBe('Pagada'))
        expect(vista.find('[data-prueba="abrir-nota-credito"]').exists()).toBe(false)
        expect(vista.text()).not.toContain('Q 0.33')
        vista.unmount()
    })

    it('estado de cuenta: el movimiento diferencia_cobro abona y se ve como «Diferencia cerrada (gasto)»', async () => {
        const { factura, pago } = await pagoConDiferencia()
        const cerrada = await usePagos().cerrarDiferencia(pago.id, 'Redondeo', nuevaClaveIdempotencia())
        const diferenciaId = cerrada.ok ? cerrada.data.diferencias[0]?.diferencia_id : undefined

        const cuenta = await useClientes().estadoCuenta(factura.cliente_id)
        const movimiento = cuenta.ok ? cuenta.data.movimientos.find(m => m.tipo === 'diferencia_cobro') : undefined
        expect(movimiento).toMatchObject({ referencia_id: diferenciaId, cargo: '0.00', abono: '0.33' })
        expect(movimiento?.descripcion).toContain(`pago ${pago.id} en la factura ${factura.id}`)
        // Va después del pago que la dejó: su saldo acumulado ya descuenta el pago.
        const movimientos = cuenta.ok ? cuenta.data.movimientos : []
        expect(movimientos.at(-1)?.tipo).toBe('diferencia_cobro')
        expect(movimientos.at(-1)?.saldo).toBe(cuenta.ok ? cuenta.data.saldo : null)

        const vista = await mountSuspended(ClienteEstadoCuenta, { props: { clienteId: factura.cliente_id } })
        await esperar(() => expect(vista.find('[data-prueba="movimiento-diferencia"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="movimiento-diferencia"]').text()).toBe('Diferencia cerrada (gasto)')
        vista.unmount()
    })

    it('anular el pago revierte la diferencia: la factura vuelve a deber y el movimiento se va', async () => {
        const { factura, pago } = await pagoConDiferencia()
        await usePagos().cerrarDiferencia(pago.id, 'Redondeo', nuevaClaveIdempotencia())
        const anulado = await usePagos().anular(pago.id, 'Pago duplicado', nuevaClaveIdempotencia())
        expect(anulado.ok).toBe(true)

        const leida = await useFacturas().ver(factura.id)
        expect(leida.ok && leida.data.estado).not.toBe('pagada')
        expect(leida.ok && saldoFactura(leida.data).toFixed(2)).toBe(new Decimal(factura.total).toFixed(2))
        const cuenta = await useClientes().estadoCuenta(factura.cliente_id)
        expect(cuenta.ok && cuenta.data.movimientos.some(m => m.tipo === 'diferencia_cobro')).toBe(false)
    })
})
