import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { url } from '@nuxt/test-utils/e2e'

/** Raíz de apps/portal para `setup({ rootDir })`. */
export const RAIZ_PORTAL = fileURLToPath(new URL('../..', import.meta.url))

/** Compilación de prueba fija (se sobrescribe en cada corrida en vez de dejar una carpeta al azar por corrida). */
export const BUILD_PRUEBAS = fileURLToPath(new URL('../../.nuxt/test/servidor', import.meta.url))

export interface Respuesta {
    status: number
    headers: IncomingHttpHeaders
    cuerpo: string
}

/**
 * Petición HTTP cruda al portal levantado por `setup()`: deja poner `Host` (fetch no lo permite),
 * no sigue redirecciones y no normaliza la ruta (`/../` llega tal cual, como con `curl --path-as-is`).
 */
export function pedir(
    ruta: string,
    opciones: { host?: string, metodo?: string, headers?: Record<string, string> } = {},
): Promise<Respuesta> {
    const base = new URL(url('/'))
    return new Promise((resolver, rechazar) => {
        const peticion = request(
            {
                host: base.hostname,
                port: base.port,
                path: ruta,
                method: opciones.metodo ?? 'GET',
                headers: { ...(opciones.host ? { host: opciones.host } : {}), ...opciones.headers },
            },
            (respuesta) => {
                const partes: Buffer[] = []
                respuesta.on('data', (parte: Buffer) => partes.push(parte))
                respuesta.on('end', () => resolver({
                    status: respuesta.statusCode ?? 0,
                    headers: respuesta.headers,
                    cuerpo: Buffer.concat(partes).toString('utf8'),
                }))
            },
        )
        peticion.on('error', rechazar)
        peticion.end()
    })
}

export interface ApiFalsa {
    url: string
    /** Rutas (con query) que llegaron a la "API". */
    rutas: string[]
    cerrar: () => Promise<void>
}

/** API falsa: responde `{}` a todo y anota qué rutas le llegaron a través del proxy del portal. */
export async function levantarApiFalsa(): Promise<ApiFalsa> {
    const rutas: string[] = []
    const servidor: Server = createServer((peticion, respuesta) => {
        rutas.push(peticion.url ?? '')
        respuesta.setHeader('content-type', 'application/json')
        respuesta.end('{}')
    })
    await new Promise<void>(resolver => servidor.listen(0, '127.0.0.1', resolver))
    const { port } = servidor.address() as AddressInfo
    return {
        url: `http://127.0.0.1:${port}`,
        rutas,
        cerrar: () => new Promise<void>(resolver => servidor.close(() => resolver())),
    }
}
