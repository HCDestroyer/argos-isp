import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { MapeoExtracto } from '#importacion/extractos/formatos'

/** Mapeo guardado de una cuenta bancaria (`importacion.extractos_mapeos`). */
export interface MapeoGuardado {
    id: number
    cuenta_bancaria_id: number
    empresa_id: number | null
    /** banco reconocido (`banrural`…) o `personalizado` */
    formato: string
    mapeo: MapeoExtracto
    version: number
    actualizado_por: number | null
    updated_at: string
}

export async function verMapeoGuardado(
    cliente: QueryClientContract,
    cuentaBancariaId: number,
): Promise<MapeoGuardado | null> {
    const fila = (await cliente
        .from('importacion.extractos_mapeos')
        .where('cuenta_bancaria_id', cuentaBancariaId)
        .select(
            'id',
            'cuenta_bancaria_id',
            'empresa_id',
            'formato',
            'mapeo',
            'version',
            'actualizado_por',
            'updated_at',
        )
        .first()) as {
        id: number
        cuenta_bancaria_id: number
        empresa_id: number | null
        formato: string
        mapeo: MapeoExtracto
        version: number
        actualizado_por: number | null
        updated_at: Date
    } | null
    if (!fila) return null
    return {
        id: Number(fila.id),
        cuenta_bancaria_id: Number(fila.cuenta_bancaria_id),
        empresa_id: fila.empresa_id === null ? null : Number(fila.empresa_id),
        formato: fila.formato,
        mapeo: fila.mapeo,
        version: Number(fila.version),
        actualizado_por: fila.actualizado_por === null ? null : Number(fila.actualizado_por),
        updated_at: new Date(fila.updated_at).toISOString(),
    }
}
