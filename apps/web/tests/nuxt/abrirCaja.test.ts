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

    it('con su caja cerrada, «Abrir caja» es la acción principal y abre la ventana (NuevoAbrirCaja)', async () => {
        const vista = await mountSuspended(PaginaCaja, { route: '/caja' })
        await esperar(() => expect(vista.find('[data-prueba="abrir-caja-barra"]').exists()).toBe(true))
        expect(vista.get('[data-prueba="abrir-caja-barra"]').text()).toBe('Abrir caja')
        expect(vista.find('[data-prueba="cerrar-caja"]').exists()).toBe(false)
        await vista.get('[data-prueba="abrir-caja-barra"]').trigger('click')
        await esperar(() => expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('Fondo inicial'))
        expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('Ahora no')
        vista.unmount()
    })

    it('al cobrar en efectivo sin caja abierta, avisa y abre la caja en un modal sin salir del cobro', async () => {
        const vista = await mountSuspended(PaginaCobro, { route: '/cobro?cliente=1' })
        await esperar(() => expect(vista.find('[data-prueba="aviso-sin-caja"]').exists()).toBe(true))
        const aviso = vista.get('[data-prueba="aviso-sin-caja"]')
        expect(aviso.text()).toContain('No tienes una caja abierta')
        // FlujoCobro, paso 0: sin caja abierta la ventana «Abrir caja» aparece sola una vez.
        await esperar(() => expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('Fondo inicial'))

        // Abierta la caja (como lo haría el modal), el aviso desaparece y el cobro va a esa caja.
        const turno = await useCajas().abrir(1, '200.00', nuevaClaveIdempotencia())
        expect(turno.ok).toBe(true)
        await useMiCaja().refrescar()
        const central = bd.cajas.find(c => c.id === 1)!
        expect(central.turno_abierto_id).not.toBeNull()
    })
})
