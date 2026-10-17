import { test } from '@japa/runner'
import type { HttpContext } from '@adonisjs/core/http'
import { construirOpenApi } from '#shared/openapi/documento'
import { generarOpenApi } from '#shared/openapi/generador'
import { definirRuta, despachar, redirigir, type Ruta } from '#shared/rutas'

/**
 * Despachador de rutas (`app/shared/rutas.ts`): redirecciones 303 declaradas (pedido de A3) y el
 * gancho `antes` que corre antes de validar (pedido de A5).
 */

const INFO = { titulo: 'prueba', version: '0', descripcion: 'prueba' }

/** HttpContext mínimo para `despachar`: cuerpo, query y la respuesta que registra lo que se hace. */
function ctxFalso(cuerpo: Record<string, unknown> = {}) {
    const registro: { status?: number; location?: string; enviado?: unknown } = {}
    const redireccion = {
        status(status: number) {
            registro.status = status
            return redireccion
        },
        toPath(url: string) {
            registro.location = url
        },
    }
    const ctx = {
        request: { body: () => cuerpo, qs: () => ({}) },
        params: {},
        response: {
            status(status: number) {
                registro.status = status
            },
            send(valor: unknown) {
                registro.enviado = valor
            },
            redirect: () => redireccion,
        },
    } as unknown as HttpContext
    return { ctx, registro }
}

test.group('Rutas: redirección 303', () => {
    test('el handler devuelve redirigir(url) y despachar pone 303 y Location', async ({ assert }) => {
        const ruta = definirRuta({
            metodo: 'post',
            ruta: '/prueba/redirigir',
            operacion: 'pruebaRedirigir',
            resumen: 'prueba',
            etiqueta: 'prueba',
            seguridad: 'publico',
            permiso: null,
            respuesta: { status: 303, descripcion: 'Vuelve' },
            handler: async () => redirigir('https://portal.prueba.local/corte?estado=pagado'),
        })
        const { ctx, registro } = ctxFalso()
        await despachar(ruta, ctx)
        assert.equal(registro.status, 303)
        assert.equal(registro.location, 'https://portal.prueba.local/corte?estado=pagado')
    })

    test('una ruta 303 que no devuelve redirigir() es un error de programación', async ({ assert }) => {
        const ruta = definirRuta({
            metodo: 'post',
            ruta: '/prueba/mal',
            operacion: 'pruebaMal',
            resumen: 'prueba',
            etiqueta: 'prueba',
            seguridad: 'publico',
            permiso: null,
            respuesta: { status: 303, descripcion: 'Vuelve' },
            handler: async () => ({ ok: true }),
        })
        const { ctx } = ctxFalso()
        await assert.rejects(() => despachar(ruta, ctx), /debe devolver redirigir/)
    })

    test('el OpenAPI declara el 303 con Location y sin contenido', ({ assert }) => {
        const ruta = definirRuta({
            metodo: 'post',
            ruta: '/prueba/redirigir',
            operacion: 'pruebaRedirigir',
            resumen: 'prueba',
            etiqueta: 'prueba',
            seguridad: 'publico',
            permiso: null,
            respuesta: { status: 303, descripcion: 'Vuelve' },
            handler: async () => redirigir('/x'),
        })
        const doc = generarOpenApi([ruta], INFO) as any
        const respuestas = doc.paths['/api/v1/prueba/redirigir'].post.responses
        assert.notProperty(respuestas, '200')
        assert.notProperty(respuestas['303'], 'content')
        assert.equal(respuestas['303'].headers.Location.schema.format, 'uri-reference')
        assert.isTrue(respuestas['303'].headers.Location.required)
    })

    test('una redirección con schema no pasa la validación del registro', ({ assert }) => {
        const ruta = definirRuta({
            metodo: 'post',
            ruta: '/prueba/redirigir',
            operacion: 'pruebaRedirigir',
            resumen: 'prueba',
            etiqueta: 'prueba',
            seguridad: 'publico',
            permiso: null,
            respuesta: { status: 303, descripcion: 'Vuelve', esquema: { type: 'string' } },
        }) as Ruta
        assert.throws(() => generarOpenApi([ruta], INFO), /no lleva schema/)
    })

    test('POST /pasarela/falsa/:cobro/formulario declara 303 en el OpenAPI real', async ({ assert }) => {
        const doc = JSON.parse(await construirOpenApi())
        const respuestas = doc.paths['/api/v1/pasarela/falsa/{cobro}/formulario'].post.responses
        assert.property(respuestas, '303')
        assert.notProperty(respuestas, '200')
        assert.property(respuestas['303'].headers, 'Location')
    })
})
