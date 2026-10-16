import { timingSafeEqual } from 'node:crypto'

/**
 * Métricas Prometheus del coa-dispatcher (`GET /metrics`, texto 0.0.4, sin dependencias). Pedido de
 * A6 (`.claude/integration/a6.md`, monitoreo):
 *
 * | Métrica | Tipo | Etiquetas |
 * | --- | --- | --- |
 * | `argosisp_coa_envios_total` | counter | `tipo` (coa, disconnect), `resultado` (ack, nak, timeout, error, sin_secret) — un intento por fila |
 * | `argosisp_coa_rtt_segundos` | histogram | `tipo` (solo envíos con respuesta) |
 * | `argosisp_coa_eventos_pendientes` | gauge | — eventos del grupo `coa` entregados y sin confirmar (`XPENDING`) |
 * | `argosisp_coa_consumidor_activo` | gauge | — |
 */

export const BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2]

function etiquetas(e: Record<string, string>): string {
    const partes = Object.entries(e).map(
        ([k, v]) => `${k}="${v.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`,
    )
    return partes.length ? `{${partes.join(',')}}` : ''
}

interface Histograma {
    cuentas: number[]
    total: number
    suma: number
}

export interface EstadoMetricas {
    pendientes: number | null
    consumidorActivo: boolean
}

export class MetricasCoa {
    readonly #envios = new Map<string, number>()
    readonly #rtt = new Map<string, Histograma>()

    envio(tipo: string, resultado: string, rttMs?: number): void {
        const clave = `${tipo}\u0000${resultado}`
        this.#envios.set(clave, (this.#envios.get(clave) ?? 0) + 1)
        if (rttMs === undefined || (resultado !== 'ack' && resultado !== 'nak')) return
        const h = this.#rtt.get(tipo) ?? { cuentas: BUCKETS.map(() => 0), total: 0, suma: 0 }
        const s = rttMs / 1000
        h.total++
        h.suma += s
        BUCKETS.forEach((b, i) => {
            if (s <= b) h.cuentas[i]!++
        })
        this.#rtt.set(tipo, h)
    }

    exponer(estado: EstadoMetricas): string {
        const l: string[] = []
        l.push(
            '# HELP argosisp_coa_envios_total Envíos de CoA/Disconnect por tipo y resultado (uno por intento)',
        )
        l.push('# TYPE argosisp_coa_envios_total counter')
        for (const [clave, n] of this.#envios) {
            const [tipo, resultado] = clave.split('\u0000') as [string, string]
            l.push(`argosisp_coa_envios_total${etiquetas({ tipo, resultado })} ${n}`)
        }
        l.push('# HELP argosisp_coa_rtt_segundos Tiempo hasta la respuesta del NAS')
        l.push('# TYPE argosisp_coa_rtt_segundos histogram')
        for (const [tipo, h] of this.#rtt) {
            BUCKETS.forEach((b, i) => {
                l.push(
                    `argosisp_coa_rtt_segundos_bucket${etiquetas({ tipo, le: String(b) })} ${h.cuentas[i]}`,
                )
            })
            l.push(`argosisp_coa_rtt_segundos_bucket${etiquetas({ tipo, le: '+Inf' })} ${h.total}`)
            l.push(`argosisp_coa_rtt_segundos_sum${etiquetas({ tipo })} ${h.suma}`)
            l.push(`argosisp_coa_rtt_segundos_count${etiquetas({ tipo })} ${h.total}`)
        }
        if (estado.pendientes !== null) {
            l.push('# HELP argosisp_coa_eventos_pendientes Eventos del grupo coa entregados y sin confirmar')
            l.push('# TYPE argosisp_coa_eventos_pendientes gauge')
            l.push(`argosisp_coa_eventos_pendientes ${estado.pendientes}`)
        }
        l.push('# HELP argosisp_coa_consumidor_activo 1 si el consumidor del bus está corriendo')
        l.push('# TYPE argosisp_coa_consumidor_activo gauge')
        l.push(`argosisp_coa_consumidor_activo ${estado.consumidorActivo ? 1 : 0}`)
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
