import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'

/**
 * Último dato conocido de Horus (`integraciones.horus_datos`). No es una caché con TTL (regla 5):
 * cada fila se reemplaza cuando Horus responde y, si no responde, se muestra tal cual marcada
 * `stale`, con su `actualizado_en` y el error de la última consulta fallida.
 */

export type TipoDato = 'servicio_360' | 'consumo' | 'seguridad'

export interface DatoGuardado<T = unknown> {
    datos: T
    actualizado_en: Date
    ultimo_error: string | null
    ultimo_error_en: Date | null
}

export async function guardarDato(
    tipo: TipoDato,
    clave: string,
    servicioId: number | null,
    datos: unknown,
    cliente: QueryClientContract = db.connection(),
): Promise<Date> {
    const filas = (await cliente.rawQuery(
        `INSERT INTO integraciones.horus_datos (tipo, clave, servicio_id, datos, actualizado_en)
         VALUES (?, ?, ?, ?::jsonb, now())
         ON CONFLICT (tipo, clave) DO UPDATE
            SET datos = EXCLUDED.datos, actualizado_en = now(), servicio_id = EXCLUDED.servicio_id,
                ultimo_error = NULL, ultimo_error_en = NULL
         RETURNING actualizado_en`,
        [tipo, clave, servicioId, JSON.stringify(datos)] as any[],
    )) as { rows: Array<{ actualizado_en: Date }> }
    return filas.rows[0]!.actualizado_en
}

/** Anota el error de la última consulta en el dato guardado (si lo hay). */
export async function anotarError(tipo: TipoDato, clave: string, error: string): Promise<void> {
    await db
        .from('integraciones.horus_datos')
        .where('tipo', tipo)
        .where('clave', clave)
        .update({ ultimo_error: error.slice(0, 500), ultimo_error_en: db.knexRawQuery('now()') })
}

export async function leerDato<T = unknown>(tipo: TipoDato, clave: string): Promise<DatoGuardado<T> | null> {
    return ((await db
        .from('integraciones.horus_datos')
        .where('tipo', tipo)
        .where('clave', clave)
        .select('datos', 'actualizado_en', 'ultimo_error', 'ultimo_error_en')
        .first()) ?? null) as DatoGuardado<T> | null
}

export async function leerDatos<T = unknown>(
    tipo: TipoDato,
    claves: string[],
): Promise<Map<string, DatoGuardado<T>>> {
    if (claves.length === 0) return new Map()
    const filas = (await db
        .from('integraciones.horus_datos')
        .where('tipo', tipo)
        .whereIn('clave', claves)
        .select('clave', 'datos', 'actualizado_en', 'ultimo_error', 'ultimo_error_en')) as Array<
        DatoGuardado<T> & { clave: string }
    >
    return new Map(filas.map((f) => [f.clave, f]))
}
