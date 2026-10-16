import { CERO, aTexto, dec, type Dec } from '#ledger/dinero'
import {
    Dinero,
    definirEsquema,
    entero,
    fecha,
    jsonLibre,
    lista,
    nulable,
    objeto,
    texto,
    type EsquemaJson,
} from '#shared/openapi/esquemas'

/**
 * Forma común de los reportes: columnas tipadas (de ahí salen el schema del OpenAPI, el CSV y el
 * XLSX), filas y totales. El dinero viaja como string con 2 decimales, igual que en la API.
 */

export type TipoColumna = 'texto' | 'dinero' | 'entero' | 'fecha' | 'porcentaje' | 'id'

export interface Columna {
    clave: string
    titulo: string
    tipo: TipoColumna
    /** puede venir null (p. ej. "Sin zona") */
    nulable?: boolean
}

export type ValorCelda = string | number | null

export type Fila = Record<string, ValorCelda>

export interface Reporte<F extends Fila = Fila> {
    reporte: string
    titulo: string
    /** filtros efectivos (con los valores por defecto aplicados) */
    filtros: Record<string, unknown>
    columnas: Columna[]
    filas: F[]
    /** suma de las columnas de dinero y enteros (null en las demás) */
    totales: Record<string, ValorCelda>
    generado_en: string
}

const TIPO_ESQUEMA: Record<TipoColumna, EsquemaJson> = {
    texto,
    dinero: Dinero,
    entero,
    fecha,
    porcentaje: { type: 'number', description: 'Porcentaje 0–100 con 2 decimales' },
    id: { type: 'integer', minimum: 1 },
}

export function definirColumnas<const C extends readonly Columna[]>(columnas: C): C {
    return columnas
}

const ColumnaReporte = definirEsquema(
    'ColumnaReporte',
    objeto(
        {
            clave: texto,
            titulo: texto,
            tipo: { type: 'string', enum: ['texto', 'dinero', 'entero', 'fecha', 'porcentaje', 'id'] },
            nulable: {
                type: 'boolean',
                description:
                    'Solo viene (en true) si la celda puede ser null (p. ej. "Sin zona"); ausente = nunca null',
            },
        },
        ['nulable'],
    ),
)

/** Schema OpenAPI del reporte con sus filas tipadas. */
export function esquemaReporte(nombre: string, columnas: readonly Columna[]): EsquemaJson {
    const propiedades = Object.fromEntries(
        columnas.map((c) => {
            const base = TIPO_ESQUEMA[c.tipo]
            return [c.clave, c.nulable ? nulable(base) : base]
        }),
    )
    const totales = Object.fromEntries(
        columnas.map((c) => [c.clave, c.tipo === 'dinero' ? nulable(Dinero) : { type: ['number', 'null'] }]),
    )
    return definirEsquema(
        nombre,
        objeto({
            reporte: texto,
            titulo: texto,
            filtros: jsonLibre,
            columnas: lista(ColumnaReporte),
            filas: lista(objeto(propiedades)),
            totales: { ...objeto(totales), description: 'Suma de las columnas de dinero y enteros' },
            generado_en: { type: 'string', format: 'date-time' },
        }),
    )
}

/**
 * Arma el reporte: totales de las columnas `dinero` (decimal.js) y `entero`; `extra` reemplaza
 * totales que no son una suma (p. ej. un porcentaje global).
 */
export function armarReporte<F extends Fila>(datos: {
    reporte: string
    titulo: string
    columnas: readonly Columna[]
    filas: F[]
    filtros: Record<string, unknown>
    totales?: Record<string, ValorCelda>
}): Reporte<F> {
    const totales: Record<string, ValorCelda> = {}
    for (const c of datos.columnas) {
        if (c.tipo === 'dinero') {
            let suma: Dec = CERO
            for (const fila of datos.filas) suma = suma.plus(dec((fila[c.clave] as string | null) ?? '0'))
            totales[c.clave] = aTexto(suma)
        } else if (c.tipo === 'entero') {
            totales[c.clave] = datos.filas.reduce((n, fila) => n + Number(fila[c.clave] ?? 0), 0)
        } else {
            totales[c.clave] = null
        }
    }
    return {
        reporte: datos.reporte,
        titulo: datos.titulo,
        filtros: datos.filtros,
        columnas: [...datos.columnas],
        filas: datos.filas,
        totales: { ...totales, ...datos.totales },
        generado_en: new Date().toISOString(),
    }
}

/** Porcentaje con 2 decimales (0 si el divisor es 0). */
export function porcentaje(parte: string | number | Dec, total: string | number | Dec): number {
    const divisor = dec(String(total))
    if (divisor.isZero()) return 0
    return dec(String(parte)).times(100).div(divisor).toDecimalPlaces(2).toNumber()
}
