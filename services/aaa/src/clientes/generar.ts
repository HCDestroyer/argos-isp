import { chmod, mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { join } from 'node:path'
import type { Pool } from 'pg'
import { descifrar } from '../cifrado.ts'

/**
 * Genera un archivo de cliente de FreeRADIUS por router de `network.routers` en
 * `freeradius/clients.d/` (`pnpm aaa:clients`). `clients.conf` los incluye con `$INCLUDE clients.d/`.
 *
 * Los archivos llevan el secret en claro: están en `.gitignore` y se escriben con permisos 0640.
 * FreeRADIUS lee los clientes solo al arrancar: después de generar hay que reiniciarlo (a mano con
 * `argosisp radius-clientes`, o por evento con `consumidor.ts` y `freeradius/recargar.sh`). Un
 * archivo con el mismo contenido no se reescribe, así `cambio` dice si hace falta recargar.
 */

export interface RouterRadius {
    id: number
    nombre: string
    nas_ip: string
    /** Cifrado `v1` (ver `cifrado.ts`). */
    radius_secret: string | null
}

export const PATRON_ARCHIVO = /^router-\d+\.conf$/

export function nombreArchivo(router: Pick<RouterRadius, 'id'>): string {
    return `router-${router.id}.conf`
}

/** `network.routers` activos que autentican por RADIUS. */
export async function leerRouters(pool: Pool): Promise<RouterRadius[]> {
    const { rows } = await pool.query<{
        id: string
        nombre: string
        nas_ip: string
        radius_secret: string | null
    }>(
        `SELECT id, nombre, host(nas_ip) AS nas_ip, radius_secret
           FROM network.routers
          WHERE activo AND modo_seguridad = 'radius'
          ORDER BY id`,
    )
    return rows.map((r) => ({ ...r, id: Number(r.id) }))
}

function comillas(valor: string): string {
    return `"${valor.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Bloque `client` de FreeRADIUS. Lanza si la IP o el secret no son utilizables. */
export function renderCliente(router: RouterRadius, secret: string): string {
    if (isIP(router.nas_ip) === 0) throw new Error(`nas_ip inválida: ${router.nas_ip}`)
    if (secret.length < 8) throw new Error('radius_secret demasiado corto (mínimo 8 caracteres)')
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(secret)) throw new Error('radius_secret con caracteres de control')
    const nombre = router.nombre.replace(/[^\p{L}\p{N} ._()/-]/gu, '?')
    return [
        '# -*- text -*-',
        `# Generado por \`pnpm aaa:clients\` desde network.routers (id ${router.id}: ${nombre}). No editar.`,
        `client router-${router.id} {`,
        `\tipaddr = ${router.nas_ip}`,
        '\tproto = udp',
        `\tsecret = ${comillas(secret)}`,
        `\tshortname = router-${router.id}`,
        '\tnas_type = other',
        '\t# RouterOS 7.15+ envía Message-Authenticator (mitigación de Blast-RADIUS).',
        '\trequire_message_authenticator = yes',
        '\tlimit_proxy_state = yes',
        '}',
        '',
    ].join('\n')
}

export interface ResultadoGeneracion {
    /** Archivos nuevos o con contenido distinto */
    escritos: string[]
    /** Archivos que ya tenían el mismo contenido (no se tocan) */
    sinCambios: string[]
    borrados: string[]
    /** Sin cliente: excluidos o sin secret (su archivo anterior se borra). */
    omitidos: { id: number; nombre: string; motivo: string }[]
    /** Con error (IP o secret inválidos): se conserva su archivo anterior y el CLI sale con 1. */
    errores: { id: number; nombre: string; motivo: string }[]
}

/**
 * Escribe un archivo por router y borra los `router-*.conf` de routers que ya no aplican
 * (inactivos, en modo `api`, sin secret o excluidos).
 * `excluirNasIps`: IPs que ya tienen cliente fijo en `clients.conf` (p. ej. `RADIUS_LAB_NAS_IP`);
 * FreeRADIUS no arranca si dos clientes comparten IP.
 */
export async function escribirClientes(opciones: {
    routers: RouterRadius[]
    clave: Buffer
    dir: string
    excluirNasIps?: string[]
}): Promise<ResultadoGeneracion> {
    const { routers, clave, dir } = opciones
    const excluir = new Set((opciones.excluirNasIps ?? []).filter(Boolean))
    const resultado: ResultadoGeneracion = {
        escritos: [],
        sinCambios: [],
        borrados: [],
        omitidos: [],
        errores: [],
    }
    await mkdir(dir, { recursive: true })

    for (const router of routers) {
        if (excluir.has(router.nas_ip)) {
            resultado.omitidos.push({
                id: router.id,
                nombre: router.nombre,
                motivo: 'nas_ip con cliente fijo en clients.conf',
            })
            continue
        }
        if (!router.radius_secret) {
            resultado.omitidos.push({ id: router.id, nombre: router.nombre, motivo: 'sin radius_secret' })
            continue
        }
        let contenido: string
        try {
            contenido = renderCliente(router, descifrar(router.radius_secret, clave))
        } catch (e) {
            resultado.errores.push({ id: router.id, nombre: router.nombre, motivo: (e as Error).message })
            continue
        }
        const archivo = nombreArchivo(router)
        const anterior = await readFile(join(dir, archivo), 'utf8').catch(() => null)
        if (anterior === contenido) {
            resultado.sinCambios.push(archivo)
            continue
        }
        const temporal = join(dir, `.${archivo}.tmp`)
        await writeFile(temporal, contenido, { mode: 0o640 })
        await chmod(temporal, 0o640)
        await rename(temporal, join(dir, archivo))
        resultado.escritos.push(archivo)
    }

    // Un error transitorio (secret mal cifrado, IP inválida) no debe dejar sin RADIUS a un router que ya
    // funcionaba: se conserva su archivo anterior.
    const vigentes = new Set([
        ...resultado.escritos,
        ...resultado.sinCambios,
        ...resultado.errores.map(nombreArchivo),
    ])
    for (const archivo of await readdir(dir)) {
        if (PATRON_ARCHIVO.test(archivo) && !vigentes.has(archivo)) {
            await unlink(join(dir, archivo))
            resultado.borrados.push(archivo)
        }
    }
    return resultado
}

/** ¿La generación cambió algo que FreeRADIUS deba volver a leer? */
export function huboCambio(r: ResultadoGeneracion): boolean {
    return r.escritos.length > 0 || r.borrados.length > 0
}
