import type { Problem, Schema } from '@argosisp/contracts'

export type EstadoTelegram = Schema<'PortalTelegram'>
export type VinculoTelegram = Schema<'PortalVinculoTelegram'>

export interface OpcionesTelegram {
    /** Cada cuánto se consulta mientras el código está vigente (3 s). */
    intervaloMs?: number
}

/** Solo el vencimiento del código pendiente (nunca el código): para seguir esperando tras recargar. */
const CLAVE_PENDIENTE = 'argos:telegram:vence'

function leerPendiente(): number {
    try {
        const valor = Number(sessionStorage.getItem(CLAVE_PENDIENTE))
        return Number.isFinite(valor) && valor > Date.now() ? valor : 0
    }
    catch {
        return 0
    }
}

function guardarPendiente(vence: number | null): void {
    try {
        if (vence) {
            sessionStorage.setItem(CLAVE_PENDIENTE, String(vence))
        }
        else {
            sessionStorage.removeItem(CLAVE_PENDIENTE)
        }
    }
    catch {
        // Sin almacenamiento (modo privado): solo se pierde la espera al recargar.
    }
}

/**
 * Vinculación de Telegram del cliente de la sesión (contrato de A6 en
 * `.claude/integration/contratos/telegram.md`).
 *
 * - `cargar()`: `GET /portal/telegram`.
 * - `vincular()`: `POST /portal/telegram/vincular` → código de un solo uso y enlace al bot; luego
 *   consulta cada 3 s hasta ver `vinculado` o hasta que venza el código.
 * - `desvincular()`: `POST /portal/telegram/desvincular` (si el canal preferido era Telegram, la
 *   API lo pasa a correo).
 */
export function useTelegram(opciones: OpcionesTelegram = {}) {
    const api = useApi()
    const intervaloMs = opciones.intervaloMs ?? 3_000

    const estado = ref<EstadoTelegram | null>(null)
    const problema = ref<Problem | null>(null)
    const esperando = ref(false)
    let temporizador: ReturnType<typeof setTimeout> | undefined
    let venceEn = 0

    async function cargar(): Promise<Resultado<EstadoTelegram>> {
        const resultado = await resolver(api.GET('/api/v1/portal/telegram'))
        if (resultado.ok) {
            estado.value = resultado.data
            problema.value = null
        }
        else if (!estado.value) {
            problema.value = resultado.problema
        }
        return resultado
    }

    function detener(): void {
        if (temporizador) {
            clearTimeout(temporizador)
            temporizador = undefined
        }
        esperando.value = false
    }

    function programar(): void {
        temporizador = setTimeout(async () => {
            temporizador = undefined
            await cargar()
            if (!esperando.value) {
                return
            }
            if (estado.value?.vinculado || Date.now() >= venceEn) {
                guardarPendiente(null)
                detener()
                return
            }
            programar()
        }, intervaloMs)
    }

    /** Espera a que el bot canjee el código hasta `vence` (ms). */
    function esperarVinculo(vence: number): void {
        detener()
        venceEn = vence
        esperando.value = true
        programar()
    }

    /** Si hay un código pendiente de antes de recargar, sigue esperando. */
    function reanudar(): boolean {
        const vence = leerPendiente()
        if (vence && !estado.value?.vinculado) {
            esperarVinculo(vence)
            return true
        }
        return false
    }

    async function vincular(): Promise<Resultado<VinculoTelegram>> {
        const resultado = await resolver(api.POST('/api/v1/portal/telegram/vincular'))
        if (resultado.ok) {
            const vence = new Date(resultado.data.vence_en).getTime()
            guardarPendiente(vence)
            esperarVinculo(vence)
        }
        return resultado
    }

    async function desvincular(): Promise<Resultado<EstadoTelegram>> {
        detener()
        guardarPendiente(null)
        const resultado = await resolver(api.POST('/api/v1/portal/telegram/desvincular'))
        if (resultado.ok) {
            estado.value = resultado.data
        }
        return resultado
    }

    onScopeDispose(detener)

    return { estado, problema, esperando, cargar, vincular, desvincular, reanudar, detener }
}
