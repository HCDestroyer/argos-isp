import { randomUUID } from 'node:crypto'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { esCanal, type Canal, type ContextoAccion } from '#shared/contexto'

const ID_VALIDO = /^[A-Za-z0-9._:-]{1,128}$/

/**
 * Toma `X-Request-Id` (o genera un UUID), lo devuelve en la respuesta y deja en el ctx
 * `requestId` y `contextoAccion()`, que arma el `ContextoAccion` para las acciones de dominio:
 * actor = usuario autenticado (o sistema anónimo), canal = header `X-Canal` (por defecto `api`).
 */
export default class RequestIdMiddleware {
    handle(ctx: HttpContext, next: NextFn) {
        const entrante = ctx.request.header('x-request-id')
        const requestId = entrante && ID_VALIDO.test(entrante) ? entrante : randomUUID()
        const canalHeader = ctx.request.header('x-canal')
        const canal: Canal = esCanal(canalHeader) ? canalHeader : 'api'

        ctx.requestId = requestId
        ctx.response.header('X-Request-Id', requestId)
        ctx.logger = ctx.logger.child({ requestId })
        ctx.contextoAccion = (canalForzado?: Canal): ContextoAccion => {
            const usuario = 'auth' in ctx ? ctx.auth.user : undefined
            return {
                actor: usuario ? { tipo: 'usuario', id: usuario.id } : { tipo: 'sistema', id: null },
                canal: canalForzado ?? canal,
                requestId,
            }
        }

        return next()
    }
}

declare module '@adonisjs/core/http' {
    interface HttpContext {
        requestId: string
        /** Contexto para `DomainAction.execute`. `canalForzado` lo usan rutas de un canal fijo (portal, interno). */
        contextoAccion(canalForzado?: Canal): ContextoAccion
    }
}
