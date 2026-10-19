import type { Schema } from '@argosisp/contracts'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import { bd } from '~~/fixtures/bd'
import RouterVelocidad from '~/components/RouterVelocidad.vue'
import RouterVistaPreviaControl from '~/components/RouterVistaPreviaControl.vue'
import { esperar } from '../ayudas/esperar'

const RUTA = 'GET /api/v1/routers/:id/vista-previa-control'

/** Respuesta de la API real (`argosisp_test_a4web` + `pnpm demo:datos`), recortada a un plan. */
const VISTA_REAL: Schema<'VistaPreviaControl'> = {
    router_id: 1,
    de: 'simple',
    a: 'arbol_pcq',
    servicios: 4,
    lotes: 1,
    sesiones_a_desconectar: 0,
    menus: [
        { ruta: '/ip/firewall/mangle', crear: 4, actualizar: 0, borrar: 0 },
        { ruta: '/queue/tree', crear: 6, actualizar: 0, borrar: 0 },
        { ruta: '/queue/type', crear: 4, actualizar: 0, borrar: 0 },
    ],
    crear: [
        { ruta: '/queue/type', clave: 'argosisp-plan-1-bajada', nombre: 'argosisp-plan-1-bajada' },
        { ruta: '/queue/tree', clave: 'argosisp:global:bajada', nombre: 'argosisp-global-bajada' },
        { ruta: '/ip/firewall/mangle', clave: 'argosisp:plan:1:bajada', nombre: null },
    ],
    actualizar: [],
    borrar: [],
}

function boton(prueba: string): HTMLButtonElement | null {
    return document.body.querySelector<HTMLButtonElement>(`[data-prueba="${prueba}"]`)
}

async function abrirConfirmacion(router: Schema<'Router'>) {
    const wrapper = await mountSuspended(RouterVelocidad, { props: { router, open: true } })
    await esperar(() => expect(boton('abrir-cambio-control')).not.toBeNull())
    boton('abrir-cambio-control')?.click()
    return wrapper
}

describe('semana 3 · vista previa del cambio de modo del router', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
        // Sin vaciar el body: tests/setup.ts desmonta todo después (vaciarlo antes rompía el desmontaje).
    })

    it('el fixture responde como la API: menús ordenados, totales iguales a las listas, vacío al mismo modo', async () => {
        const api = useRouters()
        const vista = await api.vistaPreviaControl(1, 'arbol_pcq')
        expect(vista.ok).toBe(true)
        if (!vista.ok) {
            return
        }
        expect(vista.data).toMatchObject({ router_id: 1, de: 'simple', a: 'arbol_pcq', lotes: 1 })
        expect(vista.data.menus.map(m => m.ruta)).toEqual([...vista.data.menus.map(m => m.ruta)].sort((x, y) => x.localeCompare(y, 'en')))
        const totales = totalesVistaPrevia(vista.data.menus)
        expect(totales).toEqual({ crear: vista.data.crear.length, actualizar: vista.data.actualizar.length, borrar: vista.data.borrar.length })
        // 3 planes en RB-Centro: 4 tipos PCQ y 4 mangle IPv4 por plan, como la API real.
        expect(vista.data.menus.find(m => m.ruta === '/queue/type')?.crear).toBe(12)
        expect(vista.data.menus.find(m => m.ruta === '/ip/firewall/mangle')?.crear).toBe(12)
        expect(vista.data.crear).toContainEqual({ ruta: '/queue/tree', clave: 'argosisp:global:bajada', nombre: 'argosisp-global-bajada' })
        expect(vista.data.sesiones_a_desconectar).toBeGreaterThan(0)

        const mismo = await api.vistaPreviaControl(1, 'simple')
        expect(mismo.ok && mismo.data).toMatchObject({ lotes: 0, sesiones_a_desconectar: 0, menus: [], crear: [], borrar: [] })

        const vuelta = await api.vistaPreviaControl(2, 'simple')
        expect(vuelta.ok && vuelta.data.borrar.length).toBeGreaterThan(0)

        const sinRouter = await api.vistaPreviaControl(99, 'simple')
        expect(!sinRouter.ok && sinRouter.problema.status).toBe(404)
    })

    it('sin routers.cambiar_control_velocidad la vista previa responde 403', async () => {
        sesionFixture('fixture-cajero')
        const vista = await useRouters().vistaPreviaControl(1, 'arbol_pcq')
        expect(!vista.ok && vista.problema.status).toBe(403)
    })

    it('muestra servicios, lotes, sesiones y lo que se crea por menú con los datos reales de la API', async () => {
        const wrapper = await mountSuspended(RouterVistaPreviaControl, { props: { vista: VISTA_REAL } })
        expect(wrapper.find('[data-prueba="vista-servicios"]').text()).toBe('4')
        expect(wrapper.find('[data-prueba="vista-lotes"]').text()).toBe('1')
        expect(wrapper.find('[data-prueba="vista-sesiones"]').text()).toBe('0')
        expect(wrapper.find('[data-prueba="aviso-desconexiones"]').exists()).toBe(false)
        expect(wrapper.text()).toContain('Ninguna sesión PPPoE se desconecta')
        const tabla = wrapper.find('[data-prueba="vista-menus"]').text()
        expect(tabla).toContain('/queue/tree')
        expect(tabla).toContain('Árbol de colas (global y por plan)')
        expect(wrapper.text()).toContain('se crean 14, se actualizan 0 y se borran 0')
        expect(wrapper.text()).toContain('Se crea · 3 objetos')
        expect(wrapper.text()).not.toContain('Se borra ·')
    })

    it('sin objetos que tocar dice "Sin cambios" y no muestra tabla', async () => {
        const vacia = { ...VISTA_REAL, a: 'simple' as const, lotes: 0, menus: [], crear: [] }
        const wrapper = await mountSuspended(RouterVistaPreviaControl, { props: { vista: vacia } })
        expect(wrapper.find('[data-prueba="vista-sin-cambios"]').exists()).toBe(true)
        expect(wrapper.find('[data-prueba="vista-menus"]').exists()).toBe(false)
    })

    it('antes de confirmar abre la vista previa con la advertencia de desconexiones y luego cambia el modo', async () => {
        const router = bd.routers[0]
        expect(router).toBeDefined()
        if (!router) {
            return
        }
        const wrapper = await abrirConfirmacion(router)
        await esperar(() => expect(document.body.querySelector('[data-prueba="vista-previa-control"]')).not.toBeNull())
        const aviso = document.body.querySelector('[data-prueba="aviso-desconexiones"]')?.textContent ?? ''
        expect(aviso).toMatch(/Se desconectarán \d+ sesi(ón|ones) PPPoE/)
        expect(boton('confirmar-cambio-control')?.disabled).toBe(false)

        boton('confirmar-cambio-control')?.click()
        await esperar(() => expect(bd.routers[0]?.control_velocidad).toBe('arbol_pcq'))
        wrapper.unmount()
    })

    it('si la vista previa falla: error con "Reintentar", sin cifras y sin poder confirmar', async () => {
        const router = bd.routers[0]
        if (!router) {
            return
        }
        simularFalla(RUTA, 500)
        const wrapper = await abrirConfirmacion(router)
        await esperar(() => expect(document.body.querySelector('[data-prueba="vista-error"]')).not.toBeNull())
        expect(document.body.querySelector('[data-prueba="vista-previa-control"]')).toBeNull()
        expect(document.body.textContent).not.toContain('Sesiones a desconectar')
        expect(boton('confirmar-cambio-control')?.disabled).toBe(true)

        bd.fallas = {}
        const reintentar = [...document.body.querySelectorAll<HTMLButtonElement>('[data-prueba="vista-error"] button')].find(b => b.textContent?.includes('Reintentar'))
        reintentar?.click()
        await esperar(() => expect(document.body.querySelector('[data-prueba="vista-previa-control"]')).not.toBeNull())
        expect(boton('confirmar-cambio-control')?.disabled).toBe(false)
        expect(bd.routers[0]?.control_velocidad).toBe('simple')
        wrapper.unmount()
    })
})
