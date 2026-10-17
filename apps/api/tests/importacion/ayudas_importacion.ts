import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Volcados sintéticos de prueba sobre el esquema **real** de cada sistema: la estructura de
 * `scripts/importacion/esquemas/` (tal como la exportó el ISP, con sus triggers) seguida de los
 * datos inventados de `scripts/importacion/<origen>-sintetico.sql`. Es lo mismo que trae un
 * volcado completo de `mysqldump`: primero las tablas, después los INSERT.
 */

export type OrigenSql = 'mikrowisp' | 'smartisp'

const RAIZ = new URL('../../../../scripts/importacion/', import.meta.url)

const ARCHIVOS: Record<OrigenSql, { esquema: string; datos: string }> = {
    mikrowisp: { esquema: 'esquemas/mikrowisp6.sql', datos: 'mikrowisp-sintetico.sql' },
    smartisp: { esquema: 'esquemas/smartisp.sql', datos: 'smartisp-sintetico.sql' },
}

export function rutaEsquema(origen: OrigenSql): string {
    return fileURLToPath(new URL(ARCHIVOS[origen].esquema, RAIZ))
}

/** Estructura real + datos sintéticos, como texto. */
export async function volcadoSintetico(origen: OrigenSql): Promise<string> {
    const { esquema, datos } = ARCHIVOS[origen]
    const [ddl, filas] = await Promise.all([
        readFile(new URL(esquema, RAIZ), 'utf8'),
        readFile(new URL(datos, RAIZ), 'utf8'),
    ])
    return `${ddl}\n${filas}`
}

let directorio: Promise<string> | null = null

/**
 * El volcado completo escrito en un archivo temporal `<origen>-sintetico.sql` (para
 * `leerOrigen` y el comando), con el mismo nombre que el de los datos: así el reporte dice
 * `mikrowisp-sintetico.sql:tblservicios`.
 */
export async function archivoSintetico(origen: OrigenSql): Promise<string> {
    directorio ??= mkdtemp(join(tmpdir(), 'argos-volcado-'))
    const ruta = join(await directorio, ARCHIVOS[origen].datos)
    await writeFile(ruta, await volcadoSintetico(origen))
    return ruta
}
