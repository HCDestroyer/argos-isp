import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import type { Authenticators } from '@adonisjs/auth/types'
import { NoAutenticado } from '#shared/errores'

/**
 * Exige `Authorization: Bearer <token>` válido y usuario activo. Por defecto acepta el token de
 * sesión del login (guard `api`) y los tokens de API con alcances (guard `tokens`, `atk_...`).
 */
export default class AuthMiddleware {
    async handle(ctx: HttpContext, next: NextFn, options: { guards?: (keyof Authenticators)[] } = {}) {
        try {
            await ctx.auth.authenticateUsing(options.guards ?? ['api', 'tokens'])
        } catch {
            throw new NoAutenticado()
        }
        if (!ctx.auth.user?.activo) throw new NoAutenticado('El usuario está desactivado')
        return next()
    }
}
