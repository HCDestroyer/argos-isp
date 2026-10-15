import type { Problem } from '@argosisp/contracts'

export interface OpcionesSeguimiento {
    /** Cada cuánto se vuelve a leer el estado (3 s). */
    intervaloMs?: number
    /** Hasta cuándo se sigue esperando (30 s). */
    limiteMs?: number
}

/**
 * Después de un pago, la API reactiva el servicio por evento (`pago.registrado` →
 * `evaluarEstadoServicio`), no en la misma respuesta. Este seguimiento relee los servicios del
 * cliente cada 3 s hasta 30 s y dice cuáles pasaron a `activo`.
 *
 * ```ts
 * const seguimiento = useSeguimientoReactivacion()
 * seguimiento.iniciar(cliente.id, serviciosAntesDelPago)
 * seguimiento.reactivados.value // servicios que estaban limitados o suspendidos y ya están activos
 * ```
 */
export function useSeguimientoReactivacion(opciones: OpcionesSeguimiento = {}) {
    const intervaloMs = opciones.intervaloMs ?? 3000
    const limiteMs = opciones.limiteMs ?? 30_000

    const servicios = shallowRef<Servicio[]>([])
    /** Estado de cada servicio al registrar el pago. */
    const antes = shallowRef(new Map<number, EstadoServicio>())
    const siguiendo = ref(false)
    /** Pasaron los 30 s y algún servicio sigue sin reactivarse. */
    const agotado = ref(false)
    const problema = ref<Problem | null>(null)

    let temporizador: ReturnType<typeof setTimeout> | undefined
    let inicio = 0
    let clienteId = 0
    let ronda = 0

    /** Servicios que esperaban reactivación (limitados o suspendidos al pagar). */
    const esperados = computed(() => servicios.value.filter((s) => {
        const previo = antes.value.get(s.id)
        return previo === 'limitado' || previo === 'suspendido'
    }))

    const reactivados = computed(() => esperados.value.filter(s => s.estado === 'activo'))
    const pendientes = computed(() => esperados.value.filter(s => s.estado === 'limitado' || s.estado === 'suspendido'))

    function detener() {
        clearTimeout(temporizador)
        temporizador = undefined
        siguiendo.value = false
    }

    async function leer(actual: number) {
        const resultado = await useServicios().listar({ cliente_id: clienteId, limit: 200 })
        if (actual !== ronda) {
            return
        }
        if (resultado.ok) {
            servicios.value = resultado.data.data
            problema.value = null
        }
        else {
            problema.value = resultado.problema
        }
        if (resultado.ok && pendientes.value.length === 0) {
            detener()
            return
        }
        if (Date.now() - inicio + intervaloMs > limiteMs) {
            detener()
            agotado.value = pendientes.value.length > 0 || !resultado.ok
            return
        }
        temporizador = setTimeout(() => leer(actual), intervaloMs)
    }

    /** Empieza a seguir los servicios del cliente; `previos` es cómo estaban antes del pago. */
    function iniciar(cliente: number, previos: Servicio[]) {
        detener()
        ronda++
        clienteId = cliente
        inicio = Date.now()
        servicios.value = previos
        antes.value = new Map(previos.map(s => [s.id, s.estado]))
        agotado.value = false
        problema.value = null
        if (pendientes.value.length === 0) {
            return
        }
        siguiendo.value = true
        const actual = ronda
        temporizador = setTimeout(() => leer(actual), intervaloMs)
    }

    function reiniciar() {
        detener()
        ronda++
        servicios.value = []
        antes.value = new Map()
        agotado.value = false
        problema.value = null
    }

    onScopeDispose(detener)

    return { servicios, siguiendo, agotado, problema, reactivados, pendientes, iniciar, detener, reiniciar }
}
