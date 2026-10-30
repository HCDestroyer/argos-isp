import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import EliminarRegistroModal from '~/components/EliminarRegistroModal.vue'
import { esperar } from '../ayudas/esperar'

/** Eliminar sin historial y listas «Retirados» / «Inactivos» (`contratos/eliminar.md`, A1). */
describe('eliminar sin historial', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    /** Un servicio recién dado de alta, sin facturas, sesiones ni nada más. */
    function servicioNuevo(): number {
        const base = structuredClone(bd.servicios.find(s => s.id === 3)!)
        const id = Math.max(...bd.servicios.map(s => s.id)) + 1
        bd.servicios.push({ ...base, id, user_ppp: `nuevo.${id}`, version: 1 })
        return id
    }

    it('los motivos en una frase con la alternativa', () => {
        expect(frasesMotivos([{ mensaje: 'tiene 3 facturas' }])).toBe('tiene 3 facturas')
        expect(textoNoEliminable('servicio', [{ mensaje: 'tiene 3 facturas' }])).toBe('No se puede eliminar: tiene 3 facturas. Puedes retirarlo.')
        expect(textoNoEliminable('router', [{ mensaje: 'tiene 22 servicios' }, { mensaje: 'tiene 41 sesiones PPPoE' }, { mensaje: 'tiene 1 bodega' }]))
            .toBe('No se puede eliminar: tiene 22 servicios, tiene 41 sesiones PPPoE y 1 bodega. Puedes desactivarlo.')
        expect(textoNoEliminable('servicio', [{ mensaje: 'tiene 1 equipo' }], true)).toBe('No se puede eliminar: tiene 1 equipo. Ya está retirado: lo encuentras en «Retirados».')
    })

    it('eliminable: con historial trae los motivos; sin historial, ninguno', async () => {
        const conHistorial = await useServicios().eliminable(1)
        expect(conHistorial.ok && conHistorial.data.eliminable).toBe(false)
        expect(conHistorial.ok && conHistorial.data.motivos.map(m => m.codigo)).toContain('facturas')
        const nuevo = await useServicios().eliminable(servicioNuevo())
        expect(nuevo.ok && nuevo.data).toEqual({ eliminable: true, motivos: [] })
        const router = await useRouters().eliminable(3)
        expect(router.ok && router.data.eliminable).toBe(true)
    })

    it('DELETE de un servicio: 409 con otra versión, 204 con la suya y repetirlo con la misma clave es igual', async () => {
        const id = servicioNuevo()
        const clave = nuevaClaveIdempotencia()
        const viejo = await useServicios().eliminar(id, 0, nuevaClaveIdempotencia())
        expect(!viejo.ok && viejo.problema.status).toBe(409)
        const hecho = await useServicios().eliminar(id, 1, clave)
        expect(hecho).toEqual({ ok: true, data: null })
        expect(bd.servicios.some(s => s.id === id)).toBe(false)
        expect(await useServicios().eliminar(id, 1, clave)).toEqual({ ok: true, data: null })
        expect(bd.acciones.filter(a => a.accion === 'servicios.eliminar' && a.entidad_id === id)).toHaveLength(1)
    })

    it('DELETE con historial: 422 servicio_con_historial / router_con_historial con la lista', async () => {
        const servicio = await useServicios().eliminar(1, bd.servicios.find(s => s.id === 1)!.version, nuevaClaveIdempotencia())
        expect(!servicio.ok && codigoProblema(servicio.problema)).toBe('servicio_con_historial')
        expect(!servicio.ok && servicio.problema.errors?.map(e => e.field)).toContain('facturas')
        const router = await useRouters().eliminar(1, bd.routers.find(r => r.id === 1)!.version, nuevaClaveIdempotencia())
        expect(!router.ok && codigoProblema(router.problema)).toBe('router_con_historial')
    })

    it('eliminar un router libera sus redes y bloques; los planes no se tocan', async () => {
        const planes = bd.planes.length
        const version = bd.routers.find(r => r.id === 3)!.version
        expect(await useRouters().eliminar(3, version, nuevaClaveIdempotencia())).toEqual({ ok: true, data: null })
        expect(bd.routers.some(r => r.id === 3)).toBe(false)
        expect(bd.redesIpv4.some(r => r.router_id === 3)).toBe(false)
        expect(bd.planes).toHaveLength(planes)
    })

    it('solo admin: sin servicios.eliminar es 403', async () => {
        sesionFixture('fixture-cajero')
        const resultado = await useServicios().eliminar(servicioNuevo(), 1, nuevaClaveIdempotencia())
        expect(!resultado.ok && resultado.problema.status).toBe(403)
    })

    it('el modal confirma con el nombre y lo que se libera, y pide la casilla', async () => {
        const id = servicioNuevo()
        const vista = await mountSuspended(EliminarRegistroModal, { props: { tipo: 'servicio', id, nombre: `nuevo.${id}`, version: 1, libera: ['IPv4 100.64.10.99'], open: true } })
        await esperar(() => expect(document.body.querySelector('[data-prueba="eliminar-modal"]')).not.toBeNull())
        expect(document.body.textContent).toContain(`Eliminar nuevo.${id}`)
        expect(document.body.querySelector('[data-prueba="eliminar-libera"]')?.textContent).toContain('100.64.10.99')
        const confirmar = document.body.querySelector<HTMLButtonElement>('[data-prueba="eliminar-confirmar"]')!
        expect(confirmar.disabled).toBe(true)
        document.body.querySelector<HTMLElement>('[data-prueba="eliminar-entiende"] button, button[data-prueba="eliminar-entiende"]')!.click()
        await esperar(() => expect(confirmar.disabled).toBe(false))
        confirmar.click()
        await esperar(() => expect(vista.emitted('eliminado')).toHaveLength(1))
        expect(bd.servicios.some(s => s.id === id)).toBe(false)
    })

    it('el modal explica el 409 con «Recargar» y el 422 con los motivos', async () => {
        const conflicto = await mountSuspended(EliminarRegistroModal, { props: { tipo: 'router', id: 3, nombre: 'RB-Bodega', version: 99, libera: [], open: true } })
        await esperar(() => expect(document.body.querySelector('[data-prueba="eliminar-entiende"]')).not.toBeNull())
        document.body.querySelector<HTMLElement>('[data-prueba="eliminar-entiende"] button, button[data-prueba="eliminar-entiende"]')!.click()
        await flushPromises()
        document.body.querySelector<HTMLButtonElement>('[data-prueba="eliminar-confirmar"]')!.click()
        await esperar(() => expect(document.body.querySelector('[data-prueba="eliminar-409"]')?.textContent).toContain('Otra sesión cambió el router'))
        conflicto.unmount()

        const historial = await mountSuspended(EliminarRegistroModal, { props: { tipo: 'router', id: 1, nombre: 'RB-Centro', version: bd.routers[0]!.version, libera: [], open: true } })
        await esperar(() => expect(document.body.querySelector('[data-prueba="eliminar-entiende"]')).not.toBeNull())
        document.body.querySelector<HTMLElement>('[data-prueba="eliminar-entiende"] button, button[data-prueba="eliminar-entiende"]')!.click()
        await flushPromises()
        document.body.querySelector<HTMLButtonElement>('[data-prueba="eliminar-confirmar"]')!.click()
        await esperar(() => expect(document.body.querySelector('[data-prueba="eliminar-422"]')?.textContent).toContain('No se puede eliminar: tiene 22 servicios y 41 sesiones PPPoE. Puedes desactivarlo.'))
        expect(document.body.querySelector<HTMLButtonElement>('[data-prueba="eliminar-confirmar"]')?.disabled).toBe(true)
        historial.unmount()
    })

    it('listas: routers inactivos con activo=false y servicios retirados con estado=retirado', async () => {
        const activos = await useRouters().listar({ activo: true })
        expect(activos.ok && activos.data.data.every(r => r.activo)).toBe(true)
        const inactivos = await useRouters().listar({ activo: false })
        expect(inactivos.ok && inactivos.data.data.map(r => r.id)).toEqual([3])
        const retirados = await useServicios().listar({ estado: 'retirado' })
        expect(retirados.ok && retirados.data.data.map(s => s.id)).toEqual([10])
    })
})
