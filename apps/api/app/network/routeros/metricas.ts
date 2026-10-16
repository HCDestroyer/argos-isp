import { prefijoColas, redis } from '#shared/redis'
import type { MetricaExtra } from '#monitoreo/metricas'

/**
 * Métricas de RouterOS para `/metrics` (pedido de A6, `infra/monitoring/reglas.yml`):
 *
 * | Métrica | Qué es |
 * | --- | --- |
 * | `argosisp_routeros_colas_simples{router_id,router}` | Colas simples del router en la última lectura del reconciliador (todas, también las dinámicas de PPPoE) |
 * | `argosisp_routeros_colas_leidas_timestamp_seconds{router_id,router}` | Epoch de esa lectura |
 * | `argosisp_routeros_colas_arbol{router_id,router}` | Nodos de `/queue/tree` del router en esa lectura (modo `arbol_pcq`); sin muestra si no se leyó |
 * | `argosisp_routeros_control_velocidad{router_id,router,modo}` | 1 con el modo de control del router (`simple` o `arbol_pcq`) |
 *
 * El reconciliador guarda la lectura en un hash de Redis; el scrape solo lee ese hash (nunca llama
 * al router). Es una lectura de monitoreo, no una caché de datos de negocio.
 */

export function claveColas(): string {
    return `${prefijoColas()}:routeros:colas`
}

export async function guardarLecturaColas(
    routerId: number,
    nombre: string,
    colas: number,
    extra: { arbol?: number | null; control?: string | null } = {},
): Promise<void> {
    await redis().hset(
        claveColas(),
        String(routerId),
        JSON.stringify({
            router: nombre,
            colas,
            arbol: extra.arbol ?? null,
            control: extra.control ?? null,
            leidas_en: Math.floor(Date.now() / 1000),
        }),
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
    const arbol: MetricaExtra = {
        nombre: 'argosisp_routeros_colas_arbol',
        ayuda: 'Nodos de /queue/tree del router en la última lectura (modo arbol_pcq)',
        muestras: [],
    }
    const control: MetricaExtra = {
        nombre: 'argosisp_routeros_control_velocidad',
        ayuda: 'Modo de control de velocidad del router (1 en el modo vigente)',
        muestras: [],
    }
    const entradas = Object.entries(lecturas).sort(([a], [b]) => Number(a) - Number(b))
    for (const [routerId, crudo] of entradas) {
        let dato: {
            router?: unknown
            colas?: unknown
            leidas_en?: unknown
            arbol?: unknown
            control?: unknown
        }
        try {
            dato = JSON.parse(crudo) as typeof dato
        } catch {
            continue
        }
        const etiquetas = { router_id: routerId, router: String(dato.router ?? routerId) }
        colas.muestras.push({ etiquetas, valor: Number(dato.colas) })
        leidas.muestras.push({ etiquetas, valor: Number(dato.leidas_en) })
        if (typeof dato.arbol === 'number') arbol.muestras.push({ etiquetas, valor: dato.arbol })
        if (dato.control === 'simple' || dato.control === 'arbol_pcq') {
            control.muestras.push({ etiquetas: { ...etiquetas, modo: dato.control }, valor: 1 })
        }
    }
    return [colas, leidas, arbol, control]
}
