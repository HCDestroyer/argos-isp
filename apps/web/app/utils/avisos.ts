import type { Schema } from '@argosisp/contracts'
import type { BadgeProps } from '@nuxt/ui'

type Envio = Schema<'EnvioNotificacion'>
export type CanalAviso = Schema<'PlantillaNotificacion'>['canal']

/**
 * Plantillas de notificación, recordatorios y envíos (A6, `apps/api/app/notify/README.md`):
 * nombres legibles de canales, estados y grupos. Los eventos, su nombre y sus variables vienen
 * de la API (`GET /notificaciones/eventos`, `useEventosNotificacion`).
 */

export const CANALES_AVISO: Record<CanalAviso, { etiqueta: string, icono: string }> = {
    correo: { etiqueta: 'Correo', icono: 'i-lucide-mail' },
    telegram: { etiqueta: 'Telegram', icono: 'i-lucide-send' },
    whatsapp: { etiqueta: 'WhatsApp', icono: 'i-lucide-message-circle' },
}

export const ESTADOS_ENVIO: Record<Envio['estado'], { etiqueta: string, color: BadgeProps['color'], icono: string }> = {
    encolado: { etiqueta: 'En cola', color: 'info', icono: 'i-lucide-clock' },
    enviado: { etiqueta: 'Enviado', color: 'success', icono: 'i-lucide-circle-check' },
    fallido: { etiqueta: 'Fallido', color: 'error', icono: 'i-lucide-circle-x' },
    omitido: { etiqueta: 'Omitido', color: 'neutral', icono: 'i-lucide-circle-minus' },
}

/** Nombre de cada grupo del catálogo (`EventoNotificacion.grupo`). */
export const GRUPOS_EVENTO: Record<Schema<'EventoNotificacion'>['grupo'], string> = {
    cliente: 'Avisos al cliente',
    recordatorio: 'Recordatorios de pago',
    alerta: 'Alertas al equipo',
}

/** Días respecto al vencimiento, en palabras («3 días antes», «el día que vence»). */
export function diasRecordatorio(dias: number): string {
    if (dias === 0) {
        return 'El día que vence'
    }
    const n = Math.abs(dias)
    return `${n} ${n === 1 ? 'día' : 'días'} ${dias < 0 ? 'antes' : 'después'} del vencimiento`
}
