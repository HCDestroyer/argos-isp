import vine from '@vinejs/vine'
// corrección de `.meta()` de VineJS 4.4.0 (ver el módulo)
import '#shared/vine_meta'
import { ValidacionFallida } from '#shared/errores'

/**
 * Paginación por cursor (keyset): `?cursor=&limit=` → `{ data, nextCursor }`.
 *
 * El cursor es opaco (base64url) y codifica el último valor de la columna de orden. Para usarlo
 * en un validador de query: `vine.object({ ...reglasPaginacion, q: vine.string().optional() })`.
 */

export const LIMITE_POR_DEFECTO = 50
export const LIMITE_MAXIMO = 200

export const reglasPaginacion = {
    cursor: vine
        .string()
        .trim()
        .maxLength(200)
        .optional()
        .meta({ description: 'Cursor opaco de la página anterior' }),
    limit: vine
        .number()
        .withoutDecimals()
        .range([1, LIMITE_MAXIMO])
        .optional()
        .meta({ description: `Tamaño de página (por defecto ${LIMITE_POR_DEFECTO})` }),
}

export interface Pagina<T> {
    data: T[]
    nextCursor: string | null
}

export interface OpcionesPaginacion {
    cursor?: string | null
    limit?: number | null
}

/** Mínimo común de los query builders de Lucid (base de datos y modelos). */
interface ConsultaPaginable<R> {
    where(columna: string, operador: string, valor: unknown): this
    orderBy(columna: string, direccion: 'asc' | 'desc'): this
    limit(limite: number): this
    then: PromiseLike<R[]>['then']
}

export function codificarCursor(valor: number | string): string {
    return Buffer.from(JSON.stringify([valor]), 'utf8').toString('base64url')
}

export function decodificarCursor(cursor: string): number | string {
    try {
        const valor = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown
        if (Array.isArray(valor) && (typeof valor[0] === 'number' || typeof valor[0] === 'string')) {
            return valor[0]
        }
    } catch {
        // cae al error de abajo
    }
    throw new ValidacionFallida([{ field: 'cursor', message: 'Cursor inválido', rule: 'cursor' }])
}

/**
 * Pagina una consulta ordenada por una columna única y monótona (por defecto `id` descendente).
 * `clave` extrae de cada fila el valor de esa columna (por defecto `fila.id`).
 */
export async function paginar<R>(
    consulta: ConsultaPaginable<R>,
    opciones: OpcionesPaginacion,
    config: { columna?: string; direccion?: 'asc' | 'desc'; clave?: (fila: R) => number | string } = {},
): Promise<Pagina<R>> {
    const columna = config.columna ?? 'id'
    const direccion = config.direccion ?? 'desc'
    const clave = config.clave ?? ((fila: R) => (fila as { id: number }).id)
    const limite = Math.min(Math.max(opciones.limit ?? LIMITE_POR_DEFECTO, 1), LIMITE_MAXIMO)

    if (opciones.cursor) {
        consulta.where(columna, direccion === 'desc' ? '<' : '>', decodificarCursor(opciones.cursor))
    }

    const filas = await consulta.orderBy(columna, direccion).limit(limite + 1)
    const hayMas = filas.length > limite
    const data = hayMas ? filas.slice(0, limite) : filas
    const ultima = data.at(-1)

    return { data, nextCursor: hayMas && ultima !== undefined ? codificarCursor(clave(ultima)) : null }
}
