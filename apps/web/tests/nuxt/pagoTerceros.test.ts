import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import ClienteResponsablePago from '~/components/ClienteResponsablePago.vue'
import ReciboPago from '~/components/ReciboPago.vue'
import PaginaCobro from '~/pages/cobro/index.vue'

/**
 * Pago de terceros y responsable de pago (día 4). En los fixtures, Carlos Enrique Monterroso (10)
 * es responsable de pago de Andrea Paola Gómez (12, suspendida) y Silvia Patricia Orellana (17).
 */
describe('pago de terceros y responsable de pago', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
    })

    afterEach(() => {
        sesionFixture(null)
    })

    it('separa "pagado por" de la descripción del movimiento', () => {
        expect(separarPagadoPor('Transferencia · aviso 120 · pagado por Carlos Enrique Monterroso')).toEqual({
            concepto: 'Transferencia · aviso 120',
            pagadoPor: 'Carlos Enrique Monterroso',
        })
        expect(separarPagadoPor('Efectivo · aviso 3')).toEqual({ concepto: 'Efectivo · aviso 3', pagadoPor: null })
        expect(separarPagadoPor('Efectivo · pagado por ')).toEqual({ concepto: 'Efectivo · pagado por ', pagadoPor: null })
    })

    it('useClientes: dependientes, asignar (422 por nivel) y quitar responsable', async () => {
        const deps = await useClientes().dependientes(10)
        expect(deps.ok && deps.data.data.map(d => d.id).sort()).toEqual([12, 17])

        // Un dependiente no puede ser responsable: segundo nivel → 422 en responsable_id.
        const nivel = await useClientes().asignarResponsable(1, 12, 'La hermana paga', nuevaClaveIdempotencia())
        expect(!nivel.ok && nivel.problema.errors?.[0]?.field).toBe('responsable_id')

        const asignado = await useClientes().asignarResponsable(1, 10, 'El papá paga el servicio', nuevaClaveIdempotencia())
        expect(asignado.ok && asignado.data.responsable_pago_nombre).toBe('Carlos Enrique Monterroso')

        const quitado = await useClientes().quitarResponsable(1, 'Ahora paga por su cuenta', nuevaClaveIdempotencia())
        expect(quitado.ok && quitado.data.responsable_pago_id).toBeNull()
    })

    it('la ficha muestra quién paga y de quiénes es responsable', async () => {
        const dependiente = await useClientes().ver(12)
        const responsable = await useClientes().ver(10)
        if (!dependiente.ok || !responsable.ok) {
            throw new Error('fixtures sin clientes 10 y 12')
        }
        const ficha = await mountSuspended(ClienteResponsablePago, { props: { cliente: dependiente.data } })
        expect(ficha.get('[data-prueba="responsable-actual"]').text()).toContain('Carlos Enrique Monterroso')

        const fichaResponsable = await mountSuspended(ClienteResponsablePago, { props: { cliente: responsable.data } })
        await vi.waitFor(() => expect(fichaResponsable.findAll('[data-dependiente]')).toHaveLength(2))
        expect(fichaResponsable.text()).toContain('Responsable de pago de:')
    })

    it('el cobro carga solas las facturas de los dependientes y el pago las cubre', async () => {
        const vista = await mountSuspended(PaginaCobro, { route: '/cobro?cliente=10' })
        await vi.waitFor(() => expect(vista.find('[data-grupo="12"]').exists()).toBe(true))
        expect(vista.get('[data-grupo="12"]').text()).toContain('Responsable de pago de:')

        const cuenta = await useClientes().estadoCuenta(12)
        const pendientes = cuenta.ok ? cuenta.data.facturas_pendientes : []
        expect(pendientes.length).toBeGreaterThan(0)

        const pago = await usePagos().registrar({
            cliente_id: 10,
            metodo: 'caja',
            monto: '2000.00',
            facturas: pendientes.map(f => f.id),
        }, nuevaClaveIdempotencia())
        expect(pago.ok).toBe(true)
        if (!pago.ok) {
            return
        }
        expect(pago.data.aplicaciones.filter(a => a.cliente_id === 12).map(a => a.cliente_nombre)).toContain('Andrea Paola Gómez')
        expect(pago.data.servicios?.some(s => s.cambiado && s.estado === 'activo')).toBe(true)

        const despues = await useClientes().estadoCuenta(12)
        expect(despues.ok && despues.data.movimientos.some(m => separarPagadoPor(m.descripcion).pagadoPor === 'Carlos Enrique Monterroso')).toBe(true)
    })

    it('el recibo agrupa las facturas por dueño y nombra al dueño del servicio reactivado', async () => {
        const pagador = await useClientes().ver(10)
        const servicios = await useServicios().listar({ cliente_id: 12 })
        if (!pagador.ok || !servicios.ok) {
            throw new Error('fixtures incompletos')
        }
        const servicio = { ...servicios.data.data[0]!, estado: 'activo' as const, cliente_nombre: 'Andrea Paola Gómez' }
        const recibo = await mountSuspended(ReciboPago, {
            props: {
                cliente: pagador.data,
                pago: {
                    id: 900, empresa_id: 1, cobro_id: null, cliente_id: 10, metodo: 'caja', monto: '150.00', comision: '0.00', pasarela: null, referencia: null, caja_id: null, estado: 'registrado', nota: null,
                    registrado_por: 1, version: 1, created_at: '2026-10-16T15:00:00.000Z', updated_at: '2026-10-16T15:00:00.000Z', anulado_en: null, motivo_anulacion: null,
                    banco_origen_id: null, banco_origen_nombre: null, cuenta_bancaria_id: null, cuenta_bancaria_nombre: null,
                    aplicaciones: [{ factura_id: 501, monto: '150.00', cliente_id: 12, cliente_nombre: 'Andrea Paola Gómez' }],
                },
                reactivados: [servicio],
            },
        })
        expect(recibo.get('[data-recibo-cliente="12"]').text()).toContain('Andrea Paola Gómez · pagado por Carlos Enrique Monterroso')
        expect(recibo.get('[data-prueba="recibo-reactivado"]').text()).toContain('Andrea Paola Gómez')
    })

    it('en pantalla: marcar el grupo del dependiente suma "de otros clientes" y tras el pago no quedan marcadas', async () => {
        const vista = await mountSuspended(PaginaCobro, { route: '/cobro?cliente=10' })
        await vi.waitFor(() => expect(vista.find('[data-grupo="12"] button[role="checkbox"]').exists()).toBe(true))
        await vista.get('[data-grupo="12"] button[role="checkbox"]').trigger('click')
        await vi.waitFor(() => expect(vista.get('[data-prueba="total-marcadas"]').text()).toMatch(/de otros clientes \(Q [\d,]+\.\d{2}\)/))

        await vista.get('form').trigger('submit')
        await vi.waitFor(() => expect(vista.find('article[aria-label="Recibo de pago"]').exists()).toBe(true))
        expect(vista.get('article[aria-label="Recibo de pago"]').text()).toContain('pagado por Carlos Enrique Monterroso')
        await vi.waitFor(() => expect(vista.find('[data-prueba="total-marcadas"]').exists()).toBe(false))
    })
})
