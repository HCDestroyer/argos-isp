import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import meCajero from '~~/fixtures/auth/me.cajero.json'
import { bd } from '~~/fixtures/bd'
import { CAJA_SUR_ID, FACTURA_ACREDITADA_ID } from '~~/fixtures/facturacion/datos'
import PaginaCaja from '~/pages/caja/index.vue'
import PaginaFactura from '~/pages/facturas/[id].vue'
import PaginaPago from '~/pages/pagos/[id].vue'
import { esperar } from '../ayudas/esperar'

/**
 * Fase 4 final de A3: factura `acreditada` (H16, aviso cubierto por notas internas sin cobro),
 * depósitos del turno legibles por el cajero (`GET /bancos/depositos?turno_id=`) y
 * `Pago.proveedor_cobro_nombre`. (El `tipo = 'cargo'` de H18 desapareció con la decisión B.)
 */
describe('fase 4 final · acreditada, depósitos del cajero y proveedor del pago', () => {
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
        // Decisión B: `cargo` ya no es un tipo del contrato; si llegara, se muestra por su nombre.
        expect(tipoFacturaVisual('cargo')?.etiqueta).toBe('Cargo')
        expect(tipoFacturaVisual('ajuste_manual')?.etiqueta).toBe('Ajuste manual')
        expect(relacionOrigen('cargo')).toBe('originada por la')
        expect(relacionOrigen('mora')).toBe('mora de la')
    })

    it('la lista filtra por estado acreditada y no queda ninguna factura de tipo cargo', async () => {
        const acreditadas = await useFacturas().listar({ estado: 'acreditada' })
        expect(acreditadas.ok && acreditadas.data.data.map(f => f.id)).toEqual([FACTURA_ACREDITADA_ID])
        expect(bd.facturas.some(f => (f.tipo ?? 'servicio') !== 'servicio' && f.tipo !== 'mora')).toBe(false)
    })

    it('ficha de la acreditada: estado propio, aviso y sin botón Certificar (la API daría 409)', async () => {
        const vista = await mountSuspended(PaginaFactura, { route: `/facturas/${FACTURA_ACREDITADA_ID}` })
        await esperar(() => expect(vista.find('[data-prueba="dte-sin"]').exists()).toBe(true))
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

    it('la caja del cajero lista los depósitos de su turno y el esperado los resta (egresos con cajas.ver)', async () => {
        await useCajas().depositar(1, { monto: '50.00', boleta: 'B-81', cuenta_id: 16 }, nuevaClaveIdempotencia())
        comoCajero()
        const vista = await mountSuspended(PaginaCaja, { route: '/caja?caja=1' })
        await esperar(() => expect(vista.find('[data-prueba="depositos-turno"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="depositos-turno"]').text()).toContain('boleta B-81')
        expect(vista.find('[data-prueba="depositos-turno"]').text()).not.toContain('B-4471')
        await esperar(() => expect(vista.find('[data-prueba="turno-esperado"]').exists()).toBe(true))
        vista.unmount()
    })

    it('la ficha del pago muestra el nombre del proveedor aunque no se lea bancos.ver', async () => {
        const pago = bd.pagos.find(p => p.proveedor_cobro_id === 1)
        expect(pago?.proveedor_cobro_nombre).toBe('Pasarela en línea')
        comoCajero()
        const vista = await mountSuspended(PaginaPago, { route: `/pagos/${pago?.id}` })
        await esperar(() => expect(vista.find('[data-prueba="pago-proveedor"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="pago-proveedor"]').text()).toContain('Pasarela en línea')
        expect(vista.find('[data-prueba="pago-proveedor"]').text()).not.toContain('Proveedor #')
        vista.unmount()
    })
})
