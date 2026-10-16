/**
 * Utilidades para los scripts: ejecutar el CLI de Remotion local y empaquetar
 * el proyecto una sola vez para renderizar varios stills seguidos.
 */
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = join(RAIZ, 'node_modules', '.bin', 'remotion')

export function remotion(args) {
    execFileSync(BIN, args, { cwd: RAIZ, stdio: ['ignore', 'inherit', 'inherit'] })
}

/** Empaqueta src/index.ts en out/bundle y devuelve la ruta (sirve como serve-url). */
export function empaquetar() {
    const destino = join(RAIZ, 'out', 'bundle')
    remotion(['bundle', 'src/index.ts', '--out-dir', destino, '--log', 'error'])
    return destino
}
