import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { bd } from '~~/fixtures/bd'
import { meCajero } from '~~/fixtures/auth/sesiones'
import PaginaCaja from '~/pages/caja/index.vue'
import PaginaCobro from '~/pages/cobro/index.vue'
import { esperar } from '../ayudas/esperar'

/** Abrir la caja es evidente: estado vacío con «Abrir caja» y aviso en el cobro con el modal. */
describe('abrir caja', () => {
    beforeEach(async () => {
        reiniciarFixtures()
        sesionFixture('fixture-cajero')
        useUsuarioActual().value = meCajero
        useMiCaja().cajas.value = null
        // La Caja Central del cajero, cerrada.
        const central = bd.cajas.find(c => c.id === 1)!
        central.turno_abierto_id = null
        await flushPromises()
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
        useMiCaja().cajas.value = null
    })

    it('la caja cerrada muestra «Abrir caja» como acción principal y los pasos', async () => {
        const vista = await mountSuspended(PaginaCaja, { route: '/caja' })
        await esperar(() => expect(vista.find('[data-prueba="caja-cerrada"]').exists()).toBe(true))
        const cerrada = vista.get('[data-prueba="caja-cerrada"]')
        expect(cerrada.text()).toContain('Caja Central está cerrada')
        expect(cerrada.find('[data-prueba="abrir-caja"]').text()).toBe('Abrir caja')
        expect(cerrada.text()).toContain('Cerrar caja')
        expect(vista.find('[data-prueba="abrir-caja-barra"]').exists()).toBe(true)
    })

    it('al cobrar en efectivo sin caja abierta, avisa y abre la caja en un modal sin salir del cobro', async () => {
        const vista = await mountSuspended(PaginaCobro, { route: '/cobro?cliente=1' })
        await esperar(() => expect(vista.find('[data-prueba="aviso-sin-caja"]').exists()).toBe(true))
        const aviso = vista.get('[data-prueba="aviso-sin-caja"]')
        expect(aviso.text()).toContain('No tienes una caja abierta')
        await aviso.findAll('button').find(boton => boton.text().includes('Abrir caja'))!.trigger('click')
        await esperar(() => expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('Fondo inicial'))

        // Abierta la caja (como lo haría el modal), el aviso desaparece y el cobro va a esa caja.
        const turno = await useCajas().abrir(1, '200.00', nuevaClaveIdempotencia())
        expect(turno.ok).toBe(true)
        await useMiCaja().refrescar()
        const central = bd.cajas.find(c => c.id === 1)!
        expect(central.turno_abierto_id).not.toBeNull()
    })
})
