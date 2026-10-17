import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import type { Authenticators } from '@adonisjs/auth/types'
import { NoAutenticado } from '#shared/errores'
import { SesionExpirada, borrarCookieSesionPanel, verificarCsrf } from '#core/auth/sesion_panel'

/**
 * Exige un usuario autenticado y activo. Por defecto acepta, en este orden, el Bearer de login
 * (guard `api`), los tokens de API con alcances (guard `tokens`, `atk_...`) y la cookie `HttpOnly`
 * del panel (guard `panel`, solo sin `Authorization`). Con la cookie, los métodos no seguros pasan
 * por la verificación CSRF (`X-CSRF-Token` + `Origin`): 403 `csrf_invalido`. Una cookie con una
 * sesión vencida (inactividad o tope) responde 401 `sesion_expirada` y borra la cookie; sin
 * credenciales o con un token inválido, 401 `no_autenticado`.
 */
export default class AuthMiddleware {
    async handle(ctx: HttpContext, next: NextFn, options: { guards?: (keyof Authenticators)[] } = {}) {
        try {
            await ctx.auth.authenticateUsing(options.guards ?? ['api', 'tokens', 'panel'])
        } catch {
            if (ctx.auth.use('panel').expirada) {
                borrarCookieSesionPanel(ctx)
                throw new SesionExpirada()
            }
            throw new NoAutenticado()
        }
        if (!ctx.auth.user?.activo) throw new NoAutenticado('El usuario está desactivado')
        if (ctx.auth.authenticatedViaGuard === 'panel') {
            verificarCsrf(ctx, ctx.auth.use('panel').tokenSesion!)
        }
        return next()
    }
}
