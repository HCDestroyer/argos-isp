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

/** Una factura reemplazada por otra (sustitución) se muestra así, sea cual sea su estado. */
export const FACTURA_SUSTITUIDA: Presentacion = { etiqueta: 'Sustituida', color: 'neutral', icono: 'i-lucide-replace' }

/** Insignia de una factura: «Sustituida» manda sobre su estado de cobro. */
export function presentacionFactura(factura: Pick<Schema<'PortalFactura'>, 'estado' | 'sustituida'>): Presentacion {
    return factura.sustituida ? FACTURA_SUSTITUIDA : ESTADOS_FACTURA[factura.estado]
}

export const ESTADOS_NOTA_CREDITO: Record<Schema<'PortalNotaCredito'>['estado'], Presentacion> = {
    vigente: { etiqueta: 'Aplicada', color: 'success', icono: 'i-lucide-circle-check' },
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

const DOCUMENTOS: Record<Schema<'PortalFactura'>['documento'], string> = {
    aviso_cobro: 'Aviso de cobro',
    factura: 'Factura',
    nota_debito: 'Nota de débito',
}

/** "Aviso de cobro 1203"; "Factura A1B2C3D4-2814509" solo con su DTE certificado. */
export function nombreDocumento(factura: Pick<Schema<'PortalFactura'>, 'documento' | 'numero'>): string {
    return `${DOCUMENTOS[factura.documento]} ${factura.numero}`
}

/** "Nota de crédito 312" (interna) o "Nota de crédito (NCRE) 5D41402A-2874519" (certificada). */
export function nombreNotaCredito(nota: Pick<Schema<'PortalNotaCredito'>, 'documento' | 'numero'>): string {
    return `Nota de crédito${nota.documento === 'ncre' ? ' (NCRE)' : ''} ${nota.numero}`
}

/** Texto del botón del PDF según el documento. */
export function etiquetaPdf(factura: Pick<Schema<'PortalFactura'>, 'documento'>): string {
    return `Ver ${DOCUMENTOS[factura.documento].toLowerCase()} (PDF)`
}

/** Concepto corto de la factura: "Servicio de octubre 2026" o "Recargo por mora". */
export function conceptoFactura(factura: Pick<Schema<'PortalFactura'>, 'tipo' | 'periodo'>): string {
    return factura.tipo === 'mora' ? 'Recargo por mora' : `Servicio de ${formatearPeriodo(factura.periodo)}`
}
