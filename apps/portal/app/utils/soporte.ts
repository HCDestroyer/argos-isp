import type { BadgeProps } from '@nuxt/ui'
import type { Schema } from '@argosisp/contracts'
import { ACEPTA_FOTOS, esTipoSubible } from '~/utils/fotos'

/**
 * Soporte en el portal (tickets y solicitudes de Iris, contrato Iris 0.9.0 §11). Textos y colores de
 * los estados que ve el cliente: siempre ícono, texto y color.
 */

export type TicketSoporte = Schema<'PortalTicket'>
export type MensajeTicket = Schema<'PortalMensajeTicket'>
export type SolicitudServicio = Schema<'PortalSolicitudServicio'>
export type DisponibilidadSoporte = Schema<'PortalSoporte'>
export type EstadoTicket = TicketSoporte['estado']
export type TipoSolicitud = SolicitudServicio['tipo']
export type EstadoSolicitud = SolicitudServicio['estado_cliente']

interface Presentacion {
    etiqueta: string
    color: NonNullable<BadgeProps['color']>
    icono: string
}

export const ESTADOS_TICKET: Record<EstadoTicket, Presentacion> = {
    nuevo: { etiqueta: 'Recibido', color: 'info', icono: 'i-lucide-inbox' },
    abierto: { etiqueta: 'En proceso', color: 'warning', icono: 'i-lucide-clock' },
    en_espera: { etiqueta: 'Esperamos tu respuesta', color: 'warning', icono: 'i-lucide-message-circle-question' },
    resuelto: { etiqueta: 'Resuelto', color: 'success', icono: 'i-lucide-circle-check' },
    cerrado: { etiqueta: 'Cerrado', color: 'neutral', icono: 'i-lucide-archive' },
}

export const ESTADOS_SOLICITUD: Record<EstadoSolicitud, Presentacion> = {
    recibida: { etiqueta: 'Recibida', color: 'info', icono: 'i-lucide-inbox' },
    en_revision: { etiqueta: 'En revisión', color: 'warning', icono: 'i-lucide-search' },
    cotizada: { etiqueta: 'Cotizada', color: 'info', icono: 'i-lucide-file-text' },
    en_proceso: { etiqueta: 'En proceso', color: 'warning', icono: 'i-lucide-clock' },
    completada: { etiqueta: 'Completada', color: 'success', icono: 'i-lucide-circle-check' },
    no_procede: { etiqueta: 'No procede', color: 'neutral', icono: 'i-lucide-circle-slash' },
}

export interface OpcionSolicitud {
    tipo: TipoSolicitud
    titulo: string
    descripcion: string
    icono: string
}

/** Las cuatro opciones del tablero «Solicitar un servicio» (diseño `NuevoPortal`). */
export const OPCIONES_SOLICITUD: readonly OpcionSolicitud[] = [
    { tipo: 'cambio_plan', titulo: 'Cambiar de plan', descripcion: 'Más velocidad desde el próximo mes', icono: 'i-lucide-gauge' },
    { tipo: 'alta', titulo: 'Otro servicio', descripcion: 'Internet en otra casa o negocio', icono: 'i-lucide-house-plus' },
    { tipo: 'traslado', titulo: 'Traslado', descripcion: 'Me mudo y quiero llevar mi internet', icono: 'i-lucide-map-pin' },
    { tipo: 'otro', titulo: 'Otra solicitud', descripcion: 'TV, adicionales u otra cosa', icono: 'i-lucide-sparkles' },
]

export function tituloSolicitud(tipo: TipoSolicitud): string {
    return OPCIONES_SOLICITUD.find(o => o.tipo === tipo)?.titulo ?? 'Solicitud'
}

/** La solicitud lleva servicio (`cambio_plan` y `traslado` siempre; `otro` si quiere). */
export function pideServicio(tipo: TipoSolicitud): 'obligatorio' | 'opcional' | 'no' {
    if (tipo === 'cambio_plan' || tipo === 'traslado') {
        return 'obligatorio'
    }
    return tipo === 'otro' ? 'opcional' : 'no'
}

/** La solicitud lleva dirección nueva (`alta` y `traslado`). */
export function pideDireccion(tipo: TipoSolicitud): boolean {
    return tipo === 'alta' || tipo === 'traslado'
}

/** ¿Se muestra la sección «Soporte»? Solo si hay un Iris conectado (aunque esté caído). */
export function soporteVisible(disponibilidad: DisponibilidadSoporte | null): boolean {
    return disponibilidad !== null && disponibilidad.estado !== 'sin_iris'
}

/** Tickets que siguen abiertos (para el punto de la barra). */
export function ticketsPendientes(tickets: readonly TicketSoporte[]): number {
    return tickets.filter(t => t.estado === 'en_espera' || t.estado === 'resuelto').length
}

/** «hace 2 h», «hace 3 días», o la fecha. */
export function haceCuanto(iso: string, ahora: Date = new Date()): string {
    const minutos = Math.round((ahora.getTime() - new Date(iso).getTime()) / 60_000)
    if (minutos < 1) {
        return 'hace un momento'
    }
    if (minutos < 60) {
        return `hace ${minutos} min`
    }
    const horas = Math.round(minutos / 60)
    if (horas < 24) {
        return `hace ${horas} h`
    }
    const dias = Math.round(horas / 24)
    if (dias < 7) {
        return dias === 1 ? 'ayer' : `hace ${dias} días`
    }
    return formatearFecha(iso)
}

/** Tamaño legible de un adjunto. */
export function tamanoArchivo(bytes: number): string {
    if (bytes < 1024 * 1024) {
        return `${Math.max(1, Math.round(bytes / 1024))} KB`
    }
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Hasta 3 adjuntos de 10 MB: JPEG, PNG o PDF (§11.6, 0.14.2). Otra foto (HEIC, WebP…) se convierte a
 * JPEG antes con `prepararArchivo` (`utils/fotos`). El tipo real lo revisa Iris por el contenido.
 */
export const ADJUNTOS_MAXIMO = 3
export const ADJUNTO_TAMANO_MAXIMO = 10 * 1024 * 1024
export const ADJUNTO_ACEPTA = ACEPTA_FOTOS

/** Errores de los archivos elegidos antes de enviarlos (null si están bien). */
export function errorAdjuntos(archivos: readonly File[]): string | null {
    if (archivos.length > ADJUNTOS_MAXIMO) {
        return `Puedes adjuntar hasta ${ADJUNTOS_MAXIMO} archivos`
    }
    const grande = archivos.find(a => a.size > ADJUNTO_TAMANO_MAXIMO)
    if (grande) {
        return `${grande.name} pesa más de 10 MB`
    }
    const otro = archivos.find(a => !esTipoSubible(a))
    if (otro) {
        return `${otro.name} no es una foto JPG o PNG ni un PDF`
    }
    return null
}

/** Un servicio de la cuenta (`GET /portal/cuenta`), para elegirlo en los formularios. */
export type ServicioCuenta = Schema<'PortalServicio'>

/** «50 Mbps · 5a avenida 10-20» para elegir el servicio en un formulario. */
export function etiquetaServicio(servicio: Pick<ServicioCuenta, 'id' | 'plan' | 'direccion'>): string {
    const partes = [servicio.plan ?? `Servicio ${servicio.id}`, servicio.direccion].filter(Boolean)
    return partes.join(' · ')
}
