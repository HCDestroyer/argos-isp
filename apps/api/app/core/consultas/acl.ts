import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'
import { empresasAsignadas } from '#core/alcance_empresas'
import { NOMBRES_PERMISOS, ROLES_BASE } from '#core/permisos'
import type { AlcancesToken } from '#core/acl'

/**
 * Lecturas del ACL: usuarios con sus roles, roles con sus permisos, catálogo y tokens de API.
 * Nunca devuelven `password_hash` ni el hash de los tokens.
 */

export interface AsignacionRolVista {
    role_id: number
    rol: string
    alcance_tipo: 'router' | 'zona' | 'caja' | null
    alcance_id: number | null
}

export interface UsuarioVista {
    id: number
    nombre: string
    email: string
    activo: boolean
    roles: AsignacionRolVista[]
    /** ve y opera todas las empresas (multiempresa) */
    alcance_global: boolean
    /** empresas asignadas (`core.usuarios_empresas`); vacía con alcance global */
    empresas: number[]
    version: number
    created_at: string
    updated_at: string
}

export interface RolVista {
    id: number
    nombre: string
    descripcion: string | null
    /** rol base del seed (`ROLES_BASE`): sus permisos se definen en código y no se editan */
    base: boolean
    permisos: string[]
    version: number
    created_at: string
    updated_at: string
}

export interface TokenApiVista {
    id: number
    usuario_id: number
    nombre: string
    alcances: AlcancesToken
    ultimo_uso: string | null
    revocado_en: string | null
    created_at: string
}

const COLUMNAS_USUARIO = [
    'id',
    'nombre',
    'email',
    'activo',
    'alcance_global',
    'version',
    'created_at',
    'updated_at',
]
const COLUMNAS_TOKEN = ['id', 'usuario_id', 'nombre', 'alcances', 'ultimo_uso', 'revocado_en', 'created_at']

async function asignacionesDe(
    cliente: QueryClientContract,
    usuarioIds: number[],
): Promise<Map<number, AsignacionRolVista[]>> {
    const mapa = new Map<number, AsignacionRolVista[]>()
    if (usuarioIds.length === 0) return mapa
    const filas = (await cliente
        .from('core.usuarios_roles as ur')
        .join('core.roles as r', 'r.id', 'ur.role_id')
        .whereIn('ur.usuario_id', usuarioIds)
        .orderBy(['r.nombre', 'ur.alcance_tipo', 'ur.alcance_id'])
        .select(
            'ur.usuario_id',
            'ur.role_id',
            'r.nombre as rol',
            'ur.alcance_tipo',
            'ur.alcance_id',
        )) as Array<AsignacionRolVista & { usuario_id: number }>
    for (const { usuario_id: usuarioId, ...asignacion } of filas) {
        const lista = mapa.get(usuarioId) ?? []
        lista.push(asignacion)
        mapa.set(usuarioId, lista)
    }
    return mapa
}

export async function listarUsuarios(opciones: OpcionesPaginacion): Promise<Pagina<UsuarioVista>> {
    const pagina = await paginar<Omit<UsuarioVista, 'roles' | 'empresas'>>(
        db.from('core.usuarios').select(COLUMNAS_USUARIO),
        opciones,
    )
    const ids = pagina.data.map((u) => u.id)
    const roles = await asignacionesDe(db.connection(), ids)
    const empresas = await empresasAsignadas(ids)
    return {
        data: pagina.data.map((u) => ({
            ...u,
            roles: roles.get(u.id) ?? [],
            empresas: empresas.get(u.id) ?? [],
        })),
        nextCursor: pagina.nextCursor,
    }
}

export async function verUsuario(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await cliente
        .from('core.usuarios')
        .where('id', id)
        .select(COLUMNAS_USUARIO)
        .first()) as Omit<UsuarioVista, 'roles' | 'empresas'> | null
    if (!fila) throw new NoEncontrado(`El usuario ${id} no existe`)
    const roles = await asignacionesDe(cliente, [id])
    const empresas = await empresasAsignadas([id], cliente)
    return { ...fila, roles: roles.get(id) ?? [], empresas: empresas.get(id) ?? [] } satisfies UsuarioVista
}

export async function listarRoles(cliente: QueryClientContract = db.connection()): Promise<RolVista[]> {
    const roles = (await cliente
        .from('core.roles')
        .orderBy('nombre')
        .select('id', 'nombre', 'descripcion', 'version', 'created_at', 'updated_at')) as Array<
        Omit<RolVista, 'permisos' | 'base'>
    >
    const permisos = (await cliente
        .from('core.roles_permisos as rp')
        .join('core.permisos as p', 'p.id', 'rp.permiso_id')
        .orderBy('p.nombre')
        .select('rp.role_id', 'p.nombre')) as Array<{ role_id: number; nombre: string }>
    return roles.map((rol) => ({
        ...rol,
        base: Object.hasOwn(ROLES_BASE, rol.nombre),
        permisos: permisos.filter((p) => p.role_id === rol.id).map((p) => p.nombre),
    }))
}

export async function verRol(id: number, cliente: QueryClientContract = db.connection()): Promise<RolVista> {
    const roles = await listarRoles(cliente)
    const rol = roles.find((r) => r.id === id)
    if (!rol) throw new NoEncontrado(`El rol ${id} no existe`)
    return rol
}

export async function listarPermisos() {
    // solo los del catálogo de código: un permiso que se retiró de `permisos.ts` queda en la base
    // (el seed no borra) pero ya no protege nada
    return (await db
        .from('core.permisos')
        .whereIn('nombre', NOMBRES_PERMISOS)
        .orderBy('nombre')
        .select('id', 'nombre', 'descripcion')) as Array<{
        id: number
        nombre: string
        descripcion: string | null
    }>
}

export async function listarTokens(opciones: OpcionesPaginacion): Promise<Pagina<TokenApiVista>> {
    return paginar<TokenApiVista>(db.from('core.tokens_api').select(COLUMNAS_TOKEN), opciones)
}

export async function verToken(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await cliente
        .from('core.tokens_api')
        .where('id', id)
        .select(COLUMNAS_TOKEN)
        .first()) as TokenApiVista | null
    if (!fila) throw new NoEncontrado(`El token ${id} no existe`)
    return fila
}
