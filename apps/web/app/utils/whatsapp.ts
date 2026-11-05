import type { Schema } from '@argosisp/contracts'
import type { PresentacionEstadoUi } from './estados'
import { formatearFechaHora } from './formato'

type WhatsappCliente = Schema<'WhatsappCliente'>
type Contacto = NonNullable<WhatsappCliente['contacto']>
type Consentimiento = Schema<'ConsentimientoWhatsapp'>

/**
 * Presentación del permiso de contacto por WhatsApp (contrato Iris 0.6.0 §6.4, A6). El registro
 * vive en Iris; aquí solo se pinta lo que Argos sabe, sin suponer nada cuando no se pudo leer.
 */

/** De dónde salió el último estado (`WhatsappCliente.contacto.origen`). */
const ORIGENES: Record<string, string> = {
    argos_panel: 'marcado en el panel',
    argos_portal: 'marcado en el portal',
    iris_vigente: 'estado vigente en Iris',
    iris_cliente: 'el cliente pidió la baja en el chat de Iris',
    iris_agente: 'un agente de Iris registró la baja',
}

export function etiquetaOrigenContacto(origen: string): string {
    return ORIGENES[origen] ?? origen
}

/** `true` si la baja vino de Iris (chat, agente o el estado vigente que respondió Iris). */
export function bajaDesdeIris(contacto: Contacto | null): boolean {
    return contacto?.estado === 'baja' && contacto.origen.startsWith('iris_')
}

/** Estado del contacto: acepta, baja (con quién la dio) o sin registro. */
export function presentacionContactoWhatsapp(contacto: Contacto | null): PresentacionEstadoUi {
    if (!contacto) {
        return { etiqueta: 'Sin permiso registrado', color: 'neutral', icono: 'i-lucide-circle-dashed' }
    }
    if (contacto.estado === 'acepta') {
        return { etiqueta: 'Acepta avisos por WhatsApp', color: 'success', icono: 'i-lucide-message-circle' }
    }
    return { etiqueta: bajaDesdeIris(contacto) ? 'Baja dada en Iris' : 'No acepta avisos por WhatsApp', color: 'warning', icono: 'i-lucide-message-circle-off' }
}

/** «Acepta desde el 15/10/2026 10:30 · marcado en el panel». */
export function detalleContactoWhatsapp(contacto: Contacto): string {
    return `${contacto.estado === 'acepta' ? 'Desde' : 'Baja del'} ${formatearFechaHora(contacto.ocurrido_en)} · ${etiquetaOrigenContacto(contacto.origen)}`
}

export const ENTREGAS_CONSENTIMIENTO: Record<Consentimiento['entrega'], PresentacionEstadoUi> = {
    pendiente: { etiqueta: 'En cola hacia Iris', color: 'warning', icono: 'i-lucide-clock' },
    enviado: { etiqueta: 'Entregado a Iris', color: 'success', icono: 'i-lucide-circle-check' },
    fallido: { etiqueta: 'No se pudo entregar a Iris', color: 'error', icono: 'i-lucide-circle-x' },
}

/** Valor inicial de la casilla: marcada solo si el último estado conocido es `acepta`. */
export function aceptaWhatsapp(estado: WhatsappCliente | null): boolean {
    return estado?.contacto?.estado === 'acepta'
}
