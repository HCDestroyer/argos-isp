import type { Schema, paths } from '@argosisp/contracts'

export type WhatsappCliente = Schema<'WhatsappCliente'>
export type ConsentimientoWhatsapp = Schema<'ConsentimientoWhatsapp'>
export type DatosConsentimientoWhatsapp = paths['/api/v1/notificaciones/consentimientos']['post']['requestBody']['content']['application/json']

/**
 * Permiso de contacto por WhatsApp (contrato Iris 0.6.0 §6.4, A6). El registro vive en Iris:
 * Argos solo manda la casilla «Acepta avisos por WhatsApp» y muestra el último estado que conoce
 * (también la baja que el cliente dio en el chat).
 */
export function useConsentimientosWhatsapp() {
    const api = useApi()

    /** `GET /notificaciones/whatsapp/clientes/:id` (`notificaciones.ver`): canal, contacto y último envío a Iris. */
    function estadoCliente(clienteId: number): Promise<Resultado<WhatsappCliente>> {
        return resolver(api.GET('/api/v1/notificaciones/whatsapp/clientes/{id}', { params: { path: { id: clienteId } } }))
    }

    /**
     * `POST /notificaciones/consentimientos` (`notificaciones.registrar_consentimiento`) con
     * `Idempotency-Key`: `201` con `entrega: pendiente` (sale a Iris por su cola). Sin `empresa_id`
     * la API usa la activa o la única posible; si no, 422 `empresa_requerida`.
     */
    function registrar(datos: DatosConsentimientoWhatsapp, claveIdempotencia: string): Promise<Resultado<ConsentimientoWhatsapp>> {
        return resolver(api.POST('/api/v1/notificaciones/consentimientos', {
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
            body: datos,
        }))
    }

    return { estadoCliente, registrar }
}
