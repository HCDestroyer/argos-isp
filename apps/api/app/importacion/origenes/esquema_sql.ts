import type { FilaCsv } from '#importacion/csv'
import type { TablaSql } from '#importacion/mysql_dump'
import { ENTIDADES, type Entidad, type FilasPorEntidad } from '#importacion/canonico'

/**
 * Ayudas para los adaptadores que leen un volcado MySQL (Mikrowisp, SmartISP): comprobar que el
 * volcado tiene el esquema que el adaptador supone, **antes** de tocar la base, y pasar sus filas
 * al formato canónico.
 */

export interface DefTabla {
    tabla: string
    /** columnas que el adaptador lee y deben existir */
    columnas: readonly string[]
    /** columnas que lee si están (no exige) */
    extra?: readonly string[]
    /** sin la tabla, la entidad entra vacía */
    opcional?: boolean
}

/** El volcado no tiene el esquema supuesto: lista todo lo que falta de una vez. */
export class EsquemaIncompleto extends Error {
    constructor(
        readonly origen: string,
        readonly faltantes: string[],
        mensaje: string,
    ) {
        super(mensaje)
    }
}

/**
 * Las tablas del esquema, ya comprobadas. Falta una tabla obligatoria o una columna →
 * `EsquemaIncompleto` con todo lo que falta (no solo lo primero) y dónde se ajusta el esquema.
 */
export function tablasDelEsquema<K extends string>(
    tablas: Map<string, TablaSql>,
    esquema: Record<K, DefTabla>,
    contexto: { nombre: string; origen: string; archivo: string },
): Record<K, TablaSql> {
    const faltantes: string[] = []
    const salida = {} as Record<K, TablaSql>
    for (const clave of Object.keys(esquema) as K[]) {
        const def = esquema[clave]
        const t = tablas.get(def.tabla)
        if (!t) {
            if (def.opcional) salida[clave] = { columnas: [...def.columnas], filas: [] }
            else faltantes.push(`falta la tabla ${def.tabla}`)
            continue
        }
        const faltan = def.columnas.filter((c) => !t.columnas.includes(c))
        if (faltan.length > 0) {
            faltantes.push(`a la tabla ${def.tabla} le faltan las columnas ${faltan.join(', ')}`)
        }
        salida[clave] = t
    }
    if (faltantes.length > 0) {
        throw new EsquemaIncompleto(
            contexto.origen,
            faltantes,
            `${contexto.nombre}: no tiene el esquema que espera el origen ${contexto.origen} ` +
                `(${faltantes.join('; ')}). Revisa que --origen sea el sistema correcto; si lo es, ` +
                `el esquema se ajusta en ${contexto.archivo}. No se tocó la base.`,
        )
    }
    return salida
}

/** Fila del origen ya con los nombres de columna canónicos (undefined = la columna no vino). */
export type FilaOrigen = Record<string, string | null | undefined>

/**
 * Filas por entidad en el formato canónico. `linea` = número de fila dentro de la tabla
 * (1 = la primera); el nombre del origen sale en el reporte como `<archivo>:<tabla>`.
 */
export function filasCanonicas(
    entidades: Record<Entidad, FilaOrigen[]>,
    tablaDe: Record<Entidad, string>,
    nombre: string,
): FilasPorEntidad {
    const filas = {} as FilasPorEntidad
    for (const entidad of ENTIDADES) {
        filas[entidad] = {
            origen: `${nombre}:${tablaDe[entidad]}`,
            filas: entidades[entidad].map((v, i): FilaCsv => ({ linea: i + 1, valores: aTexto(v) })),
        }
    }
    return filas
}

export function texto(v: string | null | undefined): string {
    return (v ?? '').trim()
}

function aTexto(fila: FilaOrigen): Record<string, string> {
    return Object.fromEntries(Object.entries(fila).map(([k, v]) => [k, v ?? '']))
}
