import type { Dec } from '#ledger/dinero'
import { leerMonto } from '#importacion/montos'
import type { FilaCsv } from '#importacion/csv'
import type { FilaSql, TablaSql } from '#importacion/mysql_dump'
import {
    ENTIDADES,
    type ArchivoOrigen,
    type Entidad,
    type FilasPorEntidad,
    type ProblemaFila,
} from '#importacion/canonico'

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
            `${contexto.nombre}: no tiene el esquema que espera el origen ${contexto.origen}:\n` +
                faltantes.map((f) => `  - ${f}\n`).join('') +
                `Revisa que --origen sea el sistema correcto y que el volcado incluya esas tablas ` +
                `(docs/runbooks/importacion.md); si lo es, el esquema se ajusta en ${contexto.archivo}. ` +
                `No se tocó la base.`,
        )
    }
    return salida
}

/**
 * Fila del origen ya con los nombres de columna canónicos (undefined = la columna no vino).
 * `__linea`: número de la fila en su tabla del origen (1 = la primera); con él, los problemas de
 * formato apuntan a la fila real y el cuadre por tabla la encuentra.
 */
export type FilaOrigen = Record<string, string | null | undefined>

/**
 * Filas por entidad en el formato canónico. `linea` = número de fila dentro de la tabla del
 * origen (`__linea`; sin él, la posición en la lista); el nombre del origen sale en el reporte
 * como `<archivo>:<tabla>`.
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
            filas: entidades[entidad].map((v, i): FilaCsv => ({
                linea: Number(v.__linea ?? i + 1),
                valores: aTexto(v),
            })),
        }
    }
    return filas
}

export function texto(v: string | null | undefined): string {
    return (v ?? '').trim()
}

/**
 * Id del origen sin ceros a la izquierda. MySQL guarda los `int zerofill` como número; según la
 * herramienta del volcado salen `1` (mysqldump) o `'000001'` (Adminer, phpMyAdmin). Normalizado,
 * los dos son el mismo registro y la clave de idempotencia no depende de la herramienta.
 * Lo que no es un número entero se devuelve recortado, tal cual.
 */
export function normalizarId(v: string | null | undefined): string {
    const t = texto(v)
    return /^\d+$/.test(t) ? t.replace(/^0+(?=\d)/, '') : t
}

/**
 * Monto de una columna `decimal` del volcado (MySQL siempre con punto decimal). Ilegible o vacío:
 * `motivo` con la columna y el valor, para omitir la fila con `ProblemasOrigen.omitir` (o avisar,
 * si el monto solo se usa para comparar). Nunca se convierte en 0.
 */
export function montoOrigen(
    fila: FilaSql,
    columna: string,
): { ok: true; valor: Dec } | { ok: false; motivo: string } {
    const crudo = fila[columna]
    const lectura = leerMonto(crudo, 'punto')
    if (lectura.ok) return lectura
    return {
        ok: false,
        motivo: `${columna} ${crudo === null || crudo === undefined ? 'NULL' : `"${texto(crudo)}"`} ${lectura.motivo}`,
    }
}

/** Agrupa filas por una columna (ya normalizada con `clave`). */
export function agrupar(
    filas: FilaSql[],
    columna: string,
    clave: (v: string | null | undefined) => string = normalizarId,
): Map<string, FilaSql[]> {
    const grupos = new Map<string, FilaSql[]>()
    for (const f of filas) {
        const k = clave(f[columna])
        const lista = grupos.get(k)
        if (lista) lista.push(f)
        else grupos.set(k, [f])
    }
    return grupos
}

/**
 * Problemas propios del origen (no de formato): filas que el adaptador no traduce, avisos de
 * datos que no se importan. Salen en el reporte con los de formato (`formato` / `diferencias.csv`).
 * Nunca llevan contraseñas ni secretos.
 */
export class ProblemasOrigen {
    readonly lista: ProblemaFila[] = []

    constructor(private readonly nombre: string) {}

    /** La fila no entra (`omitido` en el reporte). */
    omitir(tabla: string, linea: number, id: string | null, mensaje: string) {
        this.lista.push({ archivo: `${this.nombre}:${tabla}`, linea, id, mensaje, aviso: false })
    }

    /** La fila entra con una observación (`aviso`). */
    avisar(tabla: string, linea: number, id: string | null, mensaje: string) {
        this.lista.push({ archivo: `${this.nombre}:${tabla}`, linea, id, mensaje, aviso: true })
    }
}

function aTexto(fila: FilaOrigen): Record<string, string> {
    return Object.fromEntries(
        Object.entries(fila)
            .filter(([k]) => k !== '__linea')
            .map(([k, v]) => [k, v ?? '']),
    )
}

/**
 * Lo que el adaptador sabe de cada fila del volcado para el archivo del origen
 * (`importacion.filas_origen`) y el cuadre por tabla: a qué entidad canónica va (`vincular`) o
 * por qué se queda solo en el archivo (`soloArchivo`, por fila o por tabla). Las filas que el
 * adaptador descarta van por `ProblemasOrigen.omitir` y cuentan como omitidas.
 */
export class TrazaOrigen {
    readonly vinculos = new Map<string, { entidad: Entidad; id: string }>()
    readonly notasFila = new Map<string, string>()
    readonly notasTabla: Record<string, string> = {}

    vincular(tabla: string, linea: number, entidad: Entidad, id: string) {
        this.vinculos.set(`${tabla}#${linea}`, { entidad, id })
    }

    soloArchivo(tabla: string, linea: number, motivo: string) {
        this.notasFila.set(`${tabla}#${linea}`, motivo)
    }

    tabla(tabla: string, motivo: string) {
        this.notasTabla[tabla] = motivo
    }

    /** Todas las tablas del volcado, con sus filas tal cual. */
    archivo(tablas: Map<string, TablaSql>): ArchivoOrigen {
        return {
            tablas: [...tablas.entries()]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([tabla, t]) => ({ tabla, columnas: t.columnas, filas: t.filas })),
            vinculos: this.vinculos,
            notasFila: this.notasFila,
            notasTabla: this.notasTabla,
        }
    }
}
