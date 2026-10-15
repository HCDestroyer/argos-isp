import type { Problem, Schema } from '@argosisp/contracts'

export type ServicioEvaluado = Schema<'ServicioEvaluado'>

export interface OpcionesSeguimiento {
    /** Cada cuánto se vuelve a leer el estado (3 s). */
    intervaloMs?: number
    /** Hasta cuándo se sigue esperando (30 s). */
    limiteMs?: number
}

/**
 * Qué pasó con los servicios del cliente después de un pago.
 *
 * `POST /pagos` evalúa cada servicio afectado en la misma transacción y lo devuelve en
 * `Pago.servicios[]`: con eso se muestra "Servicio reactivado" de inmediato y no se sondea nada.
 * Solo si la respuesta no trae `servicios` (versión vieja de la API) se relee
 * `GET /servicios?cliente_id=` cada 3 s hasta 30 s, como respaldo.
 *
 * Un servicio suspendido a mano (`suspension_manual`) no se espera: el pago no lo reactiva.
 *
 * ```ts
 * const seguimiento = useSeguimientoReactivacion()
 * seguimiento.iniciar(cliente.id, serviciosAntesDelPago, pago.servicios)
 * seguimiento.reactivados.value // servicios que estaban limitados o suspendidos y ya están activos
 * ```
 */
export function useSeguimientoReactivacion(opciones: OpcionesSeguimiento = {}) {
    const intervaloMs = opciones.intervaloMs ?? 3000
    const limiteMs = opciones.limiteMs ?? 30_000

    const servicios = shallowRef<Servicio[]>([])
    /** Estado de cada servicio al registrar el pago. */
    const antes = shallowRef(new Map<number, EstadoServicio>())
    /** Motivo de la evaluación de cada servicio (`Pago.servicios[].motivo`). */
    const motivos = shallowRef(new Map<number, string>())
    const siguiendo = ref(false)
    /** Pasaron los 30 s del sondeo de respaldo y algún servicio sigue sin reactivarse. */
    const agotado = ref(false)
    const problema = ref<Problem | null>(null)

    let temporizador: ReturnType<typeof setTimeout> | undefined
    let inicio = 0
    let clienteId = 0
    let ronda = 0

    /** Servicios que esperaban reactivación (limitados o suspendidos al pagar, sin suspensión manual). */
    const esperados = computed(() => servicios.value.filter((s) => {
        const previo = antes.value.get(s.id)
        return (previo === 'limitado' || previo === 'suspendido') && !s.suspension_manual
    }))

    const reactivados = computed(() => esperados.value.filter(s => s.estado === 'activo'))
    const pendientes = computed(() => esperados.value.filter(s => s.estado === 'limitado' || s.estado === 'suspendido'))
    /** Suspendidos a mano: siguen cortados aunque el cliente pague. */
    const suspendidosManual = computed(() => servicios.value.filter(s => s.suspension_manual && s.estado === 'suspendido'))

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

    /** Aplica a los servicios el estado que devolvió `POST /pagos`. */
    function aplicarEvaluacion(previos: Servicio[], evaluados: ServicioEvaluado[]): Servicio[] {
        const porId = new Map(evaluados.map(e => [e.servicio_id, e]))
        return previos.map((s) => {
            const evaluado = porId.get(s.id)
            return evaluado ? { ...s, estado: evaluado.estado } : s
        })
    }

    /**
     * Empieza el seguimiento. `previos` es cómo estaban los servicios antes del pago y
     * `evaluados`, `Pago.servicios[]` de la respuesta; sin `evaluados`, sondea como respaldo.
     */
    function iniciar(cliente: number, previos: Servicio[], evaluados?: ServicioEvaluado[]) {
        detener()
        ronda++
        clienteId = cliente
        inicio = Date.now()
        antes.value = new Map(previos.map(s => [s.id, s.estado]))
        motivos.value = new Map((evaluados ?? []).map(e => [e.servicio_id, e.motivo]))
        agotado.value = false
        problema.value = null
        if (evaluados) {
            servicios.value = aplicarEvaluacion(previos, evaluados)
            return
        }
        servicios.value = previos
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
        motivos.value = new Map()
        agotado.value = false
        problema.value = null
    }

    onScopeDispose(detener)

    return {
        servicios,
        motivos,
        siguiendo,
        agotado,
        problema,
        reactivados,
        pendientes,
        suspendidosManual,
        iniciar,
        detener,
        reiniciar,
    }
}
