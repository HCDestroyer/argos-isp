import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import {
    entregaPoolV6,
    sqlOcupacionPoolV6,
    type EntregaPoolV6,
    type Ocupacion,
    type TipoPoolV6,
} from '#network/ocupacion'

/**
 * Lecturas de bloques y pools IPv6. Un router puede tener varios bloques (de proveedores
 * distintos) y cada bloque varios pools de enlace y de delegación (`contratos/pools.md`).
 */

const COLUMNAS_BLOQUE = [
    'b.id',
    'b.router_id',
    'b.nombre',
    'b.proveedor',
    db.raw('b.prefijo::text AS prefijo'),
    db.raw(`(SELECT json_build_object(
                'pools', count(*),
                'porcentaje_en_pools', COALESCE(round((100 * sum(power(2::float8, masklen(b.prefijo) - masklen(p.prefijo))))::numeric, 1), 0)
             ) FROM network.ipv6_pools p WHERE p.bloque_id = b.id) AS espacio`),
    'b.version',
    'b.created_at',
    'b.updated_at',
]

const COLUMNAS_POOL = [
    'p.id',
    'p.bloque_id',
    'b.router_id',
    'p.nombre',
    db.raw('p.prefijo::text AS prefijo'),
    'p.tipo',
    'p.tamano_entrega',
    'p.nombre_en_router',
    db.raw(`${sqlOcupacionPoolV6('p')} AS ocupacion`),
    'p.version',
    'p.created_at',
    'p.updated_at',
]

export interface BloqueVista {
    id: number
    router_id: number
    nombre: string | null
    proveedor: string | null
    prefijo: string
    espacio: { pools: number; porcentaje_en_pools: number }
    version: number
    created_at: string
    updated_at: string
}

export interface PoolVista {
    id: number
    bloque_id: number
    router_id: number
    nombre: string | null
    prefijo: string
    tipo: TipoPoolV6
    tamano_entrega: 64 | 56 | 48
    nombre_en_router: string | null
    ocupacion: Ocupacion
    entrega: EntregaPoolV6
    version: number
    created_at: string
    updated_at: string
}

function conEntrega(fila: Omit<PoolVista, 'entrega'>): PoolVista {
    return { ...fila, entrega: entregaPoolV6(fila.prefijo, fila.tipo, fila.tamano_entrega) }
}

function consultaPools(cliente: QueryClientContract) {
    return cliente
        .from('network.ipv6_pools as p')
        .join('network.ipv6_bloques as b', 'b.id', 'p.bloque_id')
        .select(COLUMNAS_POOL)
}

export async function listarBloques(routerId: number): Promise<BloqueVista[]> {
    const router = await db.from('network.routers').where('id', routerId).first()
    if (!router) throw new NoEncontrado(`El router ${routerId} no existe`)
    return (await db
        .from('network.ipv6_bloques as b')
        .where('b.router_id', routerId)
        .orderBy('b.prefijo')
        .select(COLUMNAS_BLOQUE)) as BloqueVista[]
}

export async function verBloque(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await cliente
        .from('network.ipv6_bloques as b')
        .where('b.id', id)
        .select(COLUMNAS_BLOQUE)
        .first()) as BloqueVista | null
    if (!fila) throw new NoEncontrado(`El bloque IPv6 ${id} no existe`)
    return fila
}

export async function listarPools(bloqueId: number): Promise<PoolVista[]> {
    await verBloque(bloqueId)
    const filas = (await consultaPools(db.connection())
        .where('p.bloque_id', bloqueId)
        .orderBy('p.prefijo')) as Array<Omit<PoolVista, 'entrega'>>
    return filas.map(conEntrega)
}

/** Pools de todos los bloques del router (resumen de direccionamiento). */
export async function listarPoolsDeRouter(
    routerId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<PoolVista[]> {
    const filas = (await consultaPools(cliente).where('b.router_id', routerId).orderBy('p.prefijo')) as Array<
        Omit<PoolVista, 'entrega'>
    >
    return filas.map(conEntrega)
}

export async function verPool(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await consultaPools(cliente).where('p.id', id).first()) as Omit<PoolVista, 'entrega'> | null
    if (!fila) throw new NoEncontrado(`El pool IPv6 ${id} no existe`)
    return conEntrega(fila)
}

/** Campos de un bloque o pool para `audit.cambios` (sin los calculados). */
export function bloqueParaAuditoria(bloque: BloqueVista) {
    return sinCampos(bloque, ['espacio'])
}

export function poolParaAuditoria(pool: PoolVista) {
    return sinCampos(pool, ['ocupacion', 'entrega', 'router_id'])
}

export function sinCampos<T extends object, K extends keyof T>(objeto: T, campos: K[]): Omit<T, K> {
    return Object.fromEntries(
        Object.entries(objeto).filter(([clave]) => !campos.includes(clave as K)),
    ) as Omit<T, K>
}
