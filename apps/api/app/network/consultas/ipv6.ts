import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'

/** Lecturas de bloques y pools IPv6. */

const COLUMNAS_BLOQUE = [
    'id',
    'router_id',
    db.raw('prefijo::text AS prefijo'),
    'version',
    'created_at',
    'updated_at',
]
const COLUMNAS_POOL = [
    'id',
    'bloque_id',
    db.raw('prefijo::text AS prefijo'),
    'tipo',
    'tamano_entrega',
    'nombre_en_router',
    'version',
    'created_at',
    'updated_at',
]

export interface BloqueVista {
    id: number
    router_id: number
    prefijo: string
}

export async function listarBloques(routerId: number) {
    const router = await db.from('network.routers').where('id', routerId).first()
    if (!router) throw new NoEncontrado(`El router ${routerId} no existe`)
    return db
        .from('network.ipv6_bloques')
        .where('router_id', routerId)
        .orderBy('prefijo')
        .select(COLUMNAS_BLOQUE)
}

export async function verBloque(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await cliente
        .from('network.ipv6_bloques')
        .where('id', id)
        .select(COLUMNAS_BLOQUE)
        .first()) as BloqueVista | null
    if (!fila) throw new NoEncontrado(`El bloque IPv6 ${id} no existe`)
    return fila
}

export async function listarPools(bloqueId: number) {
    await verBloque(bloqueId)
    return db.from('network.ipv6_pools').where('bloque_id', bloqueId).orderBy('prefijo').select(COLUMNAS_POOL)
}

export async function verPool(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = await cliente.from('network.ipv6_pools').where('id', id).select(COLUMNAS_POOL).first()
    if (!fila) throw new NoEncontrado(`El pool IPv6 ${id} no existe`)
    return fila as { id: number; bloque_id: number; prefijo: string }
}
