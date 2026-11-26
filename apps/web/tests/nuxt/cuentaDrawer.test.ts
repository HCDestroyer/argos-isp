import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import UApp from '@nuxt/ui/components/App.vue'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin, meCajero } from '~~/fixtures/auth/sesiones'
import CuentaDrawer from '~/components/CuentaDrawer.vue'
import { esperar } from '../ayudas/esperar'

/**
 * Panel de la cuenta en el teléfono (plan del menú y Ajustes, lote 5; tablero PerfilDrawer): quién
 * eres, la empresa activa (solo con más de una; «Todas» solo con alcance global), el tema, Mi
 * cuenta, Qué cambió y Cerrar sesión.
 */
const App = defineComponent({ render: () => h(UApp, null, { default: () => h(CuentaDrawer) }) })
const montadas: { unmount: () => void }[] = []

async function abrir(usuario: typeof meAdmin) {
    useUsuarioActual().value = usuario
    useEmpresaActiva().inicializar()
    const vista = await mountSuspended(App, { route: '/', attachTo: document.body })
    montadas.push(vista)
    useMenuCuenta().abierto.value = true
    await flushPromises()
    await esperar(() => expect(document.body.querySelector('[data-prueba="cerrar-cuenta"]')).not.toBeNull())
}

function radios(): HTMLElement[] {
    return [...document.body.querySelectorAll<HTMLElement>('[data-prueba="cuenta-empresas"] [role="radio"]')]
}

beforeEach(() => {
    reiniciarFixtures()
    sesionFixture('fixture-admin')
})

afterEach(() => {
    useMenuCuenta().abierto.value = false
    sesionFixture(null)
    useUsuarioActual().value = null
    localStorage.clear()
    for (const vista of montadas.splice(0)) {
        vista.unmount()
    }
    document.body.innerHTML = ''
})

describe('panel de la cuenta del teléfono', () => {
    it('quién eres y la empresa activa con su NIT; «Todas las empresas» solo con alcance global', async () => {
        await abrir({ ...meAdmin, alcance_global: true })
        const texto = document.body.textContent ?? ''
        expect(texto).toContain(meAdmin.nombre)
        expect(texto).toContain(meAdmin.email)
        expect(texto).toContain('Empresa activa')
        expect(radios().map(r => r.closest('[data-slot="item"]')?.textContent?.trim() ?? r.textContent)).toHaveLength(3)
        expect(texto).toContain('Todas las empresas')
        expect(texto).toContain('NIT 1234567-8')
        for (const vista of montadas.splice(0)) {
            vista.unmount()
        }
        document.body.innerHTML = ''
        await abrir({ ...meAdmin, alcance_global: false })
        expect(document.body.textContent).not.toContain('Todas las empresas')
        expect(radios()).toHaveLength(2)
    })

    it('con una sola empresa no hay selector', async () => {
        await abrir(meCajero)
        expect(document.body.querySelector('[data-prueba="cuenta-empresas"]')).toBeNull()
        expect(document.body.querySelector('#cuenta-empresa')).toBeNull()
    })

    it('elegir empresa la deja activa, cierra el panel y avisa', async () => {
        await abrir({ ...meAdmin, alcance_global: true })
        const fibra = radios().find(r => (r.closest('[data-slot="item"]')?.textContent ?? '').includes('Fibra del Sur'))
        fibra?.click()
        await flushPromises()
        expect(useEmpresaActiva().eleccion.value).toBe(2)
        expect(useMenuCuenta().abierto.value).toBe(false)
        await esperar(() => expect(document.body.textContent).toContain('Empresa activa: Fibra del Sur'))
    })

    it('el tema se elige con tres botones a la vista', async () => {
        await abrir(meAdmin)
        const oscuro = document.body.querySelector<HTMLButtonElement>('[data-tema="dark"]')
        oscuro?.click()
        await flushPromises()
        expect(useColorMode().preference).toBe('dark')
        expect(oscuro?.getAttribute('aria-pressed')).toBe('true')
        document.body.querySelector<HTMLButtonElement>('[data-tema="system"]')?.click()
        await flushPromises()
        expect(useColorMode().preference).toBe('system')
    })

    it('Qué cambió cierra el panel antes de abrir su ventana; Cerrar sesión va al login', async () => {
        await abrir(meAdmin)
        document.body.querySelector<HTMLButtonElement>('[data-prueba="cuenta-que-cambio"]')?.click()
        await flushPromises()
        expect(useMenuCuenta().abierto.value).toBe(false)
        await esperar(() => expect(useMenuCuenta().queCambioAbierto.value).toBe(true))
        useMenuCuenta().queCambioAbierto.value = false
        useMenuCuenta().abierto.value = true
        await flushPromises()
        await esperar(() => expect(document.body.querySelector('[data-prueba="cuenta-cerrar-sesion"]')).not.toBeNull())
        document.body.querySelector<HTMLButtonElement>('[data-prueba="cuenta-cerrar-sesion"]')?.click()
        await esperar(() => expect(useRoute().path).toBe('/login'))
        expect(useUsuarioActual().value).toBeNull()
    })
})
