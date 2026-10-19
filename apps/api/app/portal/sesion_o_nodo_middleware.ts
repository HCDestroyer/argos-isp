import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import AuthMiddleware from '#middleware/auth_middleware'
import EmpresaMiddleware from '#middleware/empresa_middleware'
import { tokenNodoDeLaPeticion, validarTokenNodo } from '#portal/nodo_portal'

/**
 * Rutas con `nodoPortal: true` (hoy `GET /version`): con `X-Argos-Nodo-Token` valida el token del
 * nodo (401 `nodo_portal_invalido` si no existe o fue revocado) y sigue sin usuario; sin esa
 * cabecera, lo de siempre: `auth` y luego `empresa`.
 */
export default class SesionONodoMiddleware {
    async handle(ctx: HttpContext, next: NextFn) {
        if (tokenNodoDeLaPeticion(ctx)) {
            await validarTokenNodo(ctx)
            return next()
        }
        return new AuthMiddleware().handle(ctx, () => new EmpresaMiddleware().handle(ctx, next))
    }
}
