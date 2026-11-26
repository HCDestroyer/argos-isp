import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import FacturaNuevaPanel from '~/components/FacturaNuevaPanel.vue'
import PaginaCliente from '~/pages/clientes/[id]/index.vue'
import PaginaFacturas from '~/pages/facturas/index.vue'
import PaginaServicio from '~/pages/servicios/[id]/index.vue'
import { esperar } from '../ayudas/esperar'

/**
 * Plan de contabilidad, lote P4 (decisión del PM): «Cargo único» pasa a llamarse «Nueva factura» y
 * se ve sin buscarlo: en la ficha del cliente (junto a Cobrar y en la pestaña Facturación), en
 * Facturas y en la ficha del servicio; el formulario es un panel lateral.
 */
describe('P4 · Nueva factura a la vista', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
        useEmpresaActiva().elegir(1)
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
        localStorage.clear()
    })

    it('Facturas: el botón «Nueva factura» está en el encabezado y abre el panel que pide el cliente', async () => {
        const vista = await mountSuspended(PaginaFacturas, { route: '/facturas' })
        const boton = vista.get('[data-prueba="nueva-factura"]')
        expect(boton.text()).toBe('Nueva factura')
        expect(vista.text()).not.toContain('Cargo único')
        await boton.trigger('click')
        await esperar(() => expect(document.querySelector('[data-prueba="factura-nueva-quien"]')?.textContent).toBe('Elige a quién se factura'))
        // Sin cliente elegido no se puede emitir.
        const emitir = document.querySelector<HTMLButtonElement>('[data-prueba="emitir-cargo"]')
        expect(emitir?.textContent?.trim()).toBe('Emitir factura')
        expect(emitir?.disabled).toBe(true)
        expect(document.querySelector('[data-prueba="factura-nueva-cliente"], [data-prueba="emitir-y-cobrar"]')).not.toBeNull()
    })

    it('sin el permiso de emitir no se ofrece «Nueva factura»', async () => {
        useUsuarioActual().value = { ...meAdmin, permisos: meAdmin.permisos.filter(p => p !== 'facturas.emitir_cargo_unico') }
        const vista = await mountSuspended(PaginaFacturas, { route: '/facturas' })
        expect(vista.find('[data-prueba="nueva-factura"]').exists()).toBe(false)
    })

    it('ficha del cliente: «Nueva factura» a la vista junto a Cobrar; «Más» ya no trae «Cargo único»', async () => {
        const vista = await mountSuspended(PaginaCliente, { route: '/clientes/2' })
        await esperar(() => expect(vista.find('[data-prueba="franja-nueva-factura"]').exists()).toBe(true))
        expect(vista.get('[data-prueba="franja-nueva-factura"]').text()).toBe('Nueva factura')
        await esperar(() => expect(vista.find('[data-prueba="franja-cobrar"]').exists()).toBe(true))
        await vista.get('[data-prueba="mas-cliente"]').trigger('click')
        await esperar(() => expect(document.querySelectorAll('[role="menuitem"]').length).toBeGreaterThan(0))
        const opciones = [...document.querySelectorAll('[role="menuitem"]')].map(e => e.textContent?.trim())
        expect(opciones).not.toContain('Cargo único')
        expect(opciones).not.toContain('Nueva factura')
    })

    it('ficha del cliente: abrir «Nueva factura» muestra el cliente y su NIT; con servicios, «Servicio (opcional)»', async () => {
        const vista = await mountSuspended(PaginaCliente, { route: '/clientes/2' })
        await esperar(() => expect(vista.find('[data-prueba="franja-nueva-factura"]').exists()).toBe(true))
        await vista.get('[data-prueba="franja-nueva-factura"]').trigger('click')
        await esperar(() => expect(document.querySelector('[data-prueba="factura-nueva-quien"]')).not.toBeNull())
        const cliente = bd.clientes.find(c => c.id === 2)
        expect(document.querySelector('[data-prueba="factura-nueva-quien"]')?.textContent).toContain(cliente?.nombre)
        await esperar(() => expect(document.querySelector('[data-prueba="factura-nueva-servicio"]')).not.toBeNull())
        expect(document.body.textContent).toContain('Sin servicio, la factura no cuenta para el corte.')
    })

    it('ficha del servicio: botón «Nueva factura» en la franja, no en «Más»', async () => {
        const vista = await mountSuspended(PaginaServicio, { route: '/servicios/1' })
        await esperar(() => expect(vista.find('[data-prueba="nueva-factura-servicio"]').exists()).toBe(true))
        expect(vista.get('[data-prueba="nueva-factura-servicio"]').text()).toBe('Nueva factura')
    })

    it('pestaña Facturación: el panel de estado de cuenta ofrece «Nueva factura»', async () => {
        const vista = await mountSuspended(PaginaCliente, { route: '/clientes/2?tab=cuenta' })
        await esperar(() => expect(vista.find('[data-prueba="nueva-factura-cuenta"]').exists()).toBe(true))
    })

    it('el panel se monta con un servicio de destino y emite «Emitir factura»', async () => {
        const servicio = bd.servicios[0]!
        const vista = await mountSuspended(FacturaNuevaPanel, { props: { open: true, destino: { servicio } } })
        await esperar(() => expect(document.querySelector('[data-prueba="emitir-cargo"]')).not.toBeNull())
        expect(document.body.textContent).toContain('Nueva factura')
        expect(document.querySelector('[data-prueba="factura-nueva-servicio"]')).toBeNull()
        vista.unmount()
    })
})
