import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { alcanceDePermiso, type Alcance, type AlcancesToken } from '#core/acl'
import { NoAutenticado, Prohibido } from '#shared/errores'

/**
 * `middleware.autorizar({ permiso: 'servicios.suspender' })`: 403 Problem si el usuario
 * autenticado no tiene el permiso por ninguno de sus roles (o si su token de API no lo incluye).
 * Deja en `ctx.alcance` el alcance por router/zona/caja con el que lo tiene; los handlers lo
 * aplican con `filtrarPorAlcance` (listas) y `exigirAlcance` (un recurso). Va después de `auth`.
 */
export default class AutorizarMiddleware {
    async handle(ctx: HttpContext, next: NextFn, opciones: { permiso: string }) {
        const usuario = ctx.auth.user
        if (!usuario) throw new NoAutenticado()

        const alcance = await alcanceDePermiso(usuario.id, opciones.permiso, alcancesDelToken(ctx))
        if (!alcance) throw new Prohibido(`Se requiere el permiso ${opciones.permiso}`)
        ctx.alcance = alcance
        return next()
    }
}

/** Alcances del token de API con el que se autenticó la petición (null con sesión de login). */
export function alcancesDelToken(ctx: HttpContext): AlcancesToken | null {
    if (ctx.auth.authenticatedViaGuard !== 'tokens') return null
    return ctx.auth.use('tokens').token?.alcances ?? null
}

declare module '@adonisjs/core/http' {
    interface HttpContext {
        /** Alcance del permiso de la ruta (lo carga `autorizar`). */
        alcance?: Alcance
    }
}
