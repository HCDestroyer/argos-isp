import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h, type Component } from 'vue'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import PaginaRouter from '~/pages/routers/[id].vue'
import { UApp } from '#components'
import { esperar } from '../ayudas/esperar'

/**
 * Ficha del router (núcleo de routers, pedido del PM): cabecera con estado y modo de seguridad, la
 * franja de salud con lo que da la API, «Control de velocidad» como primera pestaña abierta con las
 * tarjetas del modo único del router, y el aviso de excepciones heredadas por plan con «Unificar»
 * (vista previa y `routers.unificar_control_velocidad`).
 */

function enApp(componente: Component) {
    return defineComponent({ render: () => h(UApp, null, { default: () => h(componente) }) })
}

function enBody(prueba: string): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(`[data-prueba="${prueba}"]`)
}

describe('ficha del router', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    it('abre en «Resumen» (tablero RedRouterFicha) con contacto, túnel, sesiones, IPs y el enlace a Horus', async () => {
        const pagina = await mountSuspended(enApp(PaginaRouter), { route: '/routers/1' })
        await esperar(() => expect(pagina.find('[data-prueba="router-resumen"]').exists()).toBe(true))
        const pestanas = pagina.findAll('[data-prueba="pestanas-router"] [role="tab"]').map(t => t.text().trim())
        expect(pestanas).toEqual(['Resumen', 'Conexión', 'Red e IPs', 'Velocidad', 'Servicios', 'Bitácora de comandos'])
        expect(pagina.find('[data-prueba="pestanas-router"] [role="tab"][aria-selected="true"]').text().trim()).toBe('Resumen')
        expect(pagina.find('[data-prueba="router-modo-seguridad"]').text()).toBe('RADIUS')
        await esperar(() => expect(pagina.find('[data-prueba="router-sesiones-abiertas"]').text()).toMatch(/^\d+$/))
        await esperar(() => expect(pagina.find('[data-prueba="router-resumen"]').text()).toContain('Conectado'))
        // El uso del router lo mide Horus (decisión 27): ni CPU ni memoria propias.
        expect(pagina.find('[data-prueba="router-resumen"]').text()).toContain('lo mide Horus')
        expect(pagina.find('[data-prueba="router-resumen"]').text()).not.toMatch(/CPU \d/)
    })

    it('«Velocidad»: 3 opciones a la vista, «Ver las otras» y el «?» de cada tipo de cola', async () => {
        const pagina = await mountSuspended(enApp(PaginaRouter), { route: '/routers/1?pestana=velocidad' })
        await esperar(() => expect(pagina.find('[data-prueba="capa-aplicacion"]').exists()).toBe(true))
        expect(pagina.findAll('[data-prueba="capa-aplicacion"] [role="radio"]')).toHaveLength(3)
        await pagina.find('[data-prueba="ver-otras-aplicaciones"]').trigger('click')
        await esperar(() => expect(pagina.findAll('[data-prueba="capa-aplicacion"] [role="radio"]')).toHaveLength(5))
        const ayuda = pagina.findAll('[data-prueba="capa-tipo-cola"] button').find(b => b.attributes('aria-label') === 'Cómo funciona CAKE')
        await ayuda?.trigger('click')
        await esperar(() => expect(pagina.find('[data-prueba="explicacion-cola"]').text()).toContain('CAKE'))
        expect(pagina.find('[data-prueba="ver-vista-previa-velocidad"]').attributes('disabled')).toBeDefined()
        // Sin excepciones heredadas en el RB-Centro: no hay aviso.
        expect(pagina.find('[data-prueba="excepciones-heredadas"]').exists()).toBe(false)
    })

    it('excepción heredada por plan: «Unificar» con la vista previa de la API y aplicar', async () => {
        const pagina = await mountSuspended(enApp(PaginaRouter), { route: '/routers/2?pestana=velocidad' })
        await esperar(() => expect(pagina.find('[data-prueba="excepciones-heredadas"]').exists()).toBe(true))
        const aviso = pagina.find('[data-prueba="excepciones-heredadas"]')
        expect(aviso.text()).toContain('1 plan tiene su propia velocidad en este router')
        expect(aviso.text()).toContain('Fibra Mixco 100 Mbps')

        await aviso.findAll('button').find(b => b.text() === 'Unificar')?.trigger('click')
        await esperar(() => expect(enBody('unificar-planes')).not.toBeNull())
        expect(enBody('unificar-planes')?.querySelector('[data-plan="4"]')?.textContent).toContain('Fibra Mixco 100 Mbps')
        expect(enBody('unificar-planes')?.querySelector('[data-plan="4"]')?.textContent).toContain('extras')
        expect(enBody('vista-previa-estrategia')).not.toBeNull()
        const confirmar = enBody('unificar-confirmar')
        expect(confirmar?.hasAttribute('disabled')).toBe(false)
        confirmar?.click()
        await esperar(() => expect(pagina.find('[data-prueba="excepciones-heredadas"]').exists()).toBe(false))
        expect(bd.implementacionesPlan.every(i => i.estrategia_velocidad === null)).toBe(true)
        expect(bd.acciones.some(a => a.accion === 'routers.unificar_control_velocidad')).toBe(true)
    })

    it('«Unificar» con las excepciones cambiadas: 409 y vuelve a leer la vista previa', async () => {
        const previa = await useControlVelocidad().vistaPreviaUnificar(2)
        expect(previa.ok && previa.data.planes.map(p => p.plan_id)).toEqual([4])
        const viejo = await useControlVelocidad().unificar(2, { planes: [] }, nuevaClaveIdempotencia())
        expect(!viejo.ok && viejo.problema.status).toBe(409)
        expect(!viejo.ok && codigoProblema(viejo.problema)).toBe('excepciones_cambiaron')
    })

    it('la pestaña va en la URL: «avanzado» (nombre anterior) abre «Conexión» con la baja y los datos del equipo', async () => {
        const pagina = await mountSuspended(enApp(PaginaRouter), { route: '/routers/1?pestana=avanzado' })
        await esperar(() => expect(pagina.find('[data-prueba="router-baja"]').exists()).toBe(true))
        expect(pagina.text()).toContain('Datos del equipo')
        expect(pagina.find('[data-prueba="router-resumen"]').exists()).toBe(false)
    })
})
