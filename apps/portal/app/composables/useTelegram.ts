import type { Problem, Schema } from '@argosisp/contracts'

export type EstadoTelegram = Schema<'PortalTelegram'>
export type VinculoTelegram = Schema<'PortalVinculoTelegram'>
export type TelegramEmpresa = Schema<'PortalTelegramEmpresa'>

export interface OpcionesTelegram {
    /** Cada cuánto se consulta mientras el código está vigente (3 s). */
    intervaloMs?: number
    /**
     * Empresa cuyo bot se vincula (multiempresa, "Varios bots" en `contratos/telegram.md`): el código
     * se pide con su `empresa_id` y se espera hasta que el bot de ESA empresa quede vinculado. Sin
     * ella, el vínculo general de siempre.
     */
    empresaId?: number
}

/** Solo el vencimiento del código pendiente (nunca el código): para seguir esperando tras recargar. */
const CLAVE_PENDIENTE = 'argos:telegram:vence'

function clavePendiente(empresaId: number | undefined): string {
    return empresaId === undefined ? CLAVE_PENDIENTE : `${CLAVE_PENDIENTE}:${empresaId}`
}

function leerPendiente(clave: string): number {
    try {
        const valor = Number(sessionStorage.getItem(clave))
        return Number.isFinite(valor) && valor > Date.now() ? valor : 0
    }
    catch {
        return 0
    }
}

function guardarPendiente(clave: string, vence: number | null): void {
    try {
        if (vence) {
            sessionStorage.setItem(clave, String(vence))
        }
        else {
            sessionStorage.removeItem(clave)
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
 * - `vincular()`: `POST /portal/telegram/vincular` (con `empresa_id` si la tarjeta es de una empresa)
 *   → código de un solo uso y enlace al bot; luego consulta cada 3 s hasta ver `vinculado` (el de
 *   la empresa, si la hay) o hasta que venza el código.
 * - `desvincular()`: `POST /portal/telegram/desvincular` (si el canal preferido era Telegram, la
 *   API lo pasa a correo).
 */
export function useTelegram(opciones: OpcionesTelegram = {}) {
    const api = useApi()
    const intervaloMs = opciones.intervaloMs ?? 3_000
    const empresaId = opciones.empresaId
    const clave = clavePendiente(empresaId)

    const estado = ref<EstadoTelegram | null>(null)
    const problema = ref<Problem | null>(null)
    const esperando = ref(false)
    let temporizador: ReturnType<typeof setTimeout> | undefined
    let venceEn = 0

    /** Telegram de la empresa de esta tarjeta (`empresas[]` de la API), o null. */
    const deLaEmpresa = computed<TelegramEmpresa | null>(() => empresaId === undefined
        ? null
        : estado.value?.empresas.find(e => e.empresa.id === empresaId) ?? null)
    /** Con empresa: el bot de esa empresa ya le escribe; sin ella, el vínculo general. */
    const vinculado = computed(() => empresaId === undefined
        ? estado.value?.vinculado ?? false
        : deLaEmpresa.value?.vinculado ?? false)
    const disponible = computed(() => empresaId === undefined
        ? estado.value?.disponible ?? false
        : deLaEmpresa.value?.disponible ?? false)

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
            if (vinculado.value || Date.now() >= venceEn) {
                guardarPendiente(clave, null)
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
        const vence = leerPendiente(clave)
        if (vence && !vinculado.value) {
            esperarVinculo(vence)
            return true
        }
        return false
    }

    async function vincular(): Promise<Resultado<VinculoTelegram>> {
        const resultado = await resolver(api.POST('/api/v1/portal/telegram/vincular', {
            body: empresaId === undefined ? {} : { empresa_id: empresaId },
        }))
        if (resultado.ok) {
            const vence = new Date(resultado.data.vence_en).getTime()
            guardarPendiente(clave, vence)
            esperarVinculo(vence)
        }
        return resultado
    }

    async function desvincular(): Promise<Resultado<EstadoTelegram>> {
        detener()
        guardarPendiente(clave, null)
        const resultado = await resolver(api.POST('/api/v1/portal/telegram/desvincular'))
        if (resultado.ok) {
            estado.value = resultado.data
        }
        return resultado
    }

    onScopeDispose(detener)

    return { estado, problema, esperando, vinculado, disponible, deLaEmpresa, cargar, vincular, desvincular, reanudar, detener }
}
