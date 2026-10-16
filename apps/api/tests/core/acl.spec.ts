import { test } from '@japa/runner'
import type { HttpContext } from '@adonisjs/core/http'
import env from '#start/env'
import { despachar, type Ruta } from '#shared/rutas'
import { NoImplementado } from '#shared/errores'
import { estado, usuarioConRoles } from '#tests/ayudas'

const PROBLEM_JSON = 'application/problem+json; charset=utf-8'

test.group('ACL y endpoints sin implementar', () => {
    test('cajero sin routers.ver recibe 403 Problem', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['cajero'])

        const respuesta = await estado(client.get('/api/v1/routers').bearerToken(token), 403)
        assert.equal(respuesta.header('content-type'), PROBLEM_JSON)
        assert.deepEqual(respuesta.body(), {
            type: 'urn:argosisp:problema:prohibido',
            title: 'Permiso insuficiente',
            status: 403,
            detail: 'Se requiere el permiso routers.ver',
        })
    })

    test('cajero tampoco puede suspender servicios', async ({ client }) => {
        const { token } = await usuarioConRoles(['cajero'])
        await estado(
            client.post('/api/v1/servicios/1/suspender').bearerToken(token).json({ motivo: 'prueba' }),
            403,
        )
    })

    test('una ruta sin handler responde 501 problem+json (ya no queda ninguna en la API)', async ({
        assert,
    }) => {
        const ruta = { operacion: 'pruebaSinHandler' } as unknown as Ruta
        const ctx = { request: { body: () => ({}), qs: () => ({}) } } as unknown as HttpContext
        const error = await despachar(ruta, ctx).catch((e: unknown) => e)
        assert.instanceOf(error, NoImplementado)
        assert.deepEqual((error as NoImplementado).toJSON(), {
            type: 'urn:argosisp:problema:no_implementado',
            title: 'No implementado',
            status: 501,
            detail: 'La operación pruebaSinHandler aún no está implementada',
        })
    })

    test('admin tiene routers.ver', async ({ client }) => {
        const { token } = await usuarioConRoles(['admin'])
        await estado(client.get('/api/v1/routers').bearerToken(token), 200)
    })

    test('se valida antes del 501: cuerpo inválido → 422', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const respuesta = await estado(
            client.post('/api/v1/servicios/1/suspender').bearerToken(token).json({}),
            422,
        )
        assert.equal(respuesta.body().errors[0].field, 'motivo')
    })

    test('ruta inexistente o id no numérico → 404 Problem', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const respuesta = await estado(client.get('/api/v1/servicios/abc').bearerToken(token), 404)
        assert.equal(respuesta.header('content-type'), PROBLEM_JSON)
    })

    test('endpoints internos exigen INTERNAL_TOKEN', async ({ client }) => {
        const { token } = await usuarioConRoles(['admin'])
        const ruta = '/api/v1/internal/aaa/servicio'
        await estado(client.get(ruta).qs({ user_ppp: 'x' }).bearerToken(token), 401)
        await estado(client.get(ruta).qs({ user_ppp: 'x' }).bearerToken(env.get('INTERNAL_TOKEN')), 404)
    })

    test('GET /health responde 200', async ({ client }) => {
        await estado(client.get('/health'), 200)
    })
})
