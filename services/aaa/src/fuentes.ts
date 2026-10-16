import { readFile } from 'node:fs/promises'
import { Agent as AgenteHttp, request as solicitudHttp } from 'node:http'
import { Agent as AgenteHttps, request as solicitudHttps } from 'node:https'
import type { Redis } from 'ioredis'
import { cifrar } from './cifrado.ts'
import { parsearRegistro, type RegistroAaa } from './servicio.ts'

/**
 * De dónde sale el servicio de un `user_ppp`:
 *   1. Redis `aaa:user:<user_ppp>` (lo mantiene A1 por evento, sin TTL).
 *   2. Si no está o Redis no responde: la fuente de respaldo (API de A1, o fixtures mientras A1 no
 *      publique el endpoint) y se cachea con `SET NX` para no pisar una escritura más nueva de A1.
 */

/** Fuente de respaldo: devuelve el registro o null si el usuario no existe. */
export interface FuenteRespaldo {
    readonly nombre: 'api' | 'fixtures'
    obtener(userPpp: string): Promise<RegistroAaa | null>
}

export class ErrorFuente extends Error {}

/**
 * `GET <API_INTERNAL_URL>internal/aaa/servicio?user_ppp=` con `Authorization: Bearer`; la base termina en `/api/v1/`.
 *
 * Conexiones keep-alive y acotadas (`conexiones`, por defecto 16): en una reconexión masiva con
 * Redis vacío llegan cientos de consultas a la vez; abrir un socket por consulta (como hacía `fetch`)
 * saturaba la API con handshakes y la hacía pasar del timeout (prueba de carga, semana 2). Las que
 * esperan socket cuentan dentro del mismo `timeoutMs`.
 */
export class FuenteApi implements FuenteRespaldo {
    readonly nombre = 'api' as const
    private readonly base: string
    private readonly token: string
    private readonly timeoutMs: number
    private readonly agente: AgenteHttp | AgenteHttps

    constructor(opciones: { url: string; token: string; timeoutMs: number; conexiones?: number }) {
        // Ruta relativa: la base incluye el prefijo de la API (`…/api/v1/`). Con una ruta absoluta
        // `new URL` descartaba `/api/v1` y cada consulta daba 404 (= usuario inexistente → Reject).
        this.base = opciones.url.endsWith('/') ? opciones.url : `${opciones.url}/`
        this.token = opciones.token
        this.timeoutMs = opciones.timeoutMs
        const conexiones = {
            keepAlive: true,
            maxSockets: opciones.conexiones ?? 16,
            maxFreeSockets: opciones.conexiones ?? 16,
        }
        this.agente = this.base.startsWith('https:')
            ? new AgenteHttps(conexiones)
            : new AgenteHttp(conexiones)
    }

    async obtener(userPpp: string): Promise<RegistroAaa | null> {
        const url = new URL('internal/aaa/servicio', this.base)
        url.searchParams.set('user_ppp', userPpp)
        const { status, cuerpo } = await this.get(url)
        if (status === 404) return null
        if (status !== 200) throw new ErrorFuente(`API interna respondió ${status}`)
        let datos: unknown
        try {
            datos = JSON.parse(cuerpo)
        } catch {
            throw new ErrorFuente('API interna respondió JSON inválido')
        }
        return parsearRegistro(datos)
    }

    /**
     * Abre las conexiones keep-alive (y calienta la ruta de la API) al arrancar, con consultas de un
     * usuario que no existe: así la primera ráfaga de autorizaciones no paga los handshakes.
     */
    async calentar(): Promise<void> {
        const url = new URL('internal/aaa/servicio', this.base)
        url.searchParams.set('user_ppp', '__argosisp_calentamiento__')
        const conexiones = this.agente.maxSockets
        await Promise.allSettled(
            Array.from({ length: Number.isFinite(conexiones) ? conexiones : 4 }, () => this.get(url)),
        )
    }

    cerrar(): void {
        this.agente.destroy()
    }

    private get(url: URL): Promise<{ status: number; cuerpo: string }> {
        const solicitar = url.protocol === 'https:' ? solicitudHttps : solicitudHttp
        return new Promise((resolver, rechazar) => {
            const req = solicitar(
                url,
                {
                    agent: this.agente,
                    headers: { authorization: `Bearer ${this.token}`, accept: 'application/json' },
                },
                (res) => {
                    const partes: Buffer[] = []
                    res.on('data', (c: Buffer) => partes.push(c))
                    res.on('end', () => {
                        clearTimeout(reloj)
                        resolver({
                            status: res.statusCode ?? 0,
                            cuerpo: Buffer.concat(partes).toString('utf8'),
                        })
                    })
                    res.on('error', (e) => {
                        clearTimeout(reloj)
                        rechazar(new ErrorFuente(`API interna no responde: ${e.name}`))
                    })
                },
            )
            // Un solo plazo para todo (esperar socket + respuesta), como el AbortSignal.timeout anterior.
            const reloj = setTimeout(
                () => req.destroy(Object.assign(new Error('timeout'), { name: 'TimeoutError' })),
                this.timeoutMs,
            )
            req.on('error', (e) => {
                clearTimeout(reloj)
                rechazar(new ErrorFuente(`API interna no responde: ${e.name}`))
            })
            req.end()
        })
    }
}

/**
 * Fixtures en `services/aaa/fixtures/servicios.json` mientras A1 no publique
 * `GET /internal/aaa/servicio` (contrato en `.claude/integration/contratos/aaa.md`). Mismo JSON que el contrato,
 * salvo que la contraseña viene en claro en `pass_ppp_claro` y se cifra al cargar con la clave del
 * entorno: así el resto del flujo (Redis, descifrado) es idéntico al real y no hay claves en el repo.
 */
export class FuenteFixtures implements FuenteRespaldo {
    readonly nombre = 'fixtures' as const
    private readonly registros: Map<string, RegistroAaa>

    constructor(registros: RegistroAaa[]) {
        this.registros = new Map(registros.map((r) => [r.user_ppp, r]))
    }

    static async desdeArchivo(ruta: string, clave: Buffer): Promise<FuenteFixtures> {
        const datos = JSON.parse(await readFile(ruta, 'utf8')) as unknown
        if (!Array.isArray(datos)) throw new ErrorFuente(`${ruta} debe ser un arreglo`)
        return new FuenteFixtures(datos.map((d) => parsearRegistro(FuenteFixtures.cifrarClaro(d, clave))))
    }

    private static cifrarClaro(d: unknown, clave: Buffer): unknown {
        if (typeof d !== 'object' || d === null || !('pass_ppp_claro' in d)) return d
        const { pass_ppp_claro, ...resto } = d as Record<string, unknown>
        return { ...resto, pass_ppp: cifrar(String(pass_ppp_claro), clave) }
    }

    async obtener(userPpp: string): Promise<RegistroAaa | null> {
        return this.registros.get(userPpp) ?? null
    }
}

export type Origen = 'redis' | 'api' | 'fixtures'

export interface Resuelto {
    registro: RegistroAaa | null
    origen: Origen
    /** Error de Redis si lo hubo (se usó el respaldo). */
    errorRedis?: string
}

export interface Logger {
    warn(obj: object, msg: string): void
}

export class ResolutorServicios {
    private readonly redis: Redis
    private readonly prefijo: string
    private readonly respaldo: FuenteRespaldo
    private readonly log: Logger

    constructor(opciones: { redis: Redis; prefijo: string; respaldo: FuenteRespaldo; log: Logger }) {
        this.redis = opciones.redis
        this.prefijo = opciones.prefijo
        this.respaldo = opciones.respaldo
        this.log = opciones.log
    }

    clave(userPpp: string): string {
        return `${this.prefijo}${userPpp}`
    }

    async resolver(userPpp: string): Promise<Resuelto> {
        const clave = this.clave(userPpp)
        let errorRedis: string | undefined
        let crudo: string | null = null
        try {
            crudo = await this.redis.get(clave)
        } catch (e) {
            errorRedis = (e as Error).message
        }

        if (crudo !== null) {
            try {
                return { registro: parsearRegistro(JSON.parse(crudo)), origen: 'redis' }
            } catch (e) {
                // Un valor corrupto no debe dejar al cliente sin servicio: se consulta el respaldo.
                // No se sobrescribe: la clave es de A1 y la corrige su próximo evento.
                this.log.warn(
                    { clave, error: (e as Error).message },
                    'registro inválido en Redis; se usa el respaldo',
                )
                const registro = await this.respaldo.obtener(userPpp)
                return { registro, origen: this.respaldo.nombre }
            }
        }

        const registro = await this.respaldo.obtener(userPpp)
        if (registro !== null && errorRedis === undefined) {
            // Sin TTL (CLAUDE.md regla 5). NX: si A1 escribió mientras consultábamos, gana A1.
            // Los inexistentes no se cachean: A1 no tendría cómo invalidarlos al crear el servicio.
            try {
                await this.redis.set(clave, JSON.stringify(registro), 'NX')
            } catch (e) {
                this.log.warn({ clave, error: (e as Error).message }, 'no se pudo cachear en Redis')
            }
        }
        return { registro, origen: this.respaldo.nombre, ...(errorRedis ? { errorRedis } : {}) }
    }
}
