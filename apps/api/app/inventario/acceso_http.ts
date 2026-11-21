import type { HttpContext } from '@adonisjs/core/http'
import { exigirAcceso } from '#billing/empresa'
import { permisosDeUsuario } from '#core/acl'
import { alcancesDelToken } from '#middleware/autorizar_middleware'
import { Problema, Prohibido } from '#shared/errores'
import { FORMATO_IRIS_ACTOR, esTokenIris } from '#integraciones/iris/atencion'
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

/**
 * `X-Iris-Actor` de la petición (contrato Iris 0.11.0 §3.9: quién usó el material sale de la cabecera,
 * nunca del cuerpo). La validan las acciones sobre una bodega de cuadrilla; null si no viene.
 */
export function irisActorDe(ctx: HttpContext): string | null {
    return ctx.request.header('X-Iris-Actor')?.trim() || null
}

/**
 * Rutas de equipos de Iris 0.12.0 §3.10 (A48): con el token de Iris, `X-Iris-Actor: usuario:<id>` es
 * obligatoria (400 `cabecera_iris_requerida`) y el asistente de IA no puede (403 `actor_ia_no_permitido`).
 * Otros actores no la necesitan. Devuelve la cabecera (o null).
 */
export function exigirActorIrisDeCampo(ctx: HttpContext): string | null {
    const actor = irisActorDe(ctx)
    if (!esTokenIris(ctx)) return actor
    if (!actor || !FORMATO_IRIS_ACTOR.test(actor)) {
        throw new Problema(
            400,
            'cabecera_iris_requerida',
            'Faltan las cabeceras de Iris',
            'X-Iris-Actor es obligatoria: `usuario:<id en Iris>`',
        )
    }
    if (actor === 'asistente_ia') {
        throw new Problema(
            403,
            'actor_ia_no_permitido',
            'Acción no permitida al asistente',
            'El asistente de IA no puede hacer esta acción',
        )
    }
    return actor
}
