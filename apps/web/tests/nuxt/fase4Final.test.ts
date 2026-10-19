import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import meCajero from '~~/fixtures/auth/me.cajero.json'
import { bd } from '~~/fixtures/bd'
import { CAJA_SUR_ID, FACTURA_ACREDITADA_ID, FACTURA_CARGO_ID } from '~~/fixtures/facturacion/datos'
import PaginaCaja from '~/pages/caja/index.vue'
import PaginaFactura from '~/pages/facturas/[id].vue'
import PaginaFacturas from '~/pages/facturas/index.vue'
import PaginaPago from '~/pages/pagos/[id].vue'

/**
 * Fase 4 final de A3: factura `acreditada` (H16, aviso cubierto por notas internas sin cobro),
 * `tipo = 'cargo'` (H18, cargo interno no fiscal sin IVA), depósitos del turno legibles por el
 * cajero (`GET /bancos/depositos?turno_id=`) y `Pago.proveedor_cobro_nombre`.
 */
describe('fase 4 final · acreditada, cargo, depósitos del cajero y proveedor del pago', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    function comoCajero() {
        sesionFixture('fixture-cajero')
        useUsuarioActual().value = meCajero
    }

    it('estados y tipos con texto propio; uno desconocido, por su nombre', () => {
        expect(estadoFacturaVisual('acreditada').etiqueta).toBe('Acreditada')
        expect(estadoFacturaVisual('castigada').etiqueta).toBe('Castigada')
        expect(tipoFacturaVisual('servicio')).toBeNull()
        expect(tipoFacturaVisual(undefined)).toBeNull()
        expect(tipoFacturaVisual('mora')?.etiqueta).toBe('Recargo por mora')
        expect(tipoFacturaVisual('cargo')).toMatchObject({ etiqueta: 'Cargo interno', color: 'neutral' })
        expect(tipoFacturaVisual('ajuste_manual')?.etiqueta).toBe('Ajuste manual')
        expect(relacionOrigen('cargo')).toBe('diferencia de cobro de la')
        expect(relacionOrigen('mora')).toBe('mora de la')
    })

    it('la lista filtra por estado acreditada y muestra la insignia del cargo', async () => {
        const acreditadas = await useFacturas().listar({ estado: 'acreditada' })
        expect(acreditadas.ok && acreditadas.data.data.map(f => f.id)).toEqual([FACTURA_ACREDITADA_ID])
        const cargos = await useFacturas().listar({ tipo: 'cargo' })
        expect(cargos.ok && cargos.data.data.map(f => [f.id, f.iva, f.factura_origen_id])).toEqual([[FACTURA_CARGO_ID, '0.00', 1909]])

        const vista = await mountSuspended(PaginaFacturas, { route: '/facturas' })
        await vi.waitFor(() => expect(vista.find('[data-tipo="cargo"]').exists()).toBe(true))
        expect(vista.find('[data-tipo="cargo"]').text()).toBe('Cargo interno')
        vista.unmount()
    })

    it('ficha del cargo: insignia, origen enlazado, aviso no fiscal y sin certificación FEL', async () => {
        const vista = await mountSuspended(PaginaFactura, { route: `/facturas/${FACTURA_CARGO_ID}` })
        await vi.waitFor(() => expect(vista.find('[data-prueba="factura-no-fiscal"]').exists()).toBe(true))
        expect(vista.find('[data-tipo="cargo"]').text()).toBe('Cargo interno')
        expect(vista.find('[data-prueba="factura-no-fiscal"]').text()).toContain('No va a FEL')
        expect(vista.text()).toContain('diferencia de cobro de la')
        expect(vista.find('a[href="/facturas/1909"]').exists()).toBe(true)
        expect(vista.find('[data-prueba="factura-fel"]').exists()).toBe(false)
        vista.unmount()
    })

    it('ficha de la acreditada: estado propio, aviso y sin botón Certificar (la API daría 409)', async () => {
        const vista = await mountSuspended(PaginaFactura, { route: `/facturas/${FACTURA_ACREDITADA_ID}` })
        await vi.waitFor(() => expect(vista.find('[data-prueba="dte-sin"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="factura-estado"]').text()).toBe('Acreditada')
        expect(vista.find('[data-prueba="factura-no-fiscal"]').text()).toContain('no se certifica')
        expect(vista.find('[data-prueba="dte-sin"]').text()).toContain('acreditada por notas de crédito internas')
        expect(vista.find('[data-prueba="dte-certificar"]').exists()).toBe(false)
        expect(problemaFelLegible({ type: 'urn:argosisp:problema:factura_acreditada', title: 'Factura acreditada', status: 409, detail: 'La factura 9101 está acreditada' }).title)
            .toBe('La factura está acreditada: no es una venta')
        vista.unmount()
    })

    it('depósitos del cajero: 422 sin filtro, 403 con caja ajena y los de su turno con turno_id', async () => {
        comoCajero()
        const api = useFondosEnTransito()
        const sinFiltro = await api.depositos()
        expect(!sinFiltro.ok && sinFiltro.problema).toMatchObject({ status: 422, errors: [{ field: 'caja_id' }] })
        const ajena = await api.depositos(undefined, undefined, 25, { caja_id: CAJA_SUR_ID })
        expect(!ajena.ok && ajena.problema.status).toBe(403)
        const delTurno = await api.depositos(undefined, undefined, 25, { turno_id: 40 })
        expect(delTurno.ok && delTurno.data.data.map(d => d.boleta)).toEqual(['B-4471'])
        const otroTurno = await api.depositos(undefined, undefined, 25, { caja_id: 2, turno_id: 40 })
        expect(!otroTurno.ok && otroTurno.problema.errors?.[0]?.field).toBe('turno_id')
    })

    it('la caja del cajero lista los depósitos de su turno (sin esperado: le falta egresos.ver)', async () => {
        await useCajas().depositar(1, { monto: '50.00', boleta: 'B-81', cuenta_id: 16 }, nuevaClaveIdempotencia())
        comoCajero()
        const vista = await mountSuspended(PaginaCaja, { route: '/caja?caja=1' })
        await vi.waitFor(() => expect(vista.find('[data-prueba="depositos-turno"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="depositos-turno"]').text()).toContain('boleta B-81')
        expect(vista.find('[data-prueba="depositos-turno"]').text()).not.toContain('B-4471')
        expect(vista.find('[data-prueba="turno-esperado"]').exists()).toBe(false)
        vista.unmount()
    })

    it('la ficha del pago muestra el nombre del proveedor aunque no se lea bancos.ver', async () => {
        const pago = bd.pagos.find(p => p.proveedor_cobro_id === 1)
        expect(pago?.proveedor_cobro_nombre).toBe('Pasarela en línea')
        comoCajero()
        const vista = await mountSuspended(PaginaPago, { route: `/pagos/${pago?.id}` })
        await vi.waitFor(() => expect(vista.find('[data-prueba="pago-proveedor"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="pago-proveedor"]').text()).toContain('Pasarela en línea')
        expect(vista.find('[data-prueba="pago-proveedor"]').text()).not.toContain('Proveedor #')
        vista.unmount()
    })
})
