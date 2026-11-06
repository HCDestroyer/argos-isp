import type { ModoSuspension } from './config.ts'
import type { Log } from './dispatcher.ts'
import type { OpcionesApi } from './registro.ts'

/**
 * Modo de suspensión vigente (`disconnect` | `coa`), configurable desde el panel (pedido del PM, 6 nov;
 * `contratos/control-velocidad.md` §10.7, `.claude/integration/a5.md`).
 *
 * - Fuente: `GET <API_INTERNAL_URL>internal/corte/configuracion` (`Schema<'PortalCorte'>`), con el mismo
 *   Bearer, timeout y reintentos que `registro.ts`. `modo_suspension: desconectar` → `disconnect`,
 *   `coa` → `coa`.
 * - Al arrancar (`iniciar`): si la API no responde, queda el respaldo `COA_SUSPENDER` del entorno y se
 *   sigue reintentando en segundo plano (backoff hasta `esperaMaximaMs`) hasta leerlo una vez.
 * - `portal.config_cambiada` con `modo_suspension` en `campos` (o sin `campos`): `releer`. Si falla,
 *   conserva el último valor y registra el error. Releer siempre trae el valor vigente, así que un
 *   evento repetido no cambia nada (consumidor idempotente).
 * - Aplica desde la siguiente suspensión: el dispatcher lee `valor` en cada decisión; nunca re-suspende
 *   sesiones ya cortadas.
 * - Si dos lecturas se cruzan (reintento de arranque y evento), gana la que empezó después.
 */

export type ResultadoModo = { ok: true; valor: ModoSuspension } | { ok: false; error: string }

export interface OpcionesModoSuspension {
    /** `COA_SUSPENDER` del entorno: valor hasta la primera lectura buena de la API */
    respaldo: ModoSuspension
    api: OpcionesApi | null
    log: Log
    /** Espera base del reintento de arranque en segundo plano (ms); se duplica hasta `esperaMaximaMs` */
    esperaArranqueMs?: number
    esperaMaximaMs?: number
}

const dormir = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms))

/** Traduce `PortalCorte.modo_suspension` al modo de `coa`; null si no cumple el contrato. */
export function modoDeConfiguracion(datos: unknown): ModoSuspension | null {
    if (typeof datos !== 'object' || datos === null) return null
    const modo = (datos as { modo_suspension?: unknown }).modo_suspension
    if (modo === 'desconectar') return 'disconnect'
    if (modo === 'coa') return 'coa'
    return null
}

/** true si un `portal.config_cambiada` obliga a releer el modo (sin `campos` = por las dudas). */
export function cambiaModo(payload: Record<string, unknown>): boolean {
    const campos = payload.campos
    if (!Array.isArray(campos)) return true
    return campos.includes('modo_suspension')
}

export class ModoSuspensionVigente {
    readonly #op: OpcionesModoSuspension
    readonly #api: OpcionesApi | null
    #valor: ModoSuspension
    #origen: 'entorno' | 'api'
    /** Número de la última lectura iniciada y de la última aplicada (descarta respuestas viejas). */
    #lecturas = 0
    #aplicada = 0
    #arranque: Promise<void> | null = null
    #detenido = false

    constructor(opciones: OpcionesModoSuspension) {
        this.#op = opciones
        this.#valor = opciones.respaldo
        this.#origen = 'entorno'
        this.#api = opciones.api
            ? {
                  ...opciones.api,
                  url: opciones.api.url.endsWith('/') ? opciones.api.url : `${opciones.api.url}/`,
              }
            : null
    }

    get valor(): ModoSuspension {
        return this.#valor
    }

    /** `entorno` mientras no se leyó la API (respaldo `COA_SUSPENDER`); `api` después. */
    get origen(): 'entorno' | 'api' {
        return this.#origen
    }

    /**
     * Primera lectura. Devuelve el resultado del primer intento (con sus reintentos); si falló, deja
     * un reintento en segundo plano que termina con la primera lectura buena (o con `detener`).
     */
    async iniciar(): Promise<ResultadoModo> {
        if (!this.#api) {
            this.#op.log.warn(
                { modo_suspension: this.#valor },
                'coa sin API_INTERNAL_URL: el modo de suspensión sale de COA_SUSPENDER',
            )
            return { ok: false, error: 'sin API_INTERNAL_URL' }
        }
        const r = await this.#leer('arranque')
        if (!r.ok && !this.#detenido) this.#arranque = this.#reintentarArranque()
        return r
    }

    /** Relee tras `portal.config_cambiada`. Si falla conserva el último valor. */
    async releer(): Promise<ResultadoModo> {
        if (!this.#api) return { ok: false, error: 'sin API_INTERNAL_URL' }
        return this.#leer('portal.config_cambiada')
    }

    async detener(): Promise<void> {
        this.#detenido = true
        await this.#arranque
    }

    async #reintentarArranque(): Promise<void> {
        let espera = this.#op.esperaArranqueMs ?? 5000
        const maximo = this.#op.esperaMaximaMs ?? 60_000
        while (!this.#detenido && this.#origen === 'entorno') {
            await dormir(espera)
            if (this.#detenido || this.#origen !== 'entorno') return
            await this.#leer('arranque (reintento)')
            espera = Math.min(espera * 2, maximo)
        }
    }

    async #leer(motivo: string): Promise<ResultadoModo> {
        const numero = ++this.#lecturas
        const r = await this.#pedir(this.#api!)
        const { log } = this.#op
        if (!r.ok) {
            log.error(
                { motivo, error: r.error, modo_suspension: this.#valor, origen: this.#origen },
                'coa: no se pudo leer el modo de suspensión; se conserva el vigente',
            )
            return r
        }
        if (numero < this.#aplicada) return { ok: true, valor: this.#valor }
        this.#aplicada = numero
        const anterior = this.#valor
        this.#valor = r.valor
        this.#origen = 'api'
        log.info(
            { motivo, modo_suspension: r.valor, anterior },
            anterior === r.valor ? 'coa: modo de suspensión leído' : 'coa: modo de suspensión cambiado',
        )
        return r
    }

    async #pedir(api: OpcionesApi): Promise<ResultadoModo> {
        const url = new URL('internal/corte/configuracion', api.url)
        const maximo = 1 + Math.max(0, api.reintentos)
        let ultimo = ''
        for (let intento = 1; intento <= maximo; intento++) {
            try {
                const res = await fetch(url, {
                    headers: { authorization: `Bearer ${api.token}`, accept: 'application/json' },
                    signal: AbortSignal.timeout(api.timeoutMs),
                })
                if (res.status === 200) {
                    const valor = modoDeConfiguracion(await res.json())
                    if (valor) return { ok: true, valor }
                    return { ok: false, error: 'la API no trae un modo_suspension válido' }
                }
                ultimo = `API interna respondió ${res.status}`
                // 4xx (token inválido, API sin la ruta): reintentar ahora no lo arregla.
                if (res.status < 500) return { ok: false, error: ultimo }
            } catch (e) {
                ultimo = `API interna no responde: ${(e as Error).name}`
            }
            if (intento < maximo) await dormir(api.esperaMs * 2 ** (intento - 1))
        }
        return { ok: false, error: `${ultimo} (${maximo} intentos)` }
    }
}
