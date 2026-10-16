import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract, TransactionClientContract } from '@adonisjs/lucid/types/database'
import { Conflicto } from '#shared/errores'

/**
 * Ids externos (`core.ids_externos`): la opción `externo` de las acciones de alta que usa el
 * importador (`CrearCliente`, `CrearRouter`, `CrearPlan`, `CrearServicio`). Se guarda en la misma
 * transacción que el alta: si el alta falla, no queda el vínculo, y si el id externo ya está
 * vinculado, el alta entera responde 409 `externo_duplicado` (nada se crea dos veces).
 */

export type TipoEntidadExterna = 'cliente' | 'router' | 'plan' | 'servicio'

export interface IdExterno {
    /** sistema de origen en minúsculas: `mikrowisp` */
    sistema: string
    /** id en el sistema de origen (texto) */
    id: string
}

/** Entidad de ArgosIsp vinculada a ese id externo, o null. */
export async function entidadPorExterno(
    tipo: TipoEntidadExterna,
    externo: IdExterno,
    cliente: QueryClientContract = db.connection(),
): Promise<number | null> {
    const fila = (await cliente
        .from('core.ids_externos')
        .where({ sistema: externo.sistema, entidad_tipo: tipo, externo_id: externo.id })
        .select('entidad_id')
        .first()) as { entidad_id: number } | null
    return fila ? Number(fila.entidad_id) : null
}

/** Vincula la entidad recién creada con su id externo (409 si ya estaba vinculado). */
export async function vincularExterno(
    trx: TransactionClientContract,
    tipo: TipoEntidadExterna,
    entidadId: number,
    externo: IdExterno | undefined,
): Promise<void> {
    if (!externo) return
    // serializa altas concurrentes del mismo id externo
    await trx.rawQuery(
        `SELECT pg_advisory_xact_lock(hashtext('ids_externos:' || ? || ':' || ? || ':' || ?))`,
        [externo.sistema, tipo, externo.id],
    )
    const previa = await entidadPorExterno(tipo, externo, trx)
    if (previa !== null) {
        throw new Conflicto(
            `El ${tipo} ${externo.id} de ${externo.sistema} ya está importado (id ${previa})`,
            'externo_duplicado',
        )
    }
    await trx.insertQuery().table('core.ids_externos').insert({
        sistema: externo.sistema,
        entidad_tipo: tipo,
        externo_id: externo.id,
        entidad_id: entidadId,
    })
}
