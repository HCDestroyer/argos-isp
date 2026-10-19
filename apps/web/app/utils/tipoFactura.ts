import type { Schema } from '@argosisp/contracts'
import type { BadgeProps } from '@nuxt/ui'

export type TipoFactura = NonNullable<Schema<'Factura'>['tipo']>

interface TipoVisual {
    etiqueta: string
    icono: string
    color: NonNullable<BadgeProps['color']>
    /** Qué es, para la ficha (null en la factura normal del periodo). */
    descripcion: string | null
}

/**
 * Tipos de factura (`Factura.tipo`): la del periodo no lleva insignia y `mora` es el recargo por
 * vencimiento de otra factura. (El `cargo` interno de H18 desapareció con la decisión B: la diferencia
 * de cobro se cierra como gasto y no vuelve a deberse en una factura.)
 */
export const TIPOS_FACTURA: Record<TipoFactura, TipoVisual> = {
    servicio: { etiqueta: 'Factura del periodo', icono: 'i-lucide-file-text', color: 'neutral', descripcion: null },
    mora: {
        etiqueta: 'Recargo por mora',
        icono: 'i-lucide-calendar-x',
        color: 'warning',
        descripcion: 'Recargo por el vencimiento de otra factura.',
    },
}

/** Insignia del tipo, o null para la factura del periodo. Un tipo desconocido se muestra por su nombre. */
export function tipoFacturaVisual(tipo: string | null | undefined): TipoVisual | null {
    if (!tipo || tipo === 'servicio') {
        return null
    }
    if (Object.hasOwn(TIPOS_FACTURA, tipo)) {
        return TIPOS_FACTURA[tipo as TipoFactura]
    }
    const texto = tipo.replace(/_/g, ' ')
    return { etiqueta: texto.charAt(0).toUpperCase() + texto.slice(1), icono: 'i-lucide-file-question', color: 'neutral', descripcion: null }
}

/** Texto de la relación con `factura_origen_id`: "mora de la"… */
export function relacionOrigen(tipo: string | null | undefined): string {
    return tipo === 'mora' ? 'mora de la' : 'originada por la'
}
