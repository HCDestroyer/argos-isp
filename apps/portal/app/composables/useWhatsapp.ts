import type { Problem, Schema } from '@argosisp/contracts'

export type WhatsappPortal = Schema<'PortalWhatsapp'>
export type EstadoContactoWhatsapp = 'acepta' | 'baja'

/**
 * «Acepta avisos por WhatsApp» del cliente de la sesión (contrato Iris 0.6.0 §6.4).
 *
 * - `cargar()`: `GET /portal/whatsapp`. Si falla, `problema` queda con el error y `estado` sigue
 *   en null (o con lo último que respondió la API): nunca se inventa un estado.
 * - `registrar(estado, clave)`: `POST /portal/whatsapp` con `Idempotency-Key = clave` (la misma en
 *   los reintentos del mismo cambio). La API llama `RegistrarConsentimientoWhatsapp` de A6.
 */
export function useWhatsapp() {
    const api = useApi()
    const estado = ref<WhatsappPortal | null>(null)
    const problema = ref<Problem | null>(null)

    async function cargar(): Promise<Resultado<WhatsappPortal>> {
        const resultado = await resolver(api.GET('/api/v1/portal/whatsapp'))
        if (resultado.ok) {
            estado.value = resultado.data
            problema.value = null
        }
        else {
            problema.value = resultado.problema
        }
        return resultado
    }

    async function registrar(valor: EstadoContactoWhatsapp, clave: string): Promise<Resultado<WhatsappPortal>> {
        const resultado = await resolver(api.POST('/api/v1/portal/whatsapp', {
            params: { header: { 'Idempotency-Key': clave } },
            body: { estado: valor },
        }))
        if (resultado.ok) {
            estado.value = resultado.data
            problema.value = null
        }
        return resultado
    }

    return { estado, problema, cargar, registrar }
}
