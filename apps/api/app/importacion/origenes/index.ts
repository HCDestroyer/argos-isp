import { stat } from 'node:fs/promises'
import type { FuenteCanonica } from '#importacion/canonico'
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
    leer(ruta: string): Promise<FuenteCanonica>
}

export const ADAPTADORES: Record<NombreOrigen, AdaptadorOrigen> = {
    mikrowisp: {
        nombre: 'mikrowisp',
        fuente: 'archivo',
        descripcion: 'Volcado SQL de la base MySQL de Mikrowisp 6 (docs/importacion/mapeo-mikrowisp.md)',
        leer: leerDumpMikrowisp,
    },
    smartisp: {
        nombre: 'smartisp',
        fuente: 'archivo',
        descripcion: 'Volcado SQL de la base MySQL de SmartISP (docs/importacion/mapeo-smartisp.md)',
        leer: leerDumpSmartisp,
    },
    csv: {
        nombre: 'csv',
        fuente: 'directorio',
        descripcion:
            'Directorio con un CSV por entidad en el formato canónico (plantillas: importar:plantillas)',
        leer: leerDirectorio,
    },
}

export function esOrigen(valor: string): valor is NombreOrigen {
    return (ORIGENES as readonly string[]).includes(valor)
}

/** Lee la fuente con el adaptador del origen, comprobando antes que sea archivo o directorio. */
export async function leerOrigen(origen: NombreOrigen, ruta: string): Promise<FuenteCanonica> {
    const adaptador = ADAPTADORES[origen]
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
    return adaptador.leer(ruta)
}
