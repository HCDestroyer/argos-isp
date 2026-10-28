import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PLANTILLA_MINIMA } from '#network/conexion/plantilla_minima'

/**
 * Plantilla del script de conexión. Orden:
 *
 * 1. `ROUTERS_PLANTILLA_CONEXION`: ruta a un `.rsc` (en la imagen, la que copie A6).
 * 2. `infra/mikrotik/conexion.rsc` del monorepo (A6), en desarrollo y pruebas.
 * 3. `PLANTILLA_MINIMA` (`plantilla_minima.ts`), mientras A6 no la suba.
 *
 * Se lee en cada generación (es poco frecuente): cambiar la plantilla no exige reiniciar la API.
 */

const DEL_MONOREPO = fileURLToPath(new URL('../../../../../infra/mikrotik/conexion.rsc', import.meta.url))

export interface PlantillaConexion {
    texto: string
    origen: 'entorno' | 'monorepo' | 'minima'
}

function leer(ruta: string): string | null {
    try {
        return readFileSync(ruta, 'utf8')
    } catch {
        return null
    }
}

export function plantillaConexion(entorno: NodeJS.ProcessEnv = process.env): PlantillaConexion {
    const configurada = entorno.ROUTERS_PLANTILLA_CONEXION?.trim()
    if (configurada) {
        const texto = leer(configurada)
        // Configurada y ausente es un error de instalación: nunca se cae en silencio a otra.
        if (texto === null) throw new Error(`No se pudo leer ROUTERS_PLANTILLA_CONEXION (${configurada})`)
        return { texto, origen: 'entorno' }
    }
    const delMonorepo = leer(DEL_MONOREPO)
    if (delMonorepo !== null) return { texto: delMonorepo, origen: 'monorepo' }
    return { texto: PLANTILLA_MINIMA, origen: 'minima' }
}
