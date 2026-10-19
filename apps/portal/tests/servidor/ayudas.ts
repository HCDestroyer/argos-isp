import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { startServer, stopServer, url, useTestContext } from '@nuxt/test-utils/e2e'

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
    /** Cabeceras de cada petición que llegó (mismo orden que `rutas`). */
    cabeceras: IncomingHttpHeaders[]
    cerrar: () => Promise<void>
}

/** API falsa: responde `{}` a todo y anota qué rutas le llegaron a través del proxy del portal. */
export async function levantarApiFalsa(): Promise<ApiFalsa> {
    const rutas: string[] = []
    const cabeceras: IncomingHttpHeaders[] = []
    const servidor: Server = createServer((peticion, respuesta) => {
        rutas.push(peticion.url ?? '')
        cabeceras.push(peticion.headers)
        respuesta.setHeader('content-type', 'application/json')
        respuesta.end('{}')
    })
    await new Promise<void>(resolver => servidor.listen(0, '127.0.0.1', resolver))
    const { port } = servidor.address() as AddressInfo
    return {
        url: `http://127.0.0.1:${port}`,
        rutas,
        cabeceras,
        cerrar: () => new Promise<void>(resolver => servidor.close(() => resolver())),
    }
}

/** Intentos de arranque del servidor Nitro de prueba (cada uno con otro puerto al azar). */
const INTENTOS_ARRANQUE = 5

/** Cuánto se espera el `Listening on …` del propio servidor tras responder (los logs llegan por pipe). */
const ESPERA_ESCUCHA_MS = 10_000

function esPuertoOcupado(error: unknown): boolean {
    return error instanceof Error && error.message.includes('EADDRINUSE')
}

function haTerminado(proceso: { exitCode?: number | null, killed?: boolean } | undefined): boolean {
    return !proceso || proceso.killed === true || (proceso.exitCode ?? null) !== null
}

/**
 * El servidor que respondió es el nuestro: el proceso sigue vivo y dijo `Listening on …:<puerto>`
 * con el puerto de `url()`. Si otro proceso tomó el puerto y responde HTTP, `startServer` lo da por
 * listo; el nuestro muere con EADDRINUSE y nunca escribe esa línea.
 */
async function escuchaElNuestro(): Promise<boolean> {
    const ctx = useTestContext()
    const puerto = new URL(ctx.url ?? url('/')).port
    const linea = new RegExp(`Listening on https?://[^\\s]*:${puerto}(/|\\b)`)
    const limite = Date.now() + ESPERA_ESCUCHA_MS
    while (Date.now() < limite) {
        if (haTerminado(ctx.serverProcess)) {
            return false
        }
        if ((ctx.serverLogs ?? []).some(entrada => linea.test(entrada))) {
            return true
        }
        await new Promise(resolver => setTimeout(resolver, 50))
    }
    return false
}

/**
 * Levanta el servidor Nitro de producción de la prueba (`startServer` de `@nuxt/test-utils`) a prueba
 * de la carrera de puertos: `startServer` elige un puerto libre al azar y lo suelta antes de que Nitro
 * escuche, y con `apps/portal` y `apps/web` probando en paralelo otro proceso puede tomarlo en medio
 * (`listen EADDRINUSE`, CI de `main` en la fusión de la #64). Nitro no acepta `PORT=0` (`destr('0') ||
 * 3000`), así que se reintenta con otro puerto al azar, y solo se da por arrancado cuando el que
 * responde es el nuestro.
 */
export async function arrancarServidor(env: Record<string, string>): Promise<void> {
    let ultimo: unknown = null
    for (let intento = 1; intento <= INTENTOS_ARRANQUE; intento += 1) {
        try {
            await startServer({ env })
            if (await escuchaElNuestro()) {
                return
            }
            ultimo = new Error(`Otro proceso respondió en ${useTestContext().url}: el servidor de la prueba no quedó escuchando`)
        }
        catch (error) {
            if (!esPuertoOcupado(error)) {
                throw error
            }
            ultimo = error
        }
        await stopServer()
        // Un puerto fijo (`setup({ port })`) solo vale para el primer intento: los demás, al azar.
        useTestContext().options.port = undefined
    }
    throw new Error(`El servidor de la prueba no arrancó en ${INTENTOS_ARRANQUE} intentos (puerto ocupado)`, { cause: ultimo })
}

let configuracionActual: string | null = null

/**
 * El servidor con este entorno: lo (re)arranca solo si la configuración cambió desde el último
 * arranque. Va en un `beforeEach`: el contexto de `setup()` solo existe dentro de cada prueba.
 */
export async function servidorCon(env: Record<string, string>): Promise<void> {
    const clave = JSON.stringify(env)
    if (clave === configuracionActual && !haTerminado(useTestContext().serverProcess)) {
        return
    }
    configuracionActual = null
    await arrancarServidor(env)
    configuracionActual = clave
}
