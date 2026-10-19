import { readFile } from 'node:fs/promises'
import app from '@adonisjs/core/services/app'

/**
 * Versión instalada de ArgosIsp (A6, distribución). No es una acción de dominio: solo lee.
 *
 * - `ARGOSISP_VERSION`, `ARGOSISP_COMMIT` y `ARGOSISP_COMPILADA` los pone la imagen (ARG del
 *   Dockerfile, workflow `.github/workflows/imagenes.yml`). Fuera de una imagen publicada la versión
 *   es `desarrollo`.
 * - Los cambios salen del `CHANGELOG.md` que la imagen trae junto a la API (generado por
 *   release-please): la sección de la versión instalada, en Markdown.
 * - Se leen de `process.env` y no de `start/env.ts`: son datos de la imagen, no configuración del
 *   operador.
 */

export const VERSION_DESARROLLO = 'desarrollo'

/** Repositorio de las notas de versión (GitHub Releases). */
const REPO_POR_DEFECTO = 'https://github.com/HCDestroyer/argos-isp'

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export interface VersionInstalada {
    version: string
    commit: string | null
    compilada: string | null
    notas_url: string | null
    cambios: string | null
}

function escaparRegex(texto: string): string {
    return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Sección `## [x.y.z](…) (fecha)` (o `## x.y.z`, `## vX.Y.Z`) del CHANGELOG, sin el encabezado.
 * Termina en el siguiente `## `. Null si la versión no está o la sección está vacía.
 */
export function seccionDeVersion(changelog: string, version: string): string | null {
    const lineas = changelog.split(/\r?\n/)
    const encabezado = new RegExp(`^##\\s+\\[?v?${escaparRegex(version)}\\]?(?=[\\s(]|$)`)
    const inicio = lineas.findIndex((l) => encabezado.test(l))
    if (inicio < 0) return null
    let fin = lineas.findIndex((l, i) => i > inicio && /^##\s/.test(l))
    if (fin < 0) fin = lineas.length
    const cuerpo = lineas
        .slice(inicio + 1, fin)
        .join('\n')
        .trim()
    return cuerpo || null
}

/** Rutas donde puede estar el CHANGELOG: imagen (`/app/CHANGELOG.md`) o raíz del monorepo. */
function candidatosChangelog(): string[] {
    const propio = process.env.ARGOSISP_CHANGELOG
    if (propio) return [propio]
    return [
        app.makePath('CHANGELOG.md'),
        app.makePath('..', 'CHANGELOG.md'),
        app.makePath('..', '..', 'CHANGELOG.md'),
    ]
}

/** El archivo es parte de la imagen (no cambia mientras el proceso vive): se lee una sola vez. */
let changelog: Promise<string | null> | undefined

async function leerChangelog(): Promise<string | null> {
    for (const ruta of candidatosChangelog()) {
        try {
            return await readFile(ruta, 'utf8')
        } catch {
            // siguiente candidato
        }
    }
    return null
}

/** Solo pruebas: vuelve a leer el CHANGELOG en la próxima consulta. */
export function olvidarChangelog() {
    changelog = undefined
}

export async function versionInstalada(): Promise<VersionInstalada> {
    const version = process.env.ARGOSISP_VERSION?.trim() || VERSION_DESARROLLO
    const esPublicada = SEMVER.test(version)
    const repo = (process.env.ARGOSISP_REPO_URL?.trim() || REPO_POR_DEFECTO).replace(/\/+$/, '')
    changelog ??= leerChangelog()
    const texto = esPublicada ? await changelog : null
    return {
        version,
        commit: process.env.ARGOSISP_COMMIT?.trim() || null,
        compilada: process.env.ARGOSISP_COMPILADA?.trim() || null,
        notas_url: esPublicada ? `${repo}/releases/tag/v${version}` : null,
        cambios: texto ? seccionDeVersion(texto, version) : null,
    }
}
