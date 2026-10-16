import { prefijoColas, redis } from '#shared/redis'
import type { MetricaExtra } from '#monitoreo/metricas'

/**
 * Métricas de RouterOS para `/metrics` (pedido de A6, `infra/monitoring/reglas.yml`):
 *
 * | Métrica | Qué es |
 * | --- | --- |
 * | `argosisp_routeros_colas_simples{router_id,router}` | Colas simples del router en la última lectura del reconciliador (todas, también las dinámicas de PPPoE) |
 * | `argosisp_routeros_colas_leidas_timestamp_seconds{router_id,router}` | Epoch de esa lectura |
 *
 * El reconciliador guarda la lectura en un hash de Redis; el scrape solo lee ese hash (nunca llama
 * al router). Es una lectura de monitoreo, no una caché de datos de negocio.
 */

export function claveColas(): string {
    return `${prefijoColas()}:routeros:colas`
}

export async function guardarLecturaColas(routerId: number, nombre: string, colas: number): Promise<void> {
    await redis().hset(
        claveColas(),
        String(routerId),
        JSON.stringify({ router: nombre, colas, leidas_en: Math.floor(Date.now() / 1000) }),
    )
}

export async function leerMetricasRouterOS(): Promise<MetricaExtra[]> {
    const lecturas = await redis().hgetall(claveColas())
    const colas: MetricaExtra = {
        nombre: 'argosisp_routeros_colas_simples',
        ayuda: 'Colas simples del router en la última lectura del reconciliador',
        muestras: [],
    }
    const leidas: MetricaExtra = {
        nombre: 'argosisp_routeros_colas_leidas_timestamp_seconds',
        ayuda: 'Momento (epoch) de la última lectura de colas del router',
        muestras: [],
    }
    const entradas = Object.entries(lecturas).sort(([a], [b]) => Number(a) - Number(b))
    for (const [routerId, crudo] of entradas) {
        let dato: { router?: unknown; colas?: unknown; leidas_en?: unknown }
        try {
            dato = JSON.parse(crudo) as typeof dato
        } catch {
            continue
        }
        const etiquetas = { router_id: routerId, router: String(dato.router ?? routerId) }
        colas.muestras.push({ etiquetas, valor: Number(dato.colas) })
        leidas.muestras.push({ etiquetas, valor: Number(dato.leidas_en) })
    }
    return [colas, leidas]
}
