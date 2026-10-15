import { execFile, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

export const exec = promisify(execFile)

export const RAIZ_AAA = fileURLToPath(new URL('..', import.meta.url))
export const CONF = `${RAIZ_AAA}freeradius`

/** Misma imagen que `infra/docker-compose.yml` (como `infra/ci/freeradius-check.sh`). */
export const IMAGEN_FREERADIUS = (() => {
    const compose = readFileSync(
        fileURLToPath(new URL('../../../infra/docker-compose.yml', import.meta.url)),
        'utf8',
    )
    return (
        compose.match(/freeradius\/freeradius-server:[0-9.]+/)?.[0] ?? 'freeradius/freeradius-server:3.2.10'
    )
})()

/**
 * Las pruebas con FreeRADIUS en Docker corren si hay Docker y la imagen está disponible (o se puede
 * descargar). `AAA_PRUEBAS_DOCKER=0` las desactiva. Devuelve el motivo para `skip` o null.
 */
export function motivoSinDocker(): string | null {
    if (process.env.AAA_PRUEBAS_DOCKER === '0') return 'AAA_PRUEBAS_DOCKER=0'
    if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) return 'Docker no disponible'
    if (spawnSync('docker', ['image', 'inspect', IMAGEN_FREERADIUS], { stdio: 'ignore' }).status === 0)
        return null
    const pull = spawnSync('docker', ['pull', IMAGEN_FREERADIUS], { stdio: 'ignore', timeout: 180_000 })
    return pull.status === 0 ? null : `no se pudo obtener ${IMAGEN_FREERADIUS}`
}
