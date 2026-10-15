import db from '@adonisjs/lucid/services/db'
import type { DatabaseQueryBuilderContract } from '@adonisjs/lucid/types/querybuilder'
import type Usuario from '#core/models/usuario'
import { Prohibido } from '#shared/errores'

/**
 * ACL: permisos efectivos y alcance por router, zona o caja.
 *
 * - Permiso = nombre de la acción (`servicios.suspender`). Un usuario lo tiene si alguno de sus
 *   roles lo incluye (`core.usuarios_roles` → `core.roles_permisos`).
 * - Cada asignación de rol puede llevar un alcance (`alcance_tipo` + `alcance_id`). Si al menos una
 *   asignación que otorga el permiso es global, el permiso no tiene restricción de rol; si todas
 *   tienen alcance, el usuario solo actúa sobre recursos de esos routers, zonas o cajas.
 * - Un token de API (`core.tokens_api`) es el mismo usuario con alcances más acotados: `permisos`
 *   recorta los permisos y `routers`/`zonas`/`cajas` restringen además (se combinan con Y).
 * - Un alcance solo aplica a los recursos que tienen esa dimensión: un rol con alcance de caja no
 *   limita qué clientes ve; un rol con alcance de router sí limita servicios y clientes.
 */

export const TIPOS_ALCANCE = ['router', 'zona', 'caja'] as const
export type TipoAlcance = (typeof TIPOS_ALCANCE)[number]

/** `core.tokens_api.alcances` */
export interface AlcancesToken {
    permisos?: string[]
    routers?: number[]
    zonas?: number[]
    cajas?: number[]
}

export interface Alcance {
    /** null: algún rol otorga el permiso sin alcance. */
    rol: Record<TipoAlcance, number[]> | null
    /** restricciones del token de API (Y lógico); null fuera de tokens */
    token: Partial<Record<TipoAlcance, number[]>> | null
}

export const ALCANCE_TOTAL: Alcance = { rol: null, token: null }

/** Dimensiones de un recurso concreto: ids de router/zona/caja a los que pertenece. */
export type DimensionesRecurso = Partial<Record<TipoAlcance, Array<number | null | undefined>>>

const CLAVES_TOKEN: Record<TipoAlcance, 'routers' | 'zonas' | 'cajas'> = {
    router: 'routers',
    zona: 'zonas',
    caja: 'cajas',
}

export interface Me {
    id: number
    nombre: string
    email: string
    roles: string[]
    permisos: string[]
}

export async function permisosDeUsuario(usuarioId: number, token?: AlcancesToken | null): Promise<string[]> {
    const filas = (await db
        .from('core.usuarios_roles as ur')
        .join('core.roles_permisos as rp', 'rp.role_id', 'ur.role_id')
        .join('core.permisos as p', 'p.id', 'rp.permiso_id')
        .where('ur.usuario_id', usuarioId)
        .distinct('p.nombre')
        .orderBy('p.nombre', 'asc')) as Array<{ nombre: string }>
    const permisos = filas.map((fila) => fila.nombre)
    if (!token?.permisos) return permisos
    const permitidos = new Set(token.permisos)
    return permisos.filter((p) => permitidos.has(p))
}

export async function rolesDeUsuario(usuarioId: number): Promise<string[]> {
    const filas = (await db
        .from('core.usuarios_roles as ur')
        .join('core.roles as r', 'r.id', 'ur.role_id')
        .where('ur.usuario_id', usuarioId)
        .distinct('r.nombre')
        .orderBy('r.nombre', 'asc')) as Array<{ nombre: string }>
    return filas.map((fila) => fila.nombre)
}

/**
 * Alcance con el que el usuario tiene `permiso`, o null si no lo tiene.
 */
export async function alcanceDePermiso(
    usuarioId: number,
    permiso: string,
    token?: AlcancesToken | null,
): Promise<Alcance | null> {
    if (token?.permisos && !token.permisos.includes(permiso)) return null

    const filas = (await db
        .from('core.usuarios_roles as ur')
        .join('core.roles_permisos as rp', 'rp.role_id', 'ur.role_id')
        .join('core.permisos as p', 'p.id', 'rp.permiso_id')
        .where('ur.usuario_id', usuarioId)
        .where('p.nombre', permiso)
        .select('ur.alcance_tipo', 'ur.alcance_id')) as Array<{
        alcance_tipo: TipoAlcance | null
        alcance_id: number | null
    }>
    if (filas.length === 0) return null

    let rol: Alcance['rol'] = { router: [], zona: [], caja: [] }
    for (const fila of filas) {
        if (fila.alcance_tipo === null || fila.alcance_id === null) {
            rol = null
            break
        }
        rol[fila.alcance_tipo].push(fila.alcance_id)
    }

    let restricciones: Alcance['token'] = null
    if (token) {
        for (const tipo of TIPOS_ALCANCE) {
            const ids = token[CLAVES_TOKEN[tipo]]
            if (ids) {
                restricciones ??= {}
                restricciones[tipo] = ids
            }
        }
    }
    return { rol, token: restricciones }
}

/** ¿El alcance cubre un recurso con estas dimensiones? */
export function permite(alcance: Alcance | undefined, recurso: DimensionesRecurso): boolean {
    if (!alcance) return true
    const presentes = TIPOS_ALCANCE.filter((tipo) => recurso[tipo] !== undefined)
    const contiene = (tipo: TipoAlcance, ids: number[]) =>
        (recurso[tipo] ?? []).some((valor) => valor !== null && valor !== undefined && ids.includes(valor))

    if (alcance.rol) {
        const rol = alcance.rol
        const tiposConGrant = TIPOS_ALCANCE.filter((tipo) => rol[tipo].length > 0)
        // Un grant de una dimensión que el recurso no tiene no lo restringe.
        const aplicables = tiposConGrant.filter((tipo) => presentes.includes(tipo))
        const libre = tiposConGrant.some((tipo) => !presentes.includes(tipo))
        if (!libre && !aplicables.some((tipo) => contiene(tipo, rol[tipo]))) return false
    }
    if (alcance.token) {
        for (const tipo of presentes) {
            const ids = alcance.token[tipo]
            if (ids && !contiene(tipo, ids)) return false
        }
    }
    return true
}

/** 403 si el recurso queda fuera del alcance. */
export function exigirAlcance(alcance: Alcance | undefined, recurso: DimensionesRecurso): void {
    if (!permite(alcance, recurso)) {
        throw new Prohibido('El recurso está fuera del alcance (router, zona o caja) de tus permisos')
    }
}

type Consulta = DatabaseQueryBuilderContract<any>

/** Cómo filtra una consulta por cada dimensión: `(q, ids) => q.whereIn('s.router_id', ids)`. */
export type FiltrosDimension = Partial<Record<TipoAlcance, (q: Consulta, ids: number[]) => void>>

/** Aplica el alcance a una consulta de lista (mismas reglas que `permite`). */
export function filtrarPorAlcance<Q extends Consulta>(
    consulta: Q,
    alcance: Alcance | undefined,
    dimensiones: FiltrosDimension,
): Q {
    if (!alcance) return consulta
    const presentes = TIPOS_ALCANCE.filter((tipo) => dimensiones[tipo] !== undefined)

    if (alcance.rol) {
        const rol = alcance.rol
        const tiposConGrant = TIPOS_ALCANCE.filter((tipo) => rol[tipo].length > 0)
        const libre = tiposConGrant.some((tipo) => !presentes.includes(tipo))
        if (!libre) {
            consulta.where((sub) => {
                for (const tipo of tiposConGrant) {
                    sub.orWhere((q) => dimensiones[tipo]!(q, rol[tipo]))
                }
            })
        }
    }
    if (alcance.token) {
        for (const tipo of presentes) {
            const ids = alcance.token[tipo]
            if (ids) consulta.where((q) => dimensiones[tipo]!(q, ids))
        }
    }
    return consulta
}

export async function construirMe(usuario: Usuario, token?: AlcancesToken | null): Promise<Me> {
    const [roles, permisos] = await Promise.all([
        rolesDeUsuario(usuario.id),
        permisosDeUsuario(usuario.id, token),
    ])
    return { id: usuario.id, nombre: usuario.nombre, email: usuario.email, roles, permisos }
}
