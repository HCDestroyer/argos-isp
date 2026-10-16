import { timingSafeEqual } from 'node:crypto'

/**
 * Métricas Prometheus de `aaa` (`GET /metrics`, formato de exposición de texto 0.0.4, sin
 * dependencias). Pedido de A6 (`.claude/integration/a6.md`, monitoreo):
 *
 * | Métrica | Tipo | Etiquetas |
 * | --- | --- | --- |
 * | `argosisp_aaa_autorizaciones_total` | counter | `resultado` = accept, reject, notfound, error |
 * | `argosisp_aaa_autorizacion_duracion_segundos` | histogram | `resultado` |
 * | `argosisp_aaa_accounting_total` | counter | `tipo` (Start, Interim-Update, Stop…), `resultado` = encolado, descartado, error |
 * | `argosisp_aaa_redis_arriba` | gauge | — |
 * | `argosisp_aaa_degradado` | gauge | — (1 desde la primera autorización sin Redis ni API hasta la siguiente normal) |
 * | `argosisp_aaa_degradado_total` | counter | `resultado` = perfil (último conocido), sin_perfil, desactivado |
 * | `argosisp_aaa_ultimo_conocido_registros` | gauge | — |
 * | `argosisp_aaa_ultimo_conocido_espejo_timestamp_seconds` | gauge | — (0 si aún no hubo espejo) |
 *
 * Las autorizaciones por segundo salen de `rate(argosisp_aaa_autorizaciones_total[1m])`.
 */

export type ResultadoAutorizacion = 'accept' | 'reject' | 'notfound' | 'error'
export type ResultadoAccounting = 'encolado' | 'descartado' | 'error'
/** perfil: se respondió con el último perfil conocido; sin_perfil / desactivado: 503 (Reject). */
export type ResultadoDegradado = 'perfil' | 'sin_perfil' | 'desactivado'

export interface EstadoExpuesto {
    redisArriba: boolean
    ultimoConocido?: { registros: number; espejoEn: number | null }
}

/** Fin de un periodo degradado (para la línea de log). */
export interface PeriodoDegradado {
    desde: number
    atendidas: number
}

/** Buckets en segundos: el criterio es p95 < 100 ms; rlm_rest corta a los 0,8 s. */
export const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1]

function etiquetas(e: Record<string, string>): string {
    const partes = Object.entries(e).map(
        ([k, v]) => `${k}="${v.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"')}"`,
    )
    return partes.length ? `{${partes.join(',')}}` : ''
}

class Histograma {
    readonly cuentas = BUCKETS.map(() => 0)
    total = 0
    suma = 0

    observar(segundos: number) {
        this.total++
        this.suma += segundos
        BUCKETS.forEach((b, i) => {
            if (segundos <= b) this.cuentas[i]!++
        })
    }
}

export class MetricasAaa {
    readonly #autorizaciones = new Map<ResultadoAutorizacion, number>()
    readonly #duraciones = new Map<ResultadoAutorizacion, Histograma>()
    readonly #accounting = new Map<string, number>()
    readonly #degradados = new Map<ResultadoDegradado, number>()
    #degradadoDesde: number | null = null
    #atendidasDegradado = 0

    /** Autorización resuelta sin Redis ni API. Devuelve true si con ella empieza el modo degradado. */
    degradado(resultado: ResultadoDegradado, ahora = Date.now()): boolean {
        this.#degradados.set(resultado, (this.#degradados.get(resultado) ?? 0) + 1)
        this.#atendidasDegradado++
        if (this.#degradadoDesde !== null) return false
        this.#degradadoDesde = ahora
        return true
    }

    /** Autorización resuelta por Redis o la API. Si cierra un periodo degradado, lo devuelve. */
    normal(): PeriodoDegradado | null {
        if (this.#degradadoDesde === null) return null
        const periodo = { desde: this.#degradadoDesde, atendidas: this.#atendidasDegradado }
        this.#degradadoDesde = null
        this.#atendidasDegradado = 0
        return periodo
    }

    get enDegradado(): boolean {
        return this.#degradadoDesde !== null
    }

    autorizacion(resultado: ResultadoAutorizacion, segundos: number): void {
        this.#autorizaciones.set(resultado, (this.#autorizaciones.get(resultado) ?? 0) + 1)
        const h = this.#duraciones.get(resultado) ?? new Histograma()
        h.observar(segundos)
        this.#duraciones.set(resultado, h)
    }

    accounting(tipo: string, resultado: ResultadoAccounting): void {
        const clave = `${tipo}\u0000${resultado}`
        this.#accounting.set(clave, (this.#accounting.get(clave) ?? 0) + 1)
    }

    exponer(estado: EstadoExpuesto): string {
        const l: string[] = []
        l.push('# HELP argosisp_aaa_autorizaciones_total Autorizaciones atendidas por resultado')
        l.push('# TYPE argosisp_aaa_autorizaciones_total counter')
        for (const r of ['accept', 'reject', 'notfound', 'error'] as const) {
            l.push(
                `argosisp_aaa_autorizaciones_total${etiquetas({ resultado: r })} ${this.#autorizaciones.get(r) ?? 0}`,
            )
        }
        l.push('# HELP argosisp_aaa_autorizacion_duracion_segundos Latencia de /aaa/authorize dentro de aaa')
        l.push('# TYPE argosisp_aaa_autorizacion_duracion_segundos histogram')
        for (const [r, h] of this.#duraciones) {
            BUCKETS.forEach((b, i) => {
                l.push(
                    `argosisp_aaa_autorizacion_duracion_segundos_bucket${etiquetas({ resultado: r, le: String(b) })} ${h.cuentas[i]}`,
                )
            })
            l.push(
                `argosisp_aaa_autorizacion_duracion_segundos_bucket${etiquetas({ resultado: r, le: '+Inf' })} ${h.total}`,
            )
            l.push(`argosisp_aaa_autorizacion_duracion_segundos_sum${etiquetas({ resultado: r })} ${h.suma}`)
            l.push(
                `argosisp_aaa_autorizacion_duracion_segundos_count${etiquetas({ resultado: r })} ${h.total}`,
            )
        }
        l.push('# HELP argosisp_aaa_accounting_total Paquetes de accounting por tipo y resultado')
        l.push('# TYPE argosisp_aaa_accounting_total counter')
        for (const [clave, n] of this.#accounting) {
            const [tipo, resultado] = clave.split('\u0000') as [string, string]
            l.push(`argosisp_aaa_accounting_total${etiquetas({ tipo, resultado })} ${n}`)
        }
        l.push('# HELP argosisp_aaa_redis_arriba 1 si la conexión a Redis está lista')
        l.push('# TYPE argosisp_aaa_redis_arriba gauge')
        l.push(`argosisp_aaa_redis_arriba ${estado.redisArriba ? 1 : 0}`)
        l.push('# HELP argosisp_aaa_degradado 1 si aaa está autorizando sin Redis ni API (último perfil conocido)')
        l.push('# TYPE argosisp_aaa_degradado gauge')
        l.push(`argosisp_aaa_degradado ${this.enDegradado ? 1 : 0}`)
        l.push('# HELP argosisp_aaa_degradado_total Autorizaciones sin Redis ni API, por resultado')
        l.push('# TYPE argosisp_aaa_degradado_total counter')
        for (const r of ['perfil', 'sin_perfil', 'desactivado'] as const) {
            l.push(`argosisp_aaa_degradado_total${etiquetas({ resultado: r })} ${this.#degradados.get(r) ?? 0}`)
        }
        if (estado.ultimoConocido) {
            l.push('# HELP argosisp_aaa_ultimo_conocido_registros Perfiles guardados para el modo degradado')
            l.push('# TYPE argosisp_aaa_ultimo_conocido_registros gauge')
            l.push(`argosisp_aaa_ultimo_conocido_registros ${estado.ultimoConocido.registros}`)
            l.push(
                '# HELP argosisp_aaa_ultimo_conocido_espejo_timestamp_seconds Último espejo completo de aaa:user:* (0 si ninguno)',
            )
            l.push('# TYPE argosisp_aaa_ultimo_conocido_espejo_timestamp_seconds gauge')
            const espejo = estado.ultimoConocido.espejoEn
            l.push(
                `argosisp_aaa_ultimo_conocido_espejo_timestamp_seconds ${espejo === null ? 0 : Math.floor(espejo / 1000)}`,
            )
        }
        return `${l.join('\n')}\n`
    }
}

/** `METRICS_TOKEN` vacío: abierto (red interna). Con token: `Authorization: Bearer <token>`. */
export function scrapeAutorizado(token: string | undefined, cabecera: string | undefined): boolean {
    if (!token) return true
    const esperado = Buffer.from(`Bearer ${token}`)
    const recibido = Buffer.from(cabecera ?? '')
    return esperado.length === recibido.length && timingSafeEqual(esperado, recibido)
}
