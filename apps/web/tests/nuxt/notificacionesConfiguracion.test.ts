import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { bd } from '~~/fixtures/bd'
import { configuracionGlobal } from '~~/fixtures/notificaciones/datos'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import PaginaNotificaciones from '~/pages/configuracion/notificaciones.vue'

/** Configuración → Notificaciones (A6): global y por empresa, secretos `***`, prueba con el error real. */
describe('notificaciones · cuerpo del PUT', () => {
    it('un secreto sin tocar no viaja; reemplazar manda el texto; borrar manda null; nunca ***', () => {
        const form = formularioNotificaciones(configuracionGlobal)
        const intacto = cuerpoNotificaciones(form, 0, false)
        expect(intacto.correo && 'password' in intacto.correo).toBe(false)
        expect(intacto.telegram && 'token' in intacto.telegram).toBe(false)
        expect('hereda' in intacto).toBe(false)
        expect(JSON.stringify(intacto)).not.toContain('***')

        form.secretos.password = { accion: 'reemplazar', valor: ' nueva-clave ' }
        form.secretos.token = { accion: 'borrar', valor: '' }
        form.secretos.webhook_secreto = { accion: 'reemplazar', valor: '   ' }
        form.correo.puerto = '465'
        form.correo.host = '  '
        const cambios = cuerpoNotificaciones(form, 3, true)
        expect(cambios.version).toBe(3)
        expect(cambios.correo?.password).toBe('nueva-clave')
        expect(cambios.correo?.puerto).toBe(465)
        expect(cambios.correo?.host).toBeNull()
        expect(cambios.telegram?.token).toBeNull()
        expect(cambios.telegram && 'webhook_secreto' in cambios.telegram).toBe(false)
        expect(cambios.hereda).toBe(false)
    })

    it('el origen de lo que se ve: entorno, hereda, guardada', () => {
        expect(etiquetaOrigen(configuracionGlobal).etiqueta).toBe('Del entorno, sin guardar')
        expect(etiquetaOrigen({ origen: 'sin_configurar', hereda: true, empresa_id: 2 }).etiqueta).toBe('Hereda la global')
        expect(etiquetaOrigen({ origen: 'guardada', hereda: false, empresa_id: null }).etiqueta).toBe('Guardada')
    })
})

describe('notificaciones · pantalla', () => {
    beforeEach(async () => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
        await flushPromises()
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
        localStorage.clear()
    })

    it('guardar la global reemplaza la contraseña sin mostrarla y pasa a "Guardada"', async () => {
        const vista = await mountSuspended(PaginaNotificaciones, { route: '/configuracion/notificaciones' })
        await vi.waitFor(() => expect(vista.find('[data-prueba="origen-notificaciones"]').text()).toContain('Del entorno'))
        const reemplazar = vista.findAll('button').find(b => b.text() === 'Reemplazar')
        await reemplazar?.trigger('click')
        await vista.get('input[data-prueba="secreto-correo.password"], [data-prueba="secreto-correo.password"] input').setValue('clave-smtp-nueva')
        await vista.get('[data-prueba="guardar-notificaciones"]').trigger('click')
        await vi.waitFor(() => expect(vista.get('[data-prueba="origen-notificaciones"]').text()).toContain('Guardada'))
        expect(bd.notificaciones.global.version).toBe(1)
        expect(bd.notificaciones.global.correo.password).toBe('***')
        expect(vista.html()).not.toContain('clave-smtp-nueva')
        const auditada = bd.acciones.filter(a => a.accion === 'notificaciones.configurar').at(-1)
        expect(JSON.stringify(auditada?.entrada)).not.toContain('clave-smtp-nueva')
    })

    it('"Enviar prueba" muestra el error real del servidor, y sin destino el 422', async () => {
        bd.notificaciones.global = { ...structuredClone(configuracionGlobal), correo: { ...configuracionGlobal.correo, host: 'smtp.falla.test' } }
        const vista = await mountSuspended(PaginaNotificaciones, { route: '/configuracion/notificaciones' })
        await vi.waitFor(() => expect(vista.find('[data-prueba="probar-correo"]').exists()).toBe(true))
        await vista.get('[data-prueba="probar-correo"]').trigger('click')
        await vi.waitFor(() => expect(vista.text()).toContain('Escribe el correo de destino'))
        await vista.get('input[aria-label="Correo de destino de la prueba"]').setValue('cobros@argosnet.gt')
        await vista.get('[data-prueba="probar-correo"]').trigger('click')
        await vi.waitFor(() => expect(vista.find('[data-prueba="error-prueba"]').exists()).toBe(true))
        expect(vista.get('[data-prueba="error-prueba"]').text()).toContain('getaddrinfo ENOTFOUND smtp.falla.test')
    })

    it('una empresa que hereda la global: su formulario queda bloqueado hasta apagar "Usar la configuración global"', async () => {
        const vista = await mountSuspended(PaginaNotificaciones, { route: '/configuracion/notificaciones?empresa=2' })
        await vi.waitFor(() => expect(vista.find('[data-prueba="origen-notificaciones"]').text()).toContain('Hereda la global'))
        expect(vista.get('input[placeholder="smtp.dominio.gt"]').attributes('disabled')).toBeDefined()
        await vista.get('button[role="switch"][data-prueba="hereda"], [data-prueba="hereda"] button[role="switch"]').trigger('click')
        await vi.waitFor(() => expect(vista.get('input[placeholder="smtp.dominio.gt"]').attributes('disabled')).toBeUndefined())
        await vista.get('[data-prueba="guardar-notificaciones"]').trigger('click')
        await vi.waitFor(() => expect(bd.notificaciones.empresas[2]?.hereda).toBe(false))
    })
})
