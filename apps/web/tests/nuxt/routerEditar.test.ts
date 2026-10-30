import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import RouterAcciones from '~/components/RouterAcciones.vue'
import RouterEditarModal from '~/components/RouterEditarModal.vue'
import { esperar } from '../ayudas/esperar'

/** Editar router (`PUT /routers/:id`, `routers.editar`) con `version` y el menú de acciones. */
describe('editar router', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    function escribir(selector: string, valor: string) {
        const campo = document.body.querySelector<HTMLInputElement>(selector)
        expect(campo, selector).not.toBeNull()
        campo!.value = valor
        campo!.dispatchEvent(new Event('input', { bubbles: true }))
    }

    async function enviar() {
        document.body.querySelector<HTMLButtonElement>('[data-prueba="router-editar-guardar"]')!.click()
    }

    it('guarda solo lo que cambió, sin mostrar ni mandar los secretos guardados', async () => {
        const router = structuredClone(bd.routers[0]!)
        const wrapper = await mountSuspended(RouterEditarModal, { props: { router, open: true } })
        await esperar(() => expect(document.body.querySelector('[data-prueba="router-editar"]')).not.toBeNull())
        const formulario = document.body.querySelector('[data-prueba="router-editar"]')!
        expect(formulario.textContent).toContain('Vacía = se mantiene la actual.')
        const claves = [...formulario.querySelectorAll<HTMLInputElement>('input[type="password"]')]
        expect(claves.every(c => c.value === '')).toBe(true)

        escribir('input[data-prueba="router-editar-usuario"], [data-prueba="router-editar-usuario"] input', 'admin-api')
        const nombre = formulario.querySelector<HTMLInputElement>('input[data-prueba="router-editar-nombre"], [data-prueba="router-editar-nombre"] input')!
        nombre.value = 'Nodo Centro Norte'
        nombre.dispatchEvent(new Event('input', { bubbles: true }))
        await enviar()
        await esperar(() => expect(bd.routers[0]!.nombre).toBe('Nodo Centro Norte'))
        expect(bd.routers[0]!.api_usuario).toBe('admin-api')
        expect(bd.routers[0]!.version).toBe(router.version + 1)
        expect(bd.routers[0]!.tiene_api_password).toBe(router.tiene_api_password)
        expect(wrapper.emitted('actualizado')).toHaveLength(1)
    })

    it('con la versión vieja responde 409 y ofrece recargar', async () => {
        const router = structuredClone(bd.routers[0]!)
        bd.routers[0]!.version += 1
        await mountSuspended(RouterEditarModal, { props: { router, open: true } })
        await esperar(() => expect(document.body.querySelector('[data-prueba="router-editar"]')).not.toBeNull())
        const nombre = document.body.querySelector<HTMLInputElement>('[data-prueba="router-editar"] input[data-prueba="router-editar-nombre"], [data-prueba="router-editar-nombre"] input')!
        nombre.value = 'Otro nombre'
        nombre.dispatchEvent(new Event('input', { bubbles: true }))
        await enviar()
        await esperar(() => expect(document.body.querySelector('[data-prueba="router-conflicto"]')).not.toBeNull())
        expect(document.body.querySelector('[data-prueba="router-conflicto"]')?.textContent).toContain('Recargar')
        expect(bd.routers[0]!.nombre).toBe(router.nombre)
    })

    it('el menú agrupa Editar, conexión y velocidad; lo que no está disponible se ve deshabilitado', async () => {
        const router = structuredClone(bd.routers[0]!)
        const wrapper = await mountSuspended(RouterAcciones, { props: { router, conEditar: true } })
        expect(wrapper.find('[data-prueba="editar-router"]').exists()).toBe(true)
        expect(wrapper.find(`[data-prueba="acciones-router-${router.id}"]`).exists()).toBe(true)
        useUsuarioActual().value = { ...meAdmin, permisos: meAdmin.permisos.filter(p => p !== 'routers.editar') }
        await esperar(() => expect(wrapper.find('[data-prueba="editar-router"]').exists()).toBe(false))
    })
})
