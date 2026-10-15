import type { Schema } from '@argosisp/contracts'

/** Estado en vivo (`GET /api/v1/portal/estado`): solo estado y monto, sin datos personales. */
export type EstadoPortal = Schema<'EstadoPortal'>

export interface OpcionesEstadoServicio {
    /** Cada cuánto se consulta mientras se vigila (5 s). */
    intervaloMs?: number
    /** Cuánto dura una vigilancia desde la última vez que se pidió (2 min). */
    duracionMs?: number
}

/**
 * Estado en vivo de la página de corte. `vigilar()` consulta `GET /portal/estado` de inmediato y
 * luego cada 5 s hasta ver `activo` o hasta que pasen 2 min. Se llama después de cualquier acción
 * del cliente (pago, comprobante, promesa) y cuando la pestaña vuelve a estar visible.
 *
 * Llamar `vigilar()` mientras ya se vigila solo reinicia el plazo de 2 min. Un error de red o un
 * 429 no detiene la vigilancia: se reintenta en el siguiente ciclo.
 */
export function useEstadoServicio(opciones: OpcionesEstadoServicio = {}) {
    const api = useApi()
    const intervaloMs = opciones.intervaloMs ?? 5_000
    const duracionMs = opciones.duracionMs ?? 120_000

    /** Última respuesta válida. */
    const ultimo = ref<EstadoPortal | null>(null)
    const vigilando = ref(false)
    /** Pasaron los 2 min sin ver `activo`. */
    const agotado = ref(false)
    const activo = computed(() => ultimo.value?.estado === 'activo')

    let temporizador: ReturnType<typeof setTimeout> | undefined
    let limite = 0
    /** Cada vigilancia nueva invalida los ciclos de la anterior que sigan en vuelo. */
    let generacion = 0

    async function consultar(): Promise<void> {
        try {
            const { data } = await api.GET('/api/v1/portal/estado', { headers: { 'X-Canal': 'portal' } })
            if (data) {
                ultimo.value = data
            }
        }
        catch {
            // Sin red: se reintenta en el siguiente ciclo.
        }
    }

    async function ciclo(propia: number): Promise<void> {
        temporizador = undefined
        await consultar()
        if (propia !== generacion || !vigilando.value) {
            return
        }
        if (activo.value) {
            detener()
            return
        }
        if (Date.now() >= limite) {
            agotado.value = true
            detener()
            return
        }
        temporizador = setTimeout(() => ciclo(propia), intervaloMs)
    }

    function vigilar(): void {
        if (import.meta.server || activo.value) {
            return
        }
        limite = Date.now() + duracionMs
        agotado.value = false
        if (vigilando.value) {
            return
        }
        vigilando.value = true
        generacion += 1
        void ciclo(generacion)
    }

    function detener(): void {
        vigilando.value = false
        if (temporizador) {
            clearTimeout(temporizador)
            temporizador = undefined
        }
    }

    onScopeDispose(detener)

    return { ultimo, activo, vigilando, agotado, vigilar, detener }
}
