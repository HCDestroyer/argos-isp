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

/**
 * Cómo se muestra un estado de factura, aunque la API mande uno que el panel todavía no conoce (por
 * ejemplo, si el castigo de cartera pasa a tener estado propio, §18 desvío g): se muestra tal cual
 * lo dice la API, en gris, en lugar de romper la pantalla.
 */
export function estadoFacturaVisual(estado: string): { etiqueta: string, color: NonNullable<BadgeProps['color']>, icono: string } {
    if (Object.hasOwn(ESTADOS_FACTURA, estado)) {
        return ESTADOS_FACTURA[estado as EstadoFactura]
    }
    const texto = estado.replace(/_/g, ' ')
    return { etiqueta: texto.charAt(0).toUpperCase() + texto.slice(1), color: 'neutral', icono: 'i-lucide-file-question' }
}
