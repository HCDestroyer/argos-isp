import { EventEmitter } from 'node:events'
import { test } from '@japa/runner'
import type { HttpContext } from '@adonisjs/core/http'
import RequestIdMiddleware, { registrarAcceso } from '#middleware/request_id_middleware'

/**
 * Log de acceso (pedido de A6): una línea por petición con `request_id`, método, patrón de ruta,
 * status y duración; sin cuerpo ni query.
 */

function ctxFalso(opciones: { patron?: string; headers?: Record<string, string> } = {}) {
    const lineas: Array<{ datos: Record<string, unknown>; mensaje: string }> = []
    const hijos: Array<Record<string, unknown>> = []
    const logger = {
        info: (datos: Record<string, unknown>, mensaje: string) => lineas.push({ datos, mensaje }),
        child(enlaces: Record<string, unknown>) {
            hijos.push(enlaces)
            return logger
        },
    }
    const respuesta = Object.assign(new EventEmitter(), { statusCode: 200 })
    const ctx = {
        requestId: 'req-prueba',
        logger,
        route: opciones.patron ? { pattern: opciones.patron } : undefined,
        request: {
            method: () => 'GET',
            header: (nombre: string) => opciones.headers?.[nombre],
        },
        response: { response: respuesta, header: () => undefined },
    }
    return { ctx: ctx as unknown as HttpContext, lineas, hijos, respuesta }
}

test.group('Log de acceso', () => {
    test('una línea al terminar con request_id, método, patrón, status y duración', ({ assert }) => {
        const { ctx, lineas, respuesta } = ctxFalso({ patron: '/api/v1/servicios/:id' })
        registrarAcceso(ctx)
        assert.lengthOf(lineas, 0)
        respuesta.statusCode = 404
        respuesta.emit('finish')
        respuesta.emit('close')
        assert.lengthOf(lineas, 1)
        const { datos, mensaje } = lineas[0]!
        assert.equal(mensaje, 'petición')
        assert.containsSubset(datos, {
            request_id: 'req-prueba',
            metodo: 'GET',
            ruta: '/api/v1/servicios/:id',
            status: 404,
        })
        assert.isAtLeast(datos.duracion_ms as number, 0)
        assert.sameMembers(Object.keys(datos), ['request_id', 'metodo', 'ruta', 'status', 'duracion_ms'])
    })

    test('sin ruta (404 del router) la ruta va null; una conexión cortada también deja línea', ({
        assert,
    }) => {
        const { ctx, lineas, respuesta } = ctxFalso()
        registrarAcceso(ctx)
        respuesta.emit('close')
        assert.lengthOf(lineas, 1)
        assert.isNull(lineas[0]!.datos.ruta)
    })

    test('el middleware usa X-Request-Id y nombra el campo request_id en el logger', async ({ assert }) => {
        const { ctx, hijos, lineas, respuesta } = ctxFalso({ headers: { 'x-request-id': 'abc-123' } })
        await new RequestIdMiddleware().handle(ctx, async () => {})
        assert.equal(ctx.requestId, 'abc-123')
        assert.deepEqual(hijos, [{ request_id: 'abc-123' }])
        respuesta.emit('finish')
        assert.equal(lineas[0]!.datos.request_id, 'abc-123')
    })
})
