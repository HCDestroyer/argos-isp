import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import { UApp } from '#components'
import PaginaAviso from '~/pages/configuracion/aviso-cobro.vue'
import { esperar } from '../ayudas/esperar'

/**
 * Pedidos de la fase 3 de A5 y A6 al panel: las variables del PDF FEL en el editor del aviso (y el
 * aviso de que una plantilla guardada no recibe el bloque FEL sola) y el correo de contabilidad
 * de la configuración de notificaciones.
 */
describe('FEL · plantilla del aviso y correo de contabilidad', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    function montar() {
        const conApp = defineComponent({ render: () => h(UApp, null, { default: () => h(PaginaAviso) }) })
        return mountSuspended(conApp, { route: '/configuracion/aviso-cobro' })
    }

    it('el editor ofrece las variables nuevas del PDF FEL', async () => {
        const vista = await montar()
        await esperar(() => expect(vista.text()).toContain('factura.fel_tipo'))
        expect(vista.text()).toContain('factura.fel_fecha')
        expect(vista.text()).toContain('factura.fel_anulado')
        // La de fábrica ya trae el bloque: no hay aviso.
        expect(vista.find('[data-prueba="falta-bloque-fel"]').exists()).toBe(false)
    })

    it('una plantilla guardada sin el bloque FEL avisa y lo inserta', async () => {
        bd.plantillaAvisoCobro = { ...bd.plantillaAvisoCobro, version: 3, html: '<h1>{{empresa.nombre}}</h1>\n{{factura.lineas}}\n' }
        const vista = await montar()
        await esperar(() => expect(vista.find('[data-prueba="falta-bloque-fel"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="falta-bloque-fel"]').text()).toContain('factura.fel_tipo')
        const boton = vista.find('[data-prueba="falta-bloque-fel"]').findAll('button').find(b => b.text().includes('Insertar bloque FEL'))
        await boton?.trigger('click')
        await esperar(() => expect(vista.find('[data-prueba="falta-bloque-fel"]').exists()).toBe(false))
        expect((vista.find('textarea').element as HTMLTextAreaElement).value).toContain('{{#factura.fel_anulado}}')
    })

    it('correo de contabilidad: va en el cuerpo, se valida como lista y se guarda', async () => {
        const leida = await useNotificaciones().ver(null)
        if (!leida.ok) {
            throw new Error('sin configuración')
        }
        const formulario = formularioNotificaciones(leida.data)
        expect(formulario.correo.contabilidad).toBe('contabilidad@argosnet.gt')
        expect(errorListaCorreos('a@b.gt, c@d.gt')).toBeUndefined()
        expect(errorListaCorreos('no-es-correo')).toBe('Escribe correos válidos separados por coma')
        expect(errorListaCorreos('')).toBeUndefined()

        formulario.correo.contabilidad = 'conta@argosnet.gt, contador@despacho.gt'
        const cuerpo = cuerpoNotificaciones(formulario, leida.data.version, false)
        expect(cuerpo.correo?.contabilidad).toBe('conta@argosnet.gt, contador@despacho.gt')
        const guardada = await useNotificaciones().guardar(null, cuerpo)
        expect(guardada.ok && guardada.data.correo.contabilidad).toBe('conta@argosnet.gt, contador@despacho.gt')

        formulario.correo.contabilidad = ''
        expect(cuerpoNotificaciones(formulario, leida.data.version, false).correo?.contabilidad).toBeNull()
    })
})
