import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Problema } from '#shared/errores'

/**
 * Render del script de conexión: port tal cual de la implementación de referencia de A6
 * (`infra/mikrotik/render.mjs`, `contratos/conexion-routers.md` §6.2). Mismas reglas; su prueba
 * (`render.test.mjs`) tiene espejo en `tests/network/conexion_render.spec.ts`.
 *
 * - Cada `{{nombre}}` de la plantilla se reemplaza por su valor.
 * - Todos los nombres de la plantilla deben venir y cumplir su patrón de `variables.json` (si no,
 *   error: nunca se sirve un script a medias).
 * - El valor va dentro de una cadena de RouterOS: se escapan `\ " $ ?` y se rechazan los caracteres
 *   de control (un salto de línea cerraría la cadena).
 *
 * Los archivos (`variables.json`, `plantillas/*.rsc.tpl`) son de A6 y se leen en cada generación de
 * `ROUTERS_MIKROTIK_DIR` (en la imagen de la API) o de `infra/mikrotik` del monorepo.
 */

const DEL_MONOREPO = fileURLToPath(new URL('../../../../../infra/mikrotik', import.meta.url))
const VARIABLE = /\{\{([a-z0-9_]+)\}\}/g

export const PLANTILLAS = {
    conexion: 'plantillas/conexion.rsc.tpl',
    servicio: 'plantillas/conexion-servicio.rsc.tpl',
    /** routers con `modo_seguridad = 'api'`: sin `/radius` ni CoA, `use-radius=no`, grupo con `sensitive` */
    conexion_sin_radius: 'plantillas/conexion-sin-radius.rsc.tpl',
    servicio_sin_radius: 'plantillas/conexion-servicio-sin-radius.rsc.tpl',
} as const

/** Plantilla del script según el modo del router y si suma el servicio (`?incluir=servicio`). */
export function plantillaConexion(modoSeguridad: string, incluirServicio: boolean): string {
    if (modoSeguridad === 'api') {
        return incluirServicio ? PLANTILLAS.servicio_sin_radius : PLANTILLAS.conexion_sin_radius
    }
    return incluirServicio ? PLANTILLAS.servicio : PLANTILLAS.conexion
}

export interface DefinicionVariable {
    patron: string
    descripcion: string
}

export class PlantillaInvalida extends Error {}

export function dirMikrotik(entorno: NodeJS.ProcessEnv = process.env): string {
    return entorno.ROUTERS_MIKROTIK_DIR?.trim() || DEL_MONOREPO
}

export function leerMikrotik(relativa: string, dir = dirMikrotik()): string {
    try {
        return readFileSync(join(dir, relativa), 'utf8')
    } catch {
        // Error de instalación (la imagen no trae los archivos de A6): 503, nunca un script a medias.
        throw new Problema(
            503,
            'plantillas_no_disponibles',
            'Plantillas de conexión no disponibles',
            `No se pudo leer ${relativa} en ${dir}: revisa ROUTERS_MIKROTIK_DIR`,
        )
    }
}

/** Grupos `conexion` y `servicio` de `variables.json`, en uno. */
export function variablesMikrotik(dir = dirMikrotik()): Record<string, DefinicionVariable> {
    const v = JSON.parse(leerMikrotik('variables.json', dir)) as Record<string, unknown>
    return {
        ...(v.conexion as Record<string, DefinicionVariable>),
        ...(v.servicio as Record<string, DefinicionVariable>),
    }
}

/** Nombres que usa una plantilla, en orden de aparición y sin repetir. */
export function variablesDe(plantilla: string): string[] {
    return [...new Set([...plantilla.matchAll(VARIABLE)].map((m) => m[1]!))]
}

/** Escapa un valor para una cadena entre comillas de RouterOS. */
export function escapar(valor: unknown): string {
    const texto = String(valor)
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(texto)) {
        throw new PlantillaInvalida('valor con caracteres de control')
    }
    return texto.replace(/[\\"$?]/g, (c) => `\\${c}`)
}

export function renderizar(
    plantilla: string,
    valores: Record<string, string | null | undefined>,
    variables: Record<string, DefinicionVariable> = variablesMikrotik(),
): string {
    const errores: string[] = []
    for (const nombre of variablesDe(plantilla)) {
        const def = variables[nombre]
        const valor = valores[nombre]
        if (!def) {
            errores.push(`${nombre}: no está en variables.json`)
        } else if (valor === undefined || valor === null) {
            errores.push(`${nombre}: falta`)
        } else if (!new RegExp(def.patron).test(String(valor))) {
            errores.push(`${nombre}: no cumple ${def.patron}`)
        }
    }
    if (errores.length) {
        throw new PlantillaInvalida(`plantilla de conexión: ${errores.join('; ')}`)
    }
    return plantilla.replace(VARIABLE, (_, nombre: string) => escapar(valores[nombre]))
}
