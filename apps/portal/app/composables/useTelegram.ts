import type { Problem, Schema } from '@argosisp/contracts'

export type EstadoTelegram = Schema<'PortalTelegram'>
export type VinculoTelegram = Schema<'PortalVinculoTelegram'>

export interface OpcionesTelegram {
    /** Cada cuánto se consulta mientras hay un enlace pendiente (3 s). */
    intervaloMs?: number
}

/**
 * Vinculación de Telegram del cliente de la sesión (contrato `.claude/integration/contratos/telegram.md`).
 *
 * - `cargar()`: `GET /portal/telegram`.
 * - `vincular()`: `POST /portal/telegram/vincular` → enlace de un solo uso al bot; después consulta
 *   cada 3 s hasta ver `vinculado` o hasta que venza el enlace (`pendiente_hasta`).
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
            const actual = estado.value
            const vence = actual?.pendiente_hasta ? new Date(actual.pendiente_hasta).getTime() : 0
            if (!esperando.value || actual?.vinculado || vence <= Date.now()) {
                detener()
                return
            }
            programar()
        }, intervaloMs)
    }

    /** Espera a que el bot canjee el enlace (sin abrir uno nuevo). */
    function esperarVinculo(): void {
        detener()
        esperando.value = true
        programar()
    }

    async function vincular(): Promise<Resultado<VinculoTelegram>> {
        const resultado = await resolver(api.POST('/api/v1/portal/telegram/vincular'))
        if (resultado.ok && estado.value) {
            estado.value = { ...estado.value, pendiente_hasta: resultado.data.expira_en }
        }
        if (resultado.ok) {
            esperarVinculo()
        }
        return resultado
    }

    async function desvincular(): Promise<Resultado<EstadoTelegram>> {
        detener()
        const resultado = await resolver(api.POST('/api/v1/portal/telegram/desvincular'))
        if (resultado.ok) {
            estado.value = resultado.data
        }
        return resultado
    }

    onScopeDispose(detener)

    return { estado, problema, esperando, cargar, vincular, desvincular, esperarVinculo, detener }
}
