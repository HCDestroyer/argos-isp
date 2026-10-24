import type { HttpContext } from '@adonisjs/core/http'
import { exigirAcceso } from '#billing/empresa'
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
