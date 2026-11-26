import type { PresentacionEstadoUi } from './estados'
import type { AvisoPagoWhatsapp } from '~/composables/useAvisoPagoWhatsapp'

type Envio = NonNullable<AvisoPagoWhatsapp['envio']>

/** Estado del comprobante por WhatsApp (Iris) en la pantalla de éxito del cobro. */
export function presentacionEnvioPago(envio: Envio): PresentacionEstadoUi {
    switch (envio.estado) {
        case 'enviado':
            return {
                etiqueta: envio.leido_en ? 'Comprobante enviado por WhatsApp · leído' : 'Comprobante enviado por WhatsApp',
                color: 'success',
                icono: 'i-lucide-circle-check',
            }
        case 'encolado':
            return { etiqueta: 'Comprobante por WhatsApp en cola', color: 'warning', icono: 'i-lucide-clock' }
        case 'fallido':
            return { etiqueta: 'No se pudo enviar el comprobante por WhatsApp', color: 'error', icono: 'i-lucide-circle-x' }
        default:
            return { etiqueta: 'El comprobante no salió por WhatsApp', color: 'neutral', icono: 'i-lucide-message-circle-off' }
    }
}

/** ¿El estado aún puede cambiar (hay que volver a leer)? */
export function envioEnCurso(aviso: AvisoPagoWhatsapp): boolean {
    if (!aviso.canal.disponible || !aviso.plantilla_activa) {
        return false
    }
    return aviso.envio === null || aviso.envio.estado === 'encolado'
}
