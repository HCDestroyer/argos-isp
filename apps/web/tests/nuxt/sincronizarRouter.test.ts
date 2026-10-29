import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import ServicioSincronizarRouterModal from '~/components/ServicioSincronizarRouterModal.vue'
import { esperar } from '../ayudas/esperar'

/** «Sincronizar con el router» en la ficha del servicio (`POST /servicios/:id/sincronizar-router`, A1). */
describe('sincronizar un servicio con su router', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    const cuerpo = () => document.body
    const enRouter = (routerId: number) => {
        const servicio = bd.servicios.find(s => s.router_id === routerId && s.estado === 'activo') ?? bd.servicios.find(s => s.estado === 'activo')!
        servicio.router_id = routerId
        return structuredClone(servicio)
    }

    async function abrir(servicio: ReturnType<typeof enRouter>) {
        const vista = await mountSuspended(ServicioSincronizarRouterModal, { props: { servicio, nombreRouter: 'RB-Centro', open: false } })
        await vista.setProps({ open: true })
        await esperar(() => expect(cuerpo().querySelector('[data-prueba="sincronizar-router-confirmar"]')).not.toBeNull())
        cuerpo().querySelector<HTMLElement>('[data-prueba="sincronizar-router-confirmar"]')!.click()
        return vista
    }

    it('muestra lo que corrigió y, la segunda vez, «Ya estaba sincronizado»', async () => {
        const servicio = enRouter(1)
        await abrir(servicio)
        await esperar(() => expect(cuerpo().querySelector('[data-prueba="sincronizar-cambios"]')).not.toBeNull())
        const cambios = cuerpo().querySelector('[data-prueba="sincronizar-cambios"]')!.textContent ?? ''
        expect(cambios).toContain('Se corrigieron 2 cosas')
        expect(cambios).toContain('/queue/simple')
        expect(cambios).toContain(`argosisp:servicio:${servicio.id}`)
        expect(cambios).toContain('1 duplicado quitado')
        cuerpo().querySelector<HTMLElement>('[data-prueba="sincronizar-router-confirmar"]')!.click()
        await esperar(() => expect(cuerpo().querySelector('[data-prueba="sincronizar-al-dia"]')?.textContent).toContain('Ya estaba sincronizado'))
        expect(cuerpo().querySelector('[data-prueba="sincronizar-cambios"]')).toBeNull()
    })

    it('si el router no responde, el motivo con sus comandos para copiar', async () => {
        await abrir(enRouter(2))
        await esperar(() => expect(cuerpo().querySelector('[data-prueba="sincronizar-error"]')).not.toBeNull())
        const error = cuerpo().querySelector('[data-prueba="sincronizar-error"]')!
        expect(error.textContent).toContain('no tiene certificado en www-ssl')
        expect(error.querySelector('[data-prueba="comandos-routeros"]')?.textContent).toContain('/certificate sign argos-ca')
    })

    it('422 en lenguaje simple: pendiente de instalación y router sin API', async () => {
        const pendiente = enRouter(1)
        bd.servicios.find(s => s.id === pendiente.id)!.estado = 'pendiente_instalacion'
        const primera = await abrir(pendiente)
        await esperar(() => expect(cuerpo().querySelector('[data-prueba="sincronizar-422"]')?.textContent).toContain('Todavía no hay nada que sincronizar'))
        expect(cuerpo().querySelector('[data-prueba="sincronizar-422"]')?.textContent).toContain('Activar instalación')

        primera.unmount()
        reiniciarFixtures()
        await abrir(enRouter(3))
        await esperar(() => expect(cuerpo().querySelector('[data-prueba="sincronizar-422"]')?.textContent).toContain('Argos no puede hablar con ese router'))
        expect(cuerpo().querySelector('[data-prueba="sincronizar-422"]')?.textContent).toContain('inactivo')
    })

    it('pide servicios.sincronizar_router', async () => {
        sesionFixture('fixture-cajero')
        const resultado = await useServicios().sincronizarRouter(enRouter(1).id, nuevaClaveIdempotencia())
        expect(!resultado.ok && resultado.problema.status).toBe(403)
    })
})
