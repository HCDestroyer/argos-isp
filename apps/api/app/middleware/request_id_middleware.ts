import { randomUUID } from 'node:crypto'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { contextoCliente, esCanal, type Canal, type ContextoAccion } from '#shared/contexto'

const ID_VALIDO = /^[A-Za-z0-9._:-]{1,128}$/

/**
 * Toma `X-Request-Id` (o genera un UUID), lo devuelve en la respuesta y deja en el ctx
 * `requestId` y `contextoAccion()`, que arma el `ContextoAccion` para las acciones de dominio:
 * actor = usuario autenticado (`token` si entró con un token de API; sistema si es anónimo), canal = header `X-Canal` (por defecto `panel` con la cookie del panel y `api` en lo demás).
 *
 * Log de acceso (pedido de A6): al terminar cada petición, una línea `info` con `request_id`,
 * `metodo`, `ruta` (el patrón de la ruta, p. ej. `/api/v1/servicios/:id`, nunca la URL con datos;
 * null si no hubo ruta), `status` y `duracion_ms`. Sin cuerpo, query ni headers. El logger de la
 * petición lleva `request_id` (mismo nombre que en `audit.*` y en el stream de eventos).
 */
export default class RequestIdMiddleware {
    handle(ctx: HttpContext, next: NextFn) {
        const entrante = ctx.request.header('x-request-id')
        const requestId = entrante && ID_VALIDO.test(entrante) ? entrante : randomUUID()
        const canalHeader = ctx.request.header('x-canal')
        const canal: Canal | null = esCanal(canalHeader) ? canalHeader : null

        ctx.requestId = requestId
        ctx.response.header('X-Request-Id', requestId)
        ctx.logger = ctx.logger.child({ request_id: requestId })
        registrarAcceso(ctx)
        ctx.contextoAccion = (canalForzado?: Canal): ContextoAccion => {
            const usuario = 'auth' in ctx ? ctx.auth.user : undefined
            const guard = usuario !== undefined ? ctx.auth.authenticatedViaGuard : undefined
            return {
                actor: usuario
                    ? { tipo: guard === 'tokens' ? 'token' : 'usuario', id: usuario.id }
                    : { tipo: 'sistema', id: null },
                // la cookie del panel implica canal `panel` si no llega `X-Canal`
                canal: canalForzado ?? canal ?? (guard === 'panel' ? 'panel' : 'api'),
                requestId,
            }
        }
        ctx.contextoCliente = (clienteId: number, canalForzado: Canal = 'portal'): ContextoAccion =>
            contextoCliente(clienteId, requestId, canalForzado)

        return next()
    }
}

/** Escribe la línea de acceso cuando la respuesta termina de enviarse (o se corta la conexión). */
export function registrarAcceso(ctx: HttpContext) {
    const inicio = process.hrtime.bigint()
    const metodo = ctx.request.method()
    const respuesta = ctx.response.response
    let escrito = false
    const escribir = () => {
        if (escrito) return
        escrito = true
        const duracion = Number(process.hrtime.bigint() - inicio) / 1e6
        ctx.logger.info(
            {
                request_id: ctx.requestId,
                metodo,
                ruta: ctx.route?.pattern ?? null,
                status: respuesta.statusCode,
                duracion_ms: Math.round(duracion * 10) / 10,
            },
            'petición',
        )
    }
    respuesta.once('finish', escribir)
    respuesta.once('close', escribir)
}

declare module '@adonisjs/core/http' {
    interface HttpContext {
        requestId: string
        /** Contexto para `DomainAction.execute`. `canalForzado` lo usan rutas de un canal fijo (portal, interno). */
        contextoAccion(canalForzado?: Canal): ContextoAccion
        /** actor `cliente` (portal autenticado; la sesión ya se verificó), canal `portal` por defecto */
        contextoCliente(clienteId: number, canalForzado?: Canal): ContextoAccion
    }
}
