import type { Problem, Schema, paths } from '@argosisp/contracts'

/** Cobro en línea visto por el cliente (`PortalPagoEnLinea`). */
export type PagoEnLinea = Schema<'PortalPagoEnLinea'>
export type SolicitudPagoEnLinea = paths['/api/v1/portal/pagos/iniciar']['post']['requestBody']['content']['application/json']

/**
 * "Pagar en línea" (semana 2). `iniciar` llama `POST /portal/pagos/iniciar` (A3 crea el cobro en la
 * pasarela) y `consultar` lee `GET /portal/pagos/en-linea/:id` en la página de retorno
 * (`/corte?pago=<id>`). El portal no aplica pagos: los registra el webhook de la pasarela.
 *
 * Sin `servicio_id` el cobro es del servicio de la IP de origen (`/corte`); con `servicio_id` o
 * `facturas`, del cliente de la sesión (`/cuenta`).
 */
export function usePagoEnLinea() {
    const api = useApi()

    /** `clave` va en `Idempotency-Key`: la misma en los reintentos del mismo intento de pago. */
    function iniciar(datos: SolicitudPagoEnLinea, clave: string): Promise<Resultado<PagoEnLinea>> {
        return resolver(api.POST('/api/v1/portal/pagos/iniciar', {
            params: { header: { 'Idempotency-Key': clave } },
            body: datos,
            headers: { 'X-Canal': 'portal' },
        }))
    }

    function consultar(id: number): Promise<Resultado<PagoEnLinea>> {
        return resolver(api.GET('/api/v1/portal/pagos/en-linea/{id}', {
            params: { path: { id } },
            headers: { 'X-Canal': 'portal' },
        }))
    }

    return { iniciar, consultar }
}

export interface OpcionesSeguimientoPago {
    /** Cada cuánto se consulta mientras el cobro está pendiente (5 s). */
    intervaloMs?: number
    /** Cuánto dura un seguimiento desde la última vez que se pidió (2 min). */
    duracionMs?: number
}

/**
 * Sigue un cobro en línea en la página de retorno: consulta de inmediato y cada 5 s mientras esté
 * `pendiente`, hasta 2 min. Se detiene al ver `pagado`, `fallido` o `expirado`, o si la API dice que
 * el cobro no existe (404: `problema`). Un error de red o un 429 no lo detiene.
 */
export function useSeguimientoPago(opciones: OpcionesSeguimientoPago = {}) {
    const { consultar } = usePagoEnLinea()
    const intervaloMs = opciones.intervaloMs ?? 5_000
    const duracionMs = opciones.duracionMs ?? 120_000

    const cobro = ref<PagoEnLinea | null>(null)
    const problema = ref<Problem | null>(null)
    const siguiendo = ref(false)
    const agotado = ref(false)
    const terminado = computed(() => cobro.value !== null && cobro.value.estado !== 'pendiente')

    let id: number | null = null
    let temporizador: ReturnType<typeof setTimeout> | undefined
    let limite = 0
    let generacion = 0

    async function ciclo(propia: number): Promise<void> {
        temporizador = undefined
        if (id === null) {
            return
        }
        const leido = await consultar(id)
        if (propia !== generacion || !siguiendo.value) {
            return
        }
        if (leido.ok) {
            cobro.value = leido.data
            problema.value = null
        }
        else if (leido.problema.status === 404) {
            problema.value = leido.problema
            detener()
            return
        }
        if (terminado.value) {
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

    function seguir(cobroId: number): void {
        if (import.meta.server) {
            return
        }
        if (cobroId !== id) {
            id = cobroId
            cobro.value = null
            problema.value = null
            detener()
        }
        if (terminado.value || problema.value) {
            return
        }
        limite = Date.now() + duracionMs
        agotado.value = false
        if (siguiendo.value) {
            return
        }
        siguiendo.value = true
        generacion += 1
        void ciclo(generacion)
    }

    function detener(): void {
        siguiendo.value = false
        if (temporizador) {
            clearTimeout(temporizador)
            temporizador = undefined
        }
    }

    onScopeDispose(detener)

    return { cobro, problema, siguiendo, agotado, terminado, seguir, detener }
}
