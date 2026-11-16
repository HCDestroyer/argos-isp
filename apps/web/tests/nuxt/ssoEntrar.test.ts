import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { bd } from '~~/fixtures/bd'
import { TICKET_SIN_VINCULAR, TICKET_SIN_VINCULAR_ANONIMO, TICKET_SIN_VINCULAR_IRIS } from '~~/fixtures/horus/datos'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { UApp } from '#components'
import PaginaSso from '~/pages/sso/entrar.vue'
import PaginaPerfil from '~/pages/perfil.vue'
import { esperar } from '../ayudas/esperar'

/**
 * `/sso/entrar`, fase de vincular: antes de pedir la contraseña se muestra a quién se le da acceso
 * (sistema, nombre, correo e instalación) con un aviso, para que un enlace reenviado por otra
 * persona no se vincule a la cuenta de quien lo abre.
 */

const conApp = (componente: Component) => defineComponent({
    render: () => h(UApp, null, { default: () => h(componente) }),
})

async function abrir(ticket: string) {
    window.history.replaceState(null, '', `/sso/entrar#${ticket}`)
    const vista = await mountSuspended(PaginaSso, { route: `/sso/entrar#${ticket}` })
    await esperar(() => expect(vista.find('[data-prueba="sso-vincular"]').exists()).toBe(true))
    return vista
}

const dato = (vista: Awaited<ReturnType<typeof abrir>>, clave: string) => vista.find(`[data-prueba="sso-dato-${clave}"]`)

describe('sso · nombre del sistema', () => {
    it('iris → Iris, horus → Horus; desconocido tal cual, nunca Horus', () => {
        expect(nombreSistemaSso('iris')).toBe('Iris')
        expect(nombreSistemaSso('horus')).toBe('Horus')
        expect(nombreSistemaSso('nexo')).toBe('nexo')
        expect(nombreSistemaSso('')).not.toBe('Horus')
        expect(nombreSistemaSso(null)).not.toBe('Horus')
    })
})

describe('sso · /sso/entrar al vincular', () => {
    beforeEach(async () => {
        reiniciarFixtures()
        sesionFixture(null)
        useUsuarioActual().value = null
        await flushPromises()
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
        vi.restoreAllMocks()
    })

    it('Horus: título, nombre, correo e instalación juntos, aviso y texto de Horus', async () => {
        const vista = await abrir(TICKET_SIN_VINCULAR)
        expect(vista.get('[data-prueba="sso-titulo"]').text()).toBe('Vincula tu cuenta de Horus')
        expect(dato(vista, 'nombre').text()).toBe('Luis Pérez (Horus)')
        expect(dato(vista, 'correo').text()).toBe('luis@horus.isp.gt')
        expect(dato(vista, 'instalacion').text()).toBe('horus.isp.example')
        expect(dato(vista, 'id_externo').exists()).toBe(false)
        expect(vista.get('[data-prueba="sso-aviso"]').text()).toContain('Vas a dar acceso a tu cuenta de ArgosIsp a esta persona de Horus. Si no eres tú, no continúes.')
        expect(vista.get('[data-prueba="sso-aviso"]').find('.iconify, svg, [class*="i-lucide"]').exists()).toBe(true)
        expect(vista.get('[data-prueba="sso-explicacion"]').text()).toContain('Desde ahora Horus te abrirá ArgosIsp')
        expect(vista.text()).not.toContain('Iris')
    })

    it('Iris: nunca dice Horus; instalación null se muestra como «instalación no informada»', async () => {
        const vista = await abrir(TICKET_SIN_VINCULAR_IRIS)
        expect(vista.get('[data-prueba="sso-titulo"]').text()).toBe('Vincula tu cuenta de Iris')
        expect(dato(vista, 'nombre').text()).toBe('Marta Gómez (Iris)')
        expect(dato(vista, 'correo').text()).toBe('marta@iris.isp.gt')
        expect(dato(vista, 'instalacion').text()).toBe('instalación no informada')
        expect(dato(vista, 'id_externo').exists()).toBe(false)
        expect(vista.get('[data-prueba="sso-aviso"]').text()).toContain('Vas a dar acceso a tu cuenta de ArgosIsp a esta persona de Iris. Si no eres tú, no continúes.')
        expect(vista.get('[data-prueba="sso-explicacion"]').text()).toContain('Desde ahora Iris te abrirá ArgosIsp')
        expect(vista.text()).not.toContain('Horus')
    })

    it('conector desconocido sin nombre ni correo: su valor tal cual y el id externo', async () => {
        const vista = await abrir(TICKET_SIN_VINCULAR_ANONIMO)
        expect(vista.get('[data-prueba="sso-titulo"]').text()).toBe('Vincula tu cuenta de nexo')
        expect(dato(vista, 'nombre').text()).toBe('nombre no informado')
        expect(dato(vista, 'correo').text()).toBe('correo no informado')
        expect(dato(vista, 'id_externo').text()).toBe('ext-991')
        expect(dato(vista, 'instalacion').text()).toBe('nexo.isp.example:8443')
        expect(vista.text()).not.toContain('Horus')
    })

    it('Iris: al vincular guarda la vinculación de Iris y Mi cuenta la muestra como «Iris»', async () => {
        const navegar = vi.spyOn(useRouter(), 'replace')
        const vista = await abrir(TICKET_SIN_VINCULAR_IRIS)
        await vista.get('input[type="email"]').setValue('admin@argos.test')
        await vista.get('input[type="password"]').setValue('cualquiera')
        await vista.get('form').trigger('submit')
        await esperar(() => expect(bd.horus.vinculaciones.some(v => v.conector === 'iris' && v.id_externo === 'iris-7')).toBe(true))
        await esperar(() => expect(navegar).toHaveBeenCalled())
        await Promise.allSettled(navegar.mock.results.map(r => r.value))
        await flushPromises()

        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
        const perfil = await mountSuspended(conApp(PaginaPerfil), { route: '/perfil' })
        await esperar(() => expect(perfil.get('[data-prueba="tabla-vinculaciones"]').text()).toContain('Marta Gómez (Iris)'))
        const tabla = perfil.get('[data-prueba="tabla-vinculaciones"]').text()
        expect(tabla).toContain('Iris')
        expect(tabla).toContain('Horus')
        expect(perfil.find(`[aria-label="Quitar la vinculación con Iris"]`).exists()).toBe(true)
    })
})
