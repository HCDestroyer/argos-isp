import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { bd } from '~~/fixtures/bd'

/**
 * Semana 3 (2.ª tanda) · tarea 5: sesión del panel en la cookie `HttpOnly` de la API
 * (`contratos/sesion-panel.md`). Los fixtures simulan la cookie (`bd.sesion`) y el CSRF.
 */
describe('sesión del panel con cookie HttpOnly y CSRF', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture(null)
        limpiarSesionLocal()
    })

    afterEach(() => {
        sesionFixture(null)
        limpiarSesionLocal()
    })

    it('login con POST /auth/sesion: la API pone la cookie y el panel solo guarda el csrf en memoria', async () => {
        const resultado = await useAuth().login({ email: 'admin@argos.test', password: 'x' })
        expect(resultado.ok).toBe(true)
        expect(bd.sesion.token).toBe('fixture-admin')
        expect(useCsrf().value).toBe(bd.sesion.csrf)
        expect(useExpiraSesion().value).not.toBeNull()
        // Ni cookie legible ni localStorage con el token.
        expect(document.cookie).not.toContain('argos_token')
        expect(document.cookie).not.toContain('fixture-admin')
        expect(JSON.stringify({ ...globalThis.localStorage })).not.toContain('fixture-admin')
    })

    it('POST con X-CSRF-Token pasa; sin él la API responde 403 csrf_invalido', async () => {
        await useAuth().login({ email: 'admin@argos.test', password: 'x' })
        const bien = await useRouters().editar(1, { version: 1, dhcp_servidor: 'dhcp1' })
        expect(bien.ok).toBe(true)

        // Una petición sin el header (como desde otro sitio) no pasa.
        const respuesta = await useNuxtApp().$fetchPanel(new Request(`${ORIGEN_FIXTURES}/api/v1/routers/1`, {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ version: 2, dhcp_servidor: 'x' }),
        }))
        expect(respuesta.status).toBe(403)
        expect(((await respuesta.json()) as { type: string }).type).toBe('urn:argosisp:problema:csrf_invalido')
    })

    it('403 csrf_invalido: recarga el csrf con GET /me y repite la petición una vez', async () => {
        await useAuth().login({ email: 'admin@argos.test', password: 'x' })
        const bueno = useCsrf().value
        useCsrf().value = 'csrf-viejo'
        const resultado = await useRouters().editar(1, { version: 1, interfaz_clientes: 'bridge' })
        expect(resultado.ok && resultado.data.interfaz_clientes).toBe('bridge')
        expect(useCsrf().value).toBe(bueno)
    })

    it('tras recargar la página, GET /me con la cookie devuelve el usuario y el csrf', async () => {
        await useAuth().login({ email: 'cajero@argos.test', password: 'x' })
        const csrf = useCsrf().value
        limpiarSesionLocal()
        const me = await useAuth().cargarMe()
        expect(me?.email).toBe('cajero@argos.test')
        expect(useCsrf().value).toBe(csrf)
    })

    it('sin cookie (vencida o revocada) /me responde 401 y la sesión local queda vacía', async () => {
        useUsuarioActual().value = { id: 1, nombre: 'x', email: 'x@x', roles: [], permisos: [], expira_en: null, expira_max_en: null, alcance_global: false, empresas: [], empresa_activa_id: null }
        useCsrf().value = 'algo'
        expect(await useAuth().cargarMe()).toBeNull()
        expect(useUsuarioActual().value).toBeNull()
        expect(useCsrf().value).toBeNull()
    })

    it('un 401 a mitad de sesión limpia la sesión local (y la navegación lleva a /login)', async () => {
        await useAuth().login({ email: 'admin@argos.test', password: 'x' })
        sesionFixture(null)
        const resultado = await useClientes().listar()
        expect(!resultado.ok && resultado.problema.status).toBe(401)
        expect(useUsuarioActual().value).toBeNull()
        expect(useCsrf().value).toBeNull()
    })

    it('logout: POST /auth/logout con csrf revoca el token y borra la cookie', async () => {
        await useAuth().login({ email: 'admin@argos.test', password: 'x' })
        await useAuth().logout()
        expect(bd.sesionesCerradas).toEqual(['fixture-admin'])
        expect(bd.sesion.token).toBeNull()
        expect(useCsrf().value).toBeNull()
        expect(useUsuarioActual().value).toBeNull()
    })
})
