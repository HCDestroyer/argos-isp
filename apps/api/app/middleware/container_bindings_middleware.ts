import { Logger } from '@adonisjs/core/logger'
import { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * Registra en el contenedor el HttpContext y el logger de la petición.
 */
export default class ContainerBindingsMiddleware {
    handle(ctx: HttpContext, next: NextFn) {
        ctx.containerResolver.bindValue(HttpContext, ctx)
        ctx.containerResolver.bindValue(Logger, ctx.logger)

        return next()
    }
}
