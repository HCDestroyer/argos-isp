import type { Schema } from '@argosisp/contracts'
import type { BadgeProps } from '@nuxt/ui'

export type EstadoFactura = Schema<'EstadoFactura'>

export const ESTADOS_FACTURA: Record<EstadoFactura, { etiqueta: string, color: NonNullable<BadgeProps['color']> }> = {
    emitida: { etiqueta: 'Emitida', color: 'info' },
    parcial: { etiqueta: 'Pago parcial', color: 'warning' },
    pagada: { etiqueta: 'Pagada', color: 'success' },
    vencida: { etiqueta: 'Vencida', color: 'error' },
    anulada: { etiqueta: 'Anulada', color: 'neutral' },
}
