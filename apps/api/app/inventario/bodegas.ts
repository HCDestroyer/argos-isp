import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { DatabaseQueryBuilderContract } from '@adonisjs/lucid/types/querybuilder'
import type { Alcance } from '#core/acl'
import { Conflicto, NoEncontrado, Prohibido } from '#shared/errores'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'

/**
 * Bodegas (`contratos/inventario.md` §4): un lugar (`bodega`) o un técnico (`tecnico`, con su
 * `usuario_id`). Lectura y reglas de acceso:
 *
 * - **Alcance ACL.** Una bodega con `zona_id` o `router_id` solo la ve y la mueve quien tenga el
 *   permiso sin alcance o con alcance de esa zona o router; una sin zona ni router no se restringe.
 * - **Tope por técnico.** Una bodega `tecnico` solo la ve y la mueve su `usuario_id` o quien tenga el
 *   permiso con alcance global (un rol sin alcance de router, zona o caja, y sin restricciones de
 *   token). Un técnico que solo debe operar su bodega recibe su rol con alcance (zona o router).
 */

export const TIPOS_BODEGA = ['bodega', 'tecnico'] as const
export type TipoBodega = (typeof TIPOS_BODEGA)[number]
/** Tipos que se leen: además la bodega virtual «en tránsito» de las órdenes de traslado (fase D). */
export const TIPOS_BODEGA_VISTA = ['bodega', 'tecnico', 'transito'] as const
export type TipoBodegaVista = (typeof TIPOS_BODEGA_VISTA)[number]

export interface BodegaVista {
    id: number
    empresa_id: number
    nombre: string
    tipo: TipoBodegaVista
    usuario_id: number | null
    usuario_nombre: string | null
    zona_id: number | null
    router_id: number | null
    activo: boolean
    version: number
    created_at: Date
    updated_at: Date
}

function consulta(cliente: QueryClientContract) {
    return cliente
        .from('inventario.bodegas as b')
        .leftJoin('core.usuarios as u', 'u.id', 'b.usuario_id')
        .select(
            'b.id',
            'b.empresa_id',
            'b.nombre',
            'b.tipo',
            'b.usuario_id',
            'u.nombre as usuario_nombre',
            'b.zona_id',
            'b.router_id',
            'b.activo',
            'b.version',
            'b.created_at',
            'b.updated_at',
        )
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

function normalizar(fila: BodegaVista): BodegaVista {
    return {
        ...fila,
        id: Number(fila.id),
        empresa_id: Number(fila.empresa_id),
        usuario_id: n(fila.usuario_id),
        zona_id: n(fila.zona_id),
        router_id: n(fila.router_id),
        version: Number(fila.version),
    }
}

export async function verBodega(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await consulta(cliente).where('b.id', id).first()) as BodegaVista | null
    if (!fila) throw new NoEncontrado(`La bodega ${id} no existe`)
    return normalizar(fila)
}

/** Quién pide y con qué alcance (el del permiso de la ruta). Sin alcance: sin restricción. */
export interface AccesoBodegas {
    alcance?: Alcance
    usuarioId: number | null
}

/** ¿El permiso se tiene sin alcance de rol ni restricciones de token? */
export function alcanceGlobal(alcance: Alcance | undefined): boolean {
    return !alcance || (alcance.rol === null && alcance.token === null)
}

/** ¿Puede ver y mover esta bodega? (alcance por zona o router y tope por técnico) */
export function puedeOperarBodega(
    acceso: AccesoBodegas,
    bodega: Pick<BodegaVista, 'tipo' | 'usuario_id' | 'zona_id' | 'router_id'>,
): boolean {
    if (
        bodega.tipo === 'tecnico' &&
        bodega.usuario_id !== acceso.usuarioId &&
        !alcanceGlobal(acceso.alcance)
    ) {
        return false
    }
    const alcance = acceso.alcance
    if (!alcance) return true
    if (bodega.zona_id === null && bodega.router_id === null) return true
    const cubre = (ids: number[] | undefined, valor: number | null) =>
        ids === undefined || (valor !== null && ids.includes(valor))
    if (alcance.rol) {
        const { zona, router } = alcance.rol
        // como `permite` del núcleo: un grant de caja (dimensión que la bodega no tiene) no la restringe
        const libre = alcance.rol.caja.length > 0
        if (
            !libre &&
            !(bodega.zona_id !== null && zona.includes(bodega.zona_id)) &&
            !(bodega.router_id !== null && router.includes(bodega.router_id))
        ) {
            return false
        }
    }
    if (alcance.token) {
        if (bodega.zona_id !== null && !cubre(alcance.token.zona, bodega.zona_id)) return false
        if (bodega.router_id !== null && !cubre(alcance.token.router, bodega.router_id)) return false
    }
    return true
}

/** 403 si la bodega queda fuera del acceso. */
export function exigirOperarBodega(
    acceso: AccesoBodegas,
    bodega: Pick<BodegaVista, 'id' | 'tipo' | 'usuario_id' | 'zona_id' | 'router_id'>,
): void {
    if (!puedeOperarBodega(acceso, bodega)) {
        throw new Prohibido(
            bodega.tipo === 'tecnico'
                ? `La bodega ${bodega.id} es de otro técnico`
                : `La bodega ${bodega.id} está fuera del alcance (zona o router) de tus permisos`,
        )
    }
}

/** Filtra una consulta que une `inventario.bodegas` como `alias` con las mismas reglas. */
export function filtrarBodegasVisibles<Q extends DatabaseQueryBuilderContract<any>>(
    q0: Q,
    acceso: AccesoBodegas | undefined,
    alias = 'b',
): Q {
    if (!acceso) return q0
    if (!alcanceGlobal(acceso.alcance)) {
        q0.where((q) => {
            q.whereNot(`${alias}.tipo`, 'tecnico')
            if (acceso.usuarioId !== null) q.orWhere(`${alias}.usuario_id`, acceso.usuarioId)
        })
    }
    const alcance = acceso.alcance
    if (!alcance) return q0
    if (alcance.rol) {
        const { zona, router, caja } = alcance.rol
        const libre = caja.length > 0
        if (!libre) {
            q0.where((q) => {
                q.where((s) => s.whereNull(`${alias}.zona_id`).whereNull(`${alias}.router_id`))
                if (zona.length > 0) q.orWhereIn(`${alias}.zona_id`, zona)
                if (router.length > 0) q.orWhereIn(`${alias}.router_id`, router)
            })
        }
    }
    if (alcance.token) {
        const { zona, router } = alcance.token
        if (zona) q0.where((q) => q.whereNull(`${alias}.zona_id`).orWhereIn(`${alias}.zona_id`, zona))
        if (router) {
            q0.where((q) => q.whereNull(`${alias}.router_id`).orWhereIn(`${alias}.router_id`, router))
        }
    }
    return q0
}

export interface FiltrosBodegas extends OpcionesPaginacion {
    tipo?: TipoBodegaVista
    activo?: boolean
    usuario_id?: number
}

export async function listarBodegas(
    filtros: FiltrosBodegas,
    empresas: number[] | null,
    acceso?: AccesoBodegas,
) {
    const q = consulta(db.connection())
        .if(filtros.tipo, (c) => c.where('b.tipo', filtros.tipo!))
        .if(filtros.activo !== undefined, (c) => c.where('b.activo', filtros.activo!))
        .if(filtros.usuario_id, (c) => c.where('b.usuario_id', filtros.usuario_id!))
    filtrarPorEmpresa(q, empresas, (c, ids) => c.whereIn('b.empresa_id', ids))
    filtrarBodegasVisibles(q, acceso)
    const pagina = await paginar<BodegaVista>(q, filtros, { columna: 'b.id' })
    return { data: pagina.data.map(normalizar), nextCursor: pagina.nextCursor }
}

/** La bodega «en tránsito» la crea y la mueve el sistema: no se edita ni se desactiva (409). */
export function exigirBodegaNoTransito(bodega: { id: number; tipo: string }): void {
    if (bodega.tipo === 'transito') {
        throw new Conflicto(
            `La bodega ${bodega.id} es la bodega «en tránsito» de las órdenes de traslado: la mantiene el sistema`,
            'bodega_transito',
            'Bodega del sistema',
        )
    }
}
