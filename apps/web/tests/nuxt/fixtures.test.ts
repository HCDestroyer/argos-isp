import { createApiClient } from '@argosisp/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import { rutasFixture } from '~~/fixtures'

describe('modo fixtures', () => {
    afterEach(async () => {
        useNuxtApp().$tokenSesion.value = null
        useUsuarioActual().value = null
    })

    it('useApi responde desde fixtures cuando NUXT_PUBLIC_USE_FIXTURES=true', async () => {
        expect(useRuntimeConfig().public.useFixtures).toBe(true)
        const { data, response } = await useApi().POST('/api/v1/auth/login', {
            body: { email: 'admin@argos.test', password: 'x' },
        })
        expect(response.status).toBe(200)
        expect(data?.token).toBe('fixture-admin')
        expect(data?.usuario.roles).toEqual(['admin'])
    })

    it('useAuth inicia sesión, guarda el token y carga /me', async () => {
        const { login, cargarMe, autenticado, usuario } = useAuth()
        const resultado = await login({ email: 'Cajero@Argos.test', password: 'x' })
        expect(resultado.ok).toBe(true)
        expect(autenticado.value).toBe(true)
        expect(useNuxtApp().$tokenSesion.value).toBe('fixture-cajero')

        usuario.value = null
        const me = await cargarMe()
        expect(me?.email).toBe('cajero@argos.test')
        expect(useUsuarioActual().value?.roles).toEqual(['cajero'])
    })

    it('credenciales inválidas devuelven un Problem RFC 9457', async () => {
        const resultado = await useAuth().login({ email: 'nadie@argos.test', password: 'x' })
        expect(resultado.ok).toBe(false)
        if (!resultado.ok) {
            expect(resultado.problema.status).toBe(401)
            expect(resultado.problema.title).toBe('Credenciales inválidas')
        }
    })

    it('un token inválido limpia la sesión al cargar /me', async () => {
        useNuxtApp().$tokenSesion.value = 'token-vencido'
        const { cargarMe, autenticado } = useAuth()
        expect(await cargarMe()).toBeNull()
        expect(autenticado.value).toBe(false)
    })

    it('rutas sin fixture responden 501 con Problem', async () => {
        const fetchFixtures = crearFetchFixtures(rutasFixture)
        const respuesta = await fetchFixtures(`${ORIGEN_FIXTURES}/api/v1/plantillas-notificacion`)
        expect(respuesta.status).toBe(501)
        expect(respuesta.headers.get('Content-Type')).toBe('application/problem+json')
    })

    it('el fetch falso funciona con el cliente de contracts y parámetros de ruta', async () => {
        const fetchFixtures = crearFetchFixtures({
            'GET /api/v1/clientes/:id': ({ params }) => ({ status: 200, cuerpo: { id: Number(params.id) } }),
        })
        const respuesta = await fetchFixtures(`${ORIGEN_FIXTURES}/api/v1/clientes/42`)
        expect(await respuesta.json()).toEqual({ id: 42 })

        const cliente = createApiClient({ baseUrl: ORIGEN_FIXTURES, fetch: crearFetchFixtures(rutasFixture), getToken: () => 'fixture-admin' })
        const { data } = await cliente.GET('/api/v1/me')
        expect(data?.nombre).toBe('Ana Administradora')
    })
})
