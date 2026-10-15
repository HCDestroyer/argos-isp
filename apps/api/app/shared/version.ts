import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { ConflictoVersion, NoEncontrado } from '#shared/errores'

/**
 * Control optimista de concurrencia por columna `version`.
 *
 * Actualiza la fila solo si su `version` es la que el cliente leyó y la incrementa. Si otra
 * sesión la cambió antes, lanza `ConflictoVersion` (409); si no existe, `NoEncontrado` (404).
 * Devuelve la fila actualizada (`RETURNING *`).
 */
export async function actualizarConVersion<T extends Record<string, unknown>>(
    trx: TransactionClientContract,
    tabla: string,
    id: number,
    versionEsperada: number,
    cambios: Record<string, unknown>,
): Promise<T> {
    const filas = (await trx
        .from(tabla)
        .where('id', id)
        .where('version', versionEsperada)
        .update(
            { ...cambios, version: trx.knexRawQuery('version + 1'), updated_at: trx.knexRawQuery('now()') },
            ['*'],
        )) as T[]

    const fila = filas[0]
    if (fila) return fila

    const existe = await trx.from(tabla).where('id', id).select('id').first()
    if (!existe) throw new NoEncontrado(`${tabla} ${id} no existe`)
    throw new ConflictoVersion(tabla, id)
}

/** Lanza 409 si la versión enviada no coincide con la actual. */
export function verificarVersion(entidad: string, id: number, actual: number, esperada: number) {
    if (actual !== esperada) throw new ConflictoVersion(entidad, id)
}
