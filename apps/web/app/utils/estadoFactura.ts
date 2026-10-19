import type { Schema } from '@argosisp/contracts'
import type { BadgeProps } from '@nuxt/ui'

export type EstadoFactura = Schema<'EstadoFactura'>

/** Color por urgencia, icono por identidad y texto siempre (`docs/identidad.md`). */
export const ESTADOS_FACTURA: Record<EstadoFactura, { etiqueta: string, color: NonNullable<BadgeProps['color']>, icono: string }> = {
    por_certificar: { etiqueta: 'Por certificar', color: 'neutral', icono: 'i-lucide-file-clock' },
    castigada: { etiqueta: 'Castigada', color: 'neutral', icono: 'i-lucide-file-x' },
    emitida: { etiqueta: 'Emitida', color: 'info', icono: 'i-lucide-file-text' },
    parcial: { etiqueta: 'Pago parcial', color: 'warning', icono: 'i-lucide-circle-dot-dashed' },
    pagada: { etiqueta: 'Pagada', color: 'success', icono: 'i-lucide-circle-check' },
    vencida: { etiqueta: 'Vencida', color: 'error', icono: 'i-lucide-alarm-clock' },
    anulada: { etiqueta: 'Anulada', color: 'neutral', icono: 'i-lucide-ban' },
}
