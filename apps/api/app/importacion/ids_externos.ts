import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

/**
 * Ids de Mikrowisp ↔ ids de ArgosIsp para la idempotencia del importador.
 *
 * A1 agrega `core.ids_externos (sistema, entidad_tipo, externo_id, entidad_id)` y la opción
 * `externo: { sistema, id }` en `CrearCliente`, `CrearRouter`, `CrearPlan` y `CrearServicio`: la
 * acción guarda el vínculo en su misma transacción (409 `externo_duplicado` si ya existe). Aquí:
 *
 * - `buscar`: lee `core.ids_externos` (lectura directa, como las demás consultas del importador).
 * - `externo`: lo que el importador pasa a la acción de alta como `externo`. Solo cuando la tabla
 *   existe (= el código de A1 está desplegado); sin ella las acciones no conocen la opción.
 * - `registrar`: para dobles de prueba; con la tabla no hace nada (ya lo hizo la acción).
 *
 * Sin la tabla, `buscar` devuelve null y el importador usa las claves naturales de siempre
 * (`nas_ip` o `nombre` del router, `nombre` del plan, `campos_personalizados.mikrowisp_id` del
 * cliente, `user_ppp` del servicio PPPoE; IP o MAC del servicio sin PPPoE). Nunca INSERT directo.
 */

export const SISTEMA_MIKROWISP = 'mikrowisp'

/** Los tipos que admite `core.ids_externos` (las zonas van por nombre). */
export type EntidadExterna = 'router' | 'plan' | 'cliente' | 'servicio'

export interface IdExterno {
    sistema: string
    id: string
}

export interface IdsExternos {
    /** `tabla`: con ids externos; `ninguno`: solo claves naturales */
    readonly modo: 'tabla' | 'ninguno'
    buscar(entidad: EntidadExterna, externoId: string): Promise<number | null>
    /** opción `externo` para la acción de alta, o undefined si no se usa */
    externo(entidad: EntidadExterna, externoId: string): IdExterno | undefined
    /** después de crear la entidad (solo dobles de prueba; la acción ya lo guardó) */
    registrar(entidad: EntidadExterna, externoId: string, entidadId: number): Promise<void>
}

/** Sin tabla de ids externos: el importador decide por claves naturales. */
export class SinIdsExternos implements IdsExternos {
    readonly modo = 'ninguno' as const
    async buscar(): Promise<number | null> {
        return null
    }
    externo(): IdExterno | undefined {
        return undefined
    }
    async registrar(): Promise<void> {}
}

/** `core.ids_externos` de A1: lee aquí y escribe por la opción `externo` de las acciones. */
export class IdsExternosTabla implements IdsExternos {
    readonly modo = 'tabla' as const
    constructor(private readonly trx: TransactionClientContract) {}

    async buscar(entidad: EntidadExterna, externoId: string): Promise<number | null> {
        const fila = (await this.trx
            .from('core.ids_externos')
            .where({ sistema: SISTEMA_MIKROWISP, entidad_tipo: entidad, externo_id: externoId })
            .select('entidad_id')
            .first()) as { entidad_id: number | string } | null
        return fila ? Number(fila.entidad_id) : null
    }

    externo(_entidad: EntidadExterna, externoId: string): IdExterno {
        return { sistema: SISTEMA_MIKROWISP, id: externoId }
    }

    async registrar(): Promise<void> {}
}

/** Usa `core.ids_externos` si existe con las columnas de A1; si no, claves naturales. */
export async function idsExternosDe(trx: TransactionClientContract): Promise<IdsExternos> {
    const resultado = (await trx.rawQuery(
        `SELECT count(*)::int AS n FROM information_schema.columns
          WHERE table_schema = 'core' AND table_name = 'ids_externos'
            AND column_name IN ('sistema', 'entidad_tipo', 'externo_id', 'entidad_id')`,
    )) as { rows: Array<{ n: number }> }
    return resultado.rows[0]?.n === 4 ? new IdsExternosTabla(trx) : new SinIdsExternos()
}
