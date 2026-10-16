import type { BadgeProps } from '@nuxt/ui'
import type { Schema } from '@argosisp/contracts'

/** Presentación de estados y métodos del portal autenticado (facturas, pagos, promesas). */

type Color = NonNullable<BadgeProps['color']>

interface Presentacion {
    etiqueta: string
    color: Color
}

export const ESTADOS_FACTURA: Record<Schema<'PortalFactura'>['estado'], Presentacion> = {
    emitida: { etiqueta: 'Pendiente', color: 'info' },
    parcial: { etiqueta: 'Abono parcial', color: 'warning' },
    vencida: { etiqueta: 'Vencida', color: 'error' },
    pagada: { etiqueta: 'Pagada', color: 'success' },
    anulada: { etiqueta: 'Anulada', color: 'neutral' },
}

export const ESTADOS_PAGO: Record<Schema<'PortalPago'>['estado'], Presentacion> = {
    registrado: { etiqueta: 'Aplicado', color: 'success' },
    pendiente_verificacion: { etiqueta: 'En verificación', color: 'warning' },
    anulado: { etiqueta: 'Anulado', color: 'neutral' },
}

export const METODOS_PAGO: Record<Schema<'PortalPago'>['metodo'], string> = {
    caja: 'Pago en oficina',
    pasarela: 'Pago en línea',
    deposito: 'Depósito bancario',
    agente: 'Agente autorizado',
    debito: 'Débito automático',
}

export const ESTADOS_PROMESA: Record<Schema<'PortalPromesa'>['estado'], Presentacion> = {
    activa: { etiqueta: 'Activa', color: 'info' },
    pendiente_aprobacion: { etiqueta: 'Pendiente de aprobación', color: 'warning' },
    cumplida: { etiqueta: 'Cumplida', color: 'success' },
    incumplida: { etiqueta: 'Incumplida', color: 'error' },
    rechazada: { etiqueta: 'Rechazada', color: 'error' },
    cancelada: { etiqueta: 'Cancelada', color: 'neutral' },
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
