import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import { bd } from '~~/fixtures/bd'
import { meAdmin, meCajero } from '~~/fixtures/auth/sesiones'
import { CLAVE_WHATSAPP_ACTIVO } from '~~/fixtures/notificaciones/whatsapp'
import ReciboWhatsapp from '~/components/ReciboWhatsapp.vue'
import { esperar } from '../ayudas/esperar'

/**
 * Comprobante por WhatsApp (Iris) en la pantalla de éxito del cobro: según la configuración de
 * envío, el estado del envío o nada; nunca un enlace wa.me armado por el navegador.
 */
describe('recibo · comprobante por WhatsApp', () => {
    const pagoId = () => bd.pagos[0]!.id

    beforeEach(() => {
        reiniciarFixtures()
        localStorage.removeItem(CLAVE_WHATSAPP_ACTIVO)
    })

    afterEach(() => {
        localStorage.removeItem(CLAVE_WHATSAPP_ACTIVO)
        sesionFixture(null)
    })

    it('canal apagado y cajero: no hay botón ni texto de configuración', async () => {
        sesionFixture('fixture-cajero')
        useUsuarioActual().value = meCajero
        const wrapper = await mountSuspended(ReciboWhatsapp, { props: { pagoId: pagoId() } })
        await esperar(() => expect(wrapper.find('[data-prueba="whatsapp-apagado"]').exists()).toBe(true))
        expect(wrapper.text()).toBe('')
        expect(wrapper.find('a[href*="wa.me"]').exists()).toBe(false)
        wrapper.unmount()
    })

    it('canal apagado y quien configura: texto discreto hacia Ajustes → Canales de aviso', async () => {
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
        const wrapper = await mountSuspended(ReciboWhatsapp, { props: { pagoId: pagoId() } })
        await esperar(() => expect(wrapper.text()).toContain('Envío por WhatsApp: actívalo en'))
        expect(wrapper.text()).toContain('Ajustes → Canales de aviso')
        expect(wrapper.find('a[href="/configuracion/notificaciones"]').exists()).toBe(true)
        expect(wrapper.find('button').exists()).toBe(false)
        wrapper.unmount()
    })

    it('canal activo: en cola y luego «Comprobante enviado por WhatsApp»', async () => {
        localStorage.setItem(CLAVE_WHATSAPP_ACTIVO, '1')
        sesionFixture('fixture-cajero')
        useUsuarioActual().value = meCajero
        const wrapper = await mountSuspended(ReciboWhatsapp, { props: { pagoId: pagoId() } })
        await esperar(() => expect(wrapper.find('[data-prueba="whatsapp-envio"]').attributes('data-estado')).toBe('encolado'))
        expect(wrapper.text()).toContain('en cola')
        await esperar(() => expect(wrapper.find('[data-prueba="whatsapp-envio"]').attributes('data-estado')).toBe('enviado'))
        expect(wrapper.text()).toContain('Comprobante enviado por WhatsApp')
        wrapper.unmount()
    })

    it('si no se puede leer, error con «Reintentar» y ningún estado supuesto', async () => {
        localStorage.setItem(CLAVE_WHATSAPP_ACTIVO, '1')
        simularFalla('GET /api/v1/notificaciones/pagos/:id/whatsapp', 500)
        sesionFixture('fixture-cajero')
        useUsuarioActual().value = meCajero
        const wrapper = await mountSuspended(ReciboWhatsapp, { props: { pagoId: pagoId() } })
        await esperar(() => expect(wrapper.text()).toContain('Reintentar'))
        expect(wrapper.find('[data-prueba="whatsapp-envio"]').exists()).toBe(false)
        wrapper.unmount()
    })
})
