import db from '@adonisjs/lucid/services/db'
import type Usuario from '#core/models/usuario'

/**
 * Consultas mínimas del ACL para login, `/me` y el middleware `autorizar`.
 * Los alcances por router/zona/caja (`usuarios_roles.alcance_*`) los aplica A1.
 */

export interface Me {
    id: number
    nombre: string
    email: string
    roles: string[]
    permisos: string[]
}

export async function permisosDeUsuario(usuarioId: number): Promise<string[]> {
    const filas = (await db
        .from('core.usuarios_roles as ur')
        .join('core.roles_permisos as rp', 'rp.role_id', 'ur.role_id')
        .join('core.permisos as p', 'p.id', 'rp.permiso_id')
        .where('ur.usuario_id', usuarioId)
        .distinct('p.nombre')
        .orderBy('p.nombre', 'asc')) as Array<{ nombre: string }>
    return filas.map((fila) => fila.nombre)
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

export async function construirMe(usuario: Usuario): Promise<Me> {
    const [roles, permisos] = await Promise.all([rolesDeUsuario(usuario.id), permisosDeUsuario(usuario.id)])
    return { id: usuario.id, nombre: usuario.nombre, email: usuario.email, roles, permisos }
}
