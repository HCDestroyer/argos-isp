import { stat } from 'node:fs/promises'
import type { FuenteCanonica } from '#importacion/canonico'
import { esSoloPunto, FORMATO_PUNTO, type FormatoDecimal } from '#importacion/montos'
import { leerDirectorio } from '#importacion/origenes/csv'
import { leerDumpMikrowisp } from '#importacion/origenes/mikrowisp'
import { leerDumpSmartisp } from '#importacion/origenes/smartisp'

/**
 * Adaptadores de origen: cada uno solo traduce su fuente al formato canónico (`canonico.ts`).
 * El reporte, la idempotencia (`origen` + id externo) y el cuadre de saldos son del núcleo
 * (`importador.ts`) y funcionan igual para todos.
 */

export const ORIGENES = ['mikrowisp', 'smartisp', 'csv'] as const
export type NombreOrigen = (typeof ORIGENES)[number]

export interface AdaptadorOrigen {
    nombre: NombreOrigen
    /** qué espera en `--fuente` */
    fuente: 'archivo' | 'directorio'
    descripcion: string
    /** separadores decimales que admite (`coma` solo si el origen puede declararla) */
    decimales: 'punto' | 'punto_o_coma'
    leer(ruta: string, opciones: OpcionesLectura): Promise<FuenteCanonica>
}

export interface OpcionesLectura {
    /** separador decimal de los montos (por defecto punto) */
    decimal?: FormatoDecimal
}

export const ADAPTADORES: Record<NombreOrigen, AdaptadorOrigen> = {
    mikrowisp: {
        nombre: 'mikrowisp',
        fuente: 'archivo',
        descripcion: 'Volcado SQL de la base MySQL de Mikrowisp 6 (docs/importacion/mapeo-mikrowisp.md)',
        // columnas decimal(12,2) de MySQL: siempre punto decimal
        decimales: 'punto',
        leer: (ruta) => leerDumpMikrowisp(ruta),
    },
    smartisp: {
        nombre: 'smartisp',
        fuente: 'archivo',
        descripcion: 'Volcado SQL de la base MySQL de SmartISP (docs/importacion/mapeo-smartisp.md)',
        decimales: 'punto',
        leer: (ruta) => leerDumpSmartisp(ruta),
    },
    csv: {
        nombre: 'csv',
        fuente: 'directorio',
        descripcion:
            'Directorio con un CSV por entidad en el formato canónico (plantillas: importar:plantillas)',
        decimales: 'punto_o_coma',
        leer: (ruta, opciones) => leerDirectorio(ruta, { decimal: opciones.decimal }),
    },
}

export function esOrigen(valor: string): valor is NombreOrigen {
    return (ORIGENES as readonly string[]).includes(valor)
}

/** Lee la fuente con el adaptador del origen, comprobando antes que sea archivo o directorio. */
export async function leerOrigen(
    origen: NombreOrigen,
    ruta: string,
    opciones: OpcionesLectura = {},
): Promise<FuenteCanonica> {
    const adaptador = ADAPTADORES[origen]
    const decimal = opciones.decimal ?? FORMATO_PUNTO
    if (adaptador.decimales === 'punto' && !esSoloPunto(decimal)) {
        throw new Error(
            `--origen=${origen} lee un volcado MySQL, que guarda los montos con punto decimal: --decimal no aplica. ` +
                `Para CSV con coma decimal: --origen=csv --decimal=coma`,
        )
    }
    const info = await stat(ruta)
    if (adaptador.fuente === 'directorio' && !info.isDirectory()) {
        throw new Error(`--origen=${origen} lee un directorio con un CSV por entidad; ${ruta} es un archivo`)
    }
    if (adaptador.fuente === 'archivo' && info.isDirectory()) {
        throw new Error(
            `--origen=${origen} lee el volcado SQL (un archivo); ${ruta} es un directorio. ` +
                `Para CSV exportados de ${origen}: --origen=csv --sistema=${origen}`,
        )
    }
    return adaptador.leer(ruta, { decimal })
}
