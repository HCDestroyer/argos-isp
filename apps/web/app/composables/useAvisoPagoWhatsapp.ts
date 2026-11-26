import type { Schema } from '@argosisp/contracts'

export type AvisoPagoWhatsapp = Schema<'AvisoPagoWhatsapp'>

/**
 * Comprobante de un pago por WhatsApp (Iris): `GET /notificaciones/pagos/:id/whatsapp`
 * (`pagos.ver`). Solo lectura: el aviso `pago_recibido` lo programa y manda notify/Iris al
 * registrarse el pago, nunca el navegador.
 */
export function useAvisoPagoWhatsapp() {
    const api = useApi()

    function ver(pagoId: number): Promise<Resultado<AvisoPagoWhatsapp>> {
        return resolver(api.GET('/api/v1/notificaciones/pagos/{id}/whatsapp', { params: { path: { id: pagoId } } }))
    }

    return { ver }
}
