import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'
import { filtrarPorAlcance, type Alcance } from '#core/acl'
import type { ControlVelocidad } from '#network/velocidad'

/**
 * Lecturas de routers y redes IPv4. Las credenciales nunca salen: solo `tiene_api_password` y
 * `tiene_radius_secret`.
 */

export interface RouterVista {
    id: number
    nombre: string
    host: string
    api_usuario: string | null
    tiene_api_password: boolean
    tiene_radius_secret: boolean
    nas_ip: string
    modo_seguridad: 'radius' | 'api'
    /** cola simple por servicio o árbol con PCQ por plan (`contratos/velocidad.md`) */
    control_velocidad: ControlVelocidad
    /** techo del padre global; null = sin techo */
    capacidad_bajada_kbps: number | null
    capacidad_subida_kbps: number | null
    /** @deprecated derivado de `control_velocidad` (`arbol_pcq` → `pcq`) */
    modo_velocidad: 'simple' | 'pcq'
    activo: boolean
    version: number
    created_at: string
    updated_at: string
}

export interface RedIpv4Vista {
    id: number
    router_id: number
    cidr: string
    gateway: string | null
    tipo: 'estatico' | 'pool'
    version: number
    created_at: string
    updated_at: string
}

const COLUMNAS_ROUTER = [
    'id',
    'nombre',
    'host',
    'api_usuario',
    db.raw('(api_password IS NOT NULL) AS tiene_api_password'),
    db.raw('(radius_secret IS NOT NULL) AS tiene_radius_secret'),
    db.raw('host(nas_ip) AS nas_ip'),
    'modo_seguridad',
    'control_velocidad',
    'capacidad_bajada_kbps',
    'capacidad_subida_kbps',
    db.raw(`CASE control_velocidad WHEN 'arbol_pcq' THEN 'pcq' ELSE 'simple' END AS modo_velocidad`),
    'activo',
    'version',
    'created_at',
    'updated_at',
]

export async function listarRouters(
    filtros: OpcionesPaginacion & { activo?: boolean },
    alcance?: Alcance,
): Promise<Pagina<RouterVista>> {
    const consulta = db.from('network.routers').select(COLUMNAS_ROUTER)
    if (filtros.activo !== undefined) consulta.where('activo', filtros.activo)
    filtrarPorAlcance(consulta, alcance, { router: (q, ids) => q.whereIn('id', ids) })
    return paginar<RouterVista>(consulta, filtros)
}

export async function verRouter(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<RouterVista> {
    const fila = (await cliente
        .from('network.routers')
        .where('id', id)
        .select(COLUMNAS_ROUTER)
        .first()) as RouterVista | null
    if (!fila) throw new NoEncontrado(`El router ${id} no existe`)
    return fila
}

const COLUMNAS_RED = [
    'id',
    'router_id',
    db.raw('cidr::text AS cidr'),
    db.raw('host(gateway) AS gateway'),
    'tipo',
    'version',
    'created_at',
    'updated_at',
]

export async function listarRedesIpv4(routerId: number): Promise<RedIpv4Vista[]> {
    await verRouter(routerId)
    return (await db
        .from('network.redes_ipv4')
        .where('router_id', routerId)
        .orderBy('cidr')
        .select(COLUMNAS_RED)) as RedIpv4Vista[]
}

export async function verRedIpv4(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await cliente
        .from('network.redes_ipv4')
        .where('id', id)
        .select(COLUMNAS_RED)
        .first()) as RedIpv4Vista | null
    if (!fila) throw new NoEncontrado(`La red ${id} no existe`)
    return fila
}
