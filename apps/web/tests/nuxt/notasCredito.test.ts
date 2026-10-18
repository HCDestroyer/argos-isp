import { mountSuspended } from '@nuxt/test-utils/runtime'
import Decimal from 'decimal.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import meCajero from '~~/fixtures/auth/me.cajero.json'
import { cuadra } from '~~/fixtures/libro/datos'
import { bd } from '~~/fixtures/bd'
import ClienteEstadoCuenta from '~/components/ClienteEstadoCuenta.vue'
import PaginaNota from '~/pages/notas-credito/[id].vue'
import PaginaNotas from '~/pages/notas-credito/index.vue'

/**
 * Semana 3 (3.ª tanda) · tarea 3: lista y detalle de notas de crédito (`GET /notas-credito`,
 * `facturas.ver`), enlace desde el estado de cuenta y entrada en el menú.
 */
describe('notas de crédito', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    it('las notas sembradas cuadran con su factura y su asiento', () => {
        expect(bd.notasCredito.length).toBeGreaterThanOrEqual(2)
        for (const nota of bd.notasCredito) {
            const factura = bd.facturas.find(f => f.id === nota.factura_id)
            expect(new Decimal(factura?.acreditado ?? 0).gte(nota.monto)).toBe(true)
            expect(new Decimal(nota.subtotal).plus(nota.iva).toFixed(2)).toBe(nota.monto)
            const asiento = bd.asientos.find(a => a.id === nota.asiento_id)
            expect(asiento?.origen_tipo).toBe('nota_credito')
            expect(asiento && cuadra(asiento)).toBe(true)
        }
    })

    it('listar: filtros por cliente, factura y fecha contable, con cursor', async () => {
        const todas = await useNotasCredito().listar()
        expect(todas.ok && todas.data.data.length).toBe(bd.notasCredito.length)
        const [una] = bd.notasCredito
        if (!una) {
            throw new Error('sin notas sembradas')
        }
        const porCliente = await useNotasCredito().listar({ cliente_id: una.cliente_id })
        expect(porCliente.ok && porCliente.data.data.every(n => n.cliente_id === una.cliente_id)).toBe(true)
        const porFactura = await useNotasCredito().listar({ factura_id: una.factura_id })
        expect(porFactura.ok && porFactura.data.data.map(n => n.id)).toEqual([una.id])
        const fuera = await useNotasCredito().listar({ desde: '2026-11-01' })
        expect(fuera.ok && fuera.data.data).toEqual([])
        const pagina = await useNotasCredito().listar({ limit: 1 })
        expect(pagina.ok && pagina.data.nextCursor).not.toBeNull()
    })

    it('la lista muestra nota, cliente, factura y monto en quetzales', async () => {
        const vista = await mountSuspended(PaginaNotas, { route: '/notas-credito' })
        await vi.waitFor(() => expect(vista.find('[data-prueba="tabla-notas"]').text()).toContain('Nota #'))
        const [una] = [...bd.notasCredito].sort((a, b) => b.id - a.id)
        expect(vista.text()).toContain(una?.cliente_nombre ?? '—')
        expect(vista.text()).toContain(formatearQuetzales(una?.monto))
        expect(vista.find(`a[href="/notas-credito/${una?.id}"]`).exists()).toBe(true)
    })

    it('con error la lista muestra el aviso y "Reintentar", no una tabla vacía', async () => {
        simularFalla('GET /api/v1/notas-credito', 501)
        const vista = await mountSuspended(PaginaNotas, { route: '/notas-credito' })
        await vi.waitFor(() => expect(vista.text()).toContain('Reintentar'))
        expect(vista.find('[data-prueba="tabla-notas"]').exists()).toBe(false)
    })

    it('el detalle: datos, enlace a la factura y su asiento', async () => {
        const [una] = bd.notasCredito
        const vista = await mountSuspended(PaginaNota, { route: `/notas-credito/${una?.id}` })
        await vi.waitFor(() => expect(vista.text()).toContain(una?.motivo ?? '—'))
        expect(vista.find('[data-prueba="enlace-factura"]').attributes('href')).toBe(`/facturas/${una?.factura_id}`)
        expect(vista.text()).toContain(formatearQuetzales(una?.iva))
        await vi.waitFor(() => expect(vista.text()).toContain('Debe'))
    })

    it('el detalle de una nota que no existe dice "no encontrada"', async () => {
        const vista = await mountSuspended(PaginaNota, { route: '/notas-credito/9999' })
        await vi.waitFor(() => expect(vista.text()).toContain('Nota de crédito no encontrada'))
    })

    it('el movimiento nota_credito del estado de cuenta enlaza a la nota', async () => {
        const [una] = bd.notasCredito
        const vista = await mountSuspended(ClienteEstadoCuenta, { props: { clienteId: una?.cliente_id ?? 0 } })
        await vi.waitFor(() => expect(vista.find(`a[href="/notas-credito/${una?.id}"]`).exists()).toBe(true))
    })

    it('menú: "Notas de crédito" con facturas.ver (también el cajero)', () => {
        const seccion = obtenerSeccion('notas-credito')
        expect(seccion.permiso).toBe('facturas.ver')
        useUsuarioActual().value = meCajero
        expect(usePermisos().puede(seccion.permiso)).toBe(true)
        useUsuarioActual().value = { ...meCajero, permisos: meCajero.permisos.filter(p => p !== 'facturas.ver') }
        expect(usePermisos().puede(seccion.permiso)).toBe(false)
    })
})
