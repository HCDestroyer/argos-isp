import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { permisosDeUsuario } from '#core/acl'
import { NoAutenticado, Prohibido } from '#shared/errores'

/**
 * `middleware.autorizar({ permiso: 'servicios.suspender' })`: 403 Problem si el usuario
 * autenticado no tiene el permiso por ninguno de sus roles. Va después de `auth`.
 */
export default class AutorizarMiddleware {
    async handle(ctx: HttpContext, next: NextFn, opciones: { permiso: string }) {
        const usuario = ctx.auth.user
        if (!usuario) throw new NoAutenticado()

        ctx.permisos ??= new Set(await permisosDeUsuario(usuario.id))
        if (!ctx.permisos.has(opciones.permiso)) {
            throw new Prohibido(`Se requiere el permiso ${opciones.permiso}`)
        }
        return next()
    }
}

declare module '@adonisjs/core/http' {
    interface HttpContext {
        /** Permisos efectivos del usuario autenticado (cargados por `autorizar`). */
        permisos?: Set<string>
    }
}
