import type { BadgeProps } from '@nuxt/ui'
import type { Schema } from '@argosisp/contracts'

/**
 * Presentación de estados y métodos del portal autenticado (facturas, pagos, promesas).
 * Todo estado = icono Lucide + texto + color (skill horus-identity, `estados.md`): la urgencia
 * decide el color (¿hay que actuar ya? error · ¿conviene mirarlo? warning · bien: success ·
 * solo informa: info/neutral), el icono distingue los que comparten color y el texto siempre está.
 * Nunca `primary` para un estado: es la marca y la acción.
 */

type Color = NonNullable<BadgeProps['color']>

export interface Presentacion {
    etiqueta: string
    color: Color
    icono: string
}

export const ESTADOS_FACTURA: Record<Schema<'PortalFactura'>['estado'], Presentacion> = {
    emitida: { etiqueta: 'Pendiente', color: 'info', icono: 'i-lucide-clock' },
    parcial: { etiqueta: 'Abono parcial', color: 'warning', icono: 'i-lucide-circle-dashed' },
    vencida: { etiqueta: 'Vencida', color: 'error', icono: 'i-lucide-calendar-x' },
    pagada: { etiqueta: 'Pagada', color: 'success', icono: 'i-lucide-circle-check' },
    anulada: { etiqueta: 'Anulada', color: 'neutral', icono: 'i-lucide-ban' },
}

export const ESTADOS_PAGO: Record<Schema<'PortalPago'>['estado'], Presentacion> = {
    registrado: { etiqueta: 'Aplicado', color: 'success', icono: 'i-lucide-circle-check' },
    pendiente_verificacion: { etiqueta: 'En verificación', color: 'warning', icono: 'i-lucide-hourglass' },
    anulado: { etiqueta: 'Anulado', color: 'neutral', icono: 'i-lucide-ban' },
}

export const METODOS_PAGO: Record<Schema<'PortalPago'>['metodo'], string> = {
    caja: 'Pago en oficina',
    pasarela: 'Pago en línea',
    deposito: 'Depósito bancario',
    transferencia: 'Transferencia',
    ach: 'Transferencia ACH',
    remesa: 'Remesa',
    agente: 'Agente autorizado',
    debito: 'Débito automático',
}

export const ESTADOS_PROMESA: Record<Schema<'PortalPromesa'>['estado'], Presentacion> = {
    activa: { etiqueta: 'Activa', color: 'info', icono: 'i-lucide-hand-coins' },
    pendiente_aprobacion: { etiqueta: 'Pendiente de aprobación', color: 'warning', icono: 'i-lucide-hourglass' },
    cumplida: { etiqueta: 'Cumplida', color: 'success', icono: 'i-lucide-circle-check' },
    incumplida: { etiqueta: 'Incumplida', color: 'error', icono: 'i-lucide-calendar-x' },
    rechazada: { etiqueta: 'Rechazada', color: 'error', icono: 'i-lucide-circle-x' },
    cancelada: { etiqueta: 'Cancelada', color: 'neutral', icono: 'i-lucide-circle-slash' },
}

export const CANALES_PREFERIDOS: { label: string, value: Schema<'PortalContacto'>['canal_preferido'] }[] = [
    { label: 'Correo', value: 'correo' },
    { label: 'Telegram', value: 'telegram' },
    { label: 'WhatsApp', value: 'whatsapp' },
]

const MESES = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

/** `2026-10-01` → `octubre 2026` (fecha calendario, sin zona horaria). */
export function formatearPeriodo(periodo: string): string {
    const partes = /^(\d{4})-(\d{2})-\d{2}$/.exec(periodo)
    const mes = partes ? MESES[Number(partes[2]) - 1] : undefined
    return partes && mes ? `${mes} ${partes[1]}` : periodo
}

/** "Aviso de cobro 1203" o "Factura A-123" (con FEL, semana 5). */
export function nombreDocumento(factura: Pick<Schema<'PortalFactura'>, 'documento' | 'numero'>): string {
    return `${factura.documento === 'factura' ? 'Factura' : 'Aviso de cobro'} ${factura.numero}`
}

/** Concepto corto de la factura: "Servicio de octubre 2026" o "Recargo por mora". */
export function conceptoFactura(factura: Pick<Schema<'PortalFactura'>, 'tipo' | 'periodo'>): string {
    return factura.tipo === 'mora' ? 'Recargo por mora' : `Servicio de ${formatearPeriodo(factura.periodo)}`
}
