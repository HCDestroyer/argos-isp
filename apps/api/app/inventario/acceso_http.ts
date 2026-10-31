import type { HttpContext } from '@adonisjs/core/http'
import { exigirAcceso } from '#billing/empresa'
import { permisosDeUsuario } from '#core/acl'
import { alcancesDelToken } from '#middleware/autorizar_middleware'
import { Prohibido } from '#shared/errores'
import type { Permiso } from '#core/permisos'
import { exigirOperarBodega, verBodega, type AccesoBodegas } from '#inventario/bodegas'

/**
 * Acceso a una bodega en una ruta (`contratos/inventario.md` §5): la bodega existe (404), es de una
 * empresa del usuario (403) y la puede mover (alcance por zona o router y tope por técnico, 403).
 * El destino de un traslado o de una compra solo revisa el alcance: se le puede entregar al técnico.
 */

export function accesoBodegas(ctx: HttpContext): AccesoBodegas {
    return { alcance: ctx.alcance, usuarioId: ctx.auth.user?.id ?? null }
}

export async function exigirBodega(ctx: HttpContext, bodegaId: number, destino = false): Promise<void> {
    const bodega = await verBodega(bodegaId)
    exigirAcceso(ctx, { empresa_id: bodega.empresa_id })
    exigirOperarBodega(accesoBodegas(ctx), destino ? { ...bodega, tipo: 'bodega' } : bodega)
}

/**
 * 403 si el usuario no tiene además `permiso` (fase D: una operación que hace dos cosas, como el lote de
 * productos con su saldo inicial o el borrador de compra que crea productos y proveedores).
 */
export async function exigirPermiso(ctx: HttpContext, permiso: Permiso): Promise<void> {
    const usuario = ctx.auth.user
    if (!usuario) throw new Prohibido()
    const permisos = await permisosDeUsuario(usuario.id, alcancesDelToken(ctx))
    if (!permisos.includes(permiso)) {
        throw new Prohibido(`Esta operación necesita además el permiso ${permiso}`)
    }
}
