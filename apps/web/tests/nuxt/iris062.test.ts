import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { bd } from '~~/fixtures/bd'
import { conectorIrisInicial, conectorIrisPorReconectar, MOTIVO_RECONECTAR_RECEPTOR_FIXTURE } from '~~/fixtures/iris/datos'
import { CLAVE_IRIS_RECONECTAR } from '~~/fixtures/iris/rutas'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { UApp } from '#components'
import PaginaIris from '~/pages/configuracion/integraciones/iris.vue'
import PaginaIntegraciones from '~/pages/configuracion/integraciones/index.vue'
import { esperar } from '../ayudas/esperar'

/**
 * Contrato Iris 0.6.2: con `requiere_reconectar: true` la pantalla del conector avisa que hay que
 * volver a conectar Iris (motivo de la API y la acción del enlace) y el estado lleva una marca.
 */

const conApp = (componente: Component) => defineComponent({
    render: () => h(UApp, null, { default: () => h(componente) }),
})

describe('iris 0.6.2 · utilidades', () => {
    it('solo requiere_reconectar: true pide el aviso; sin motivo usa el genérico', () => {
        expect(avisoReconectarIris(conectorIrisInicial)).toBeNull()
        // false con un motivo suelto no avisa: no se infiere nada de otros campos
        expect(avisoReconectarIris({ ...conectorIrisPorReconectar, requiere_reconectar: false })).toBeNull()
        expect(avisoReconectarIris(conectorIrisPorReconectar)).toEqual({
            titulo: 'Hay que volver a conectar Iris',
            motivo: MOTIVO_RECONECTAR_RECEPTOR_FIXTURE,
        })
        expect(avisoReconectarIris({ ...conectorIrisPorReconectar, motivo_reconectar: null })?.motivo).toBe(MOTIVO_RECONECTAR_IRIS_GENERICO)
        expect(avisoReconectarIris({ ...conectorIrisPorReconectar, motivo_reconectar: '  ' })?.motivo).toBe(MOTIVO_RECONECTAR_IRIS_GENERICO)
        expect(MARCA_RECONECTAR_IRIS).toMatchObject({ color: 'warning', etiqueta: 'Volver a conectar' })
        expect(MARCA_RECONECTAR_IRIS.icono).toMatch(/^i-lucide-/)
        expect(INSTRUCCION_RECONECTAR_IRIS).toContain('«Conectar con Argos»')
    })

    it('la fixture es fiel a la API: true con su motivo, el resto como un conector encendido', () => {
        expect(conectorIrisPorReconectar).toMatchObject({ requiere_reconectar: true, activo: true, token: '***', webhook_salida_secreto: '***' })
        expect(conectorIrisPorReconectar.motivo_reconectar).toBe(MOTIVO_RECONECTAR_RECEPTOR_FIXTURE)
        expect(conectorIrisInicial).toMatchObject({ requiere_reconectar: false, motivo_reconectar: null })
    })
})

describe('iris 0.6.2 · pantalla', () => {
    beforeEach(async () => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
        await flushPromises()
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
        localStorage.removeItem(CLAVE_IRIS_RECONECTAR)
        vi.restoreAllMocks()
    })

    it('sin requiere_reconectar no hay aviso ni marca', async () => {
        bd.iris.conector = { ...structuredClone(conectorIrisPorReconectar), requiere_reconectar: false, motivo_reconectar: null }
        const vista = await mountSuspended(conApp(PaginaIris), { route: '/configuracion/integraciones/iris' })
        await esperar(() => expect(vista.find('[data-prueba="estado-conector-iris"]').text()).toBe('Activa'))
        expect(vista.find('[data-prueba="aviso-reconectar-iris"]').exists()).toBe(false)
        expect(vista.find('[data-prueba="marca-reconectar-iris"]').exists()).toBe(false)
    })

    it('con requiere_reconectar: aviso de advertencia con el motivo, la marca y el enlace que se genera', async () => {
        bd.iris.conector = structuredClone(conectorIrisPorReconectar)
        const vista = await mountSuspended(conApp(PaginaIris), { route: '/configuracion/integraciones/iris' })
        await esperar(() => expect(vista.find('[data-prueba="aviso-reconectar-iris"]').exists()).toBe(true))
        const aviso = vista.get('[data-prueba="aviso-reconectar-iris"]')
        expect(aviso.attributes('role')).toBe('alert')
        expect(aviso.text()).toContain('Hay que volver a conectar Iris')
        expect(vista.get('[data-prueba="motivo-reconectar-iris"]').text()).toBe(MOTIVO_RECONECTAR_RECEPTOR_FIXTURE)
        expect(aviso.text()).toContain('«Conectar con Argos»')
        // color de advertencia con icono (el color nunca va solo)
        expect(aviso.html()).toMatch(/warning/)
        expect(aviso.find('.iconify, [class*="i-lucide-triangle-alert"], svg').exists()).toBe(true)
        expect(vista.get('[data-prueba="marca-reconectar-iris"]').text()).toBe('Volver a conectar')
        expect(vista.get('[data-prueba="estado-conector-iris"]').text()).toBe('Activa')

        const boton = aviso.findAll('button').find(b => b.text().trim() === 'Generar enlace de conexión')
        expect(boton).toBeDefined()
        await boton!.trigger('click')
        await esperar(() => expect(document.body.querySelector('[data-prueba="valor-Enlace"]')?.textContent ?? '').toMatch(/\/conectar#\w{20,}/))
    })

    it('sin iris.configurar: el aviso se ve, pero sin el botón del enlace', async () => {
        useUsuarioActual().value = { ...meAdmin, permisos: meAdmin.permisos.filter(p => p !== 'iris.configurar') }
        bd.iris.conector = structuredClone(conectorIrisPorReconectar)
        const vista = await mountSuspended(conApp(PaginaIris), { route: '/configuracion/integraciones/iris' })
        await esperar(() => expect(vista.find('[data-prueba="aviso-reconectar-iris"]').exists()).toBe(true))
        const aviso = vista.get('[data-prueba="aviso-reconectar-iris"]')
        expect(aviso.findAll('button').some(b => b.text().includes('Generar enlace'))).toBe(false)
        expect(aviso.text()).toContain('requiere el permiso para configurar Iris')
    })

    it('índice de integraciones: marca «Volver a conectar» junto al estado', async () => {
        bd.iris.conector = structuredClone(conectorIrisPorReconectar)
        const vista = await mountSuspended(conApp(PaginaIntegraciones), { route: '/configuracion/integraciones' })
        await esperar(() => expect(vista.find('[data-prueba="estado-tarjeta-iris"]').text()).toBe('Activa'))
        expect(vista.get('[data-prueba="marca-reconectar-tarjeta-iris"]').text()).toBe('Volver a conectar')

        bd.iris.conector = structuredClone(conectorIrisInicial)
        const sinMarca = await mountSuspended(conApp(PaginaIntegraciones), { route: '/configuracion/integraciones' })
        await esperar(() => expect(sinMarca.find('[data-prueba="estado-tarjeta-iris"]').text()).toBe('Sin conectar'))
        expect(sinMarca.find('[data-prueba="marca-reconectar-tarjeta-iris"]').exists()).toBe(false)
    })

    it('la clave de Playwright pone el conector por reconectar en el GET', async () => {
        localStorage.setItem(CLAVE_IRIS_RECONECTAR, '1')
        const vista = await mountSuspended(conApp(PaginaIris), { route: '/configuracion/integraciones/iris' })
        await esperar(() => expect(vista.find('[data-prueba="aviso-reconectar-iris"]').exists()).toBe(true))
        expect(bd.iris.conector.requiere_reconectar).toBe(true)
    })
})
