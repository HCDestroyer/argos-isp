import type { Schema } from '@argosisp/contracts'
import type { BadgeProps } from '@nuxt/ui'

type FacturaApi = Schema<'Factura'>
export type TipoFactura = NonNullable<FacturaApi['tipo']>

interface TipoVisual {
    etiqueta: string
    icono: string
    color: NonNullable<BadgeProps['color']>
    /** Qué es, para la ficha (null en la factura normal del periodo). */
    descripcion: string | null
}

/**
 * Tipos de factura (`Factura.tipo`): la del periodo no lleva insignia. `mora` es el recargo por
 * vencimiento de otra factura; `cargo` (H18) es un cargo interno no fiscal sin IVA, ligado por
 * `factura_origen_id` a la factura de la diferencia de cobro: nunca se certifica.
 */
export const TIPOS_FACTURA: Record<TipoFactura, TipoVisual> = {
    servicio: { etiqueta: 'Factura del periodo', icono: 'i-lucide-file-text', color: 'neutral', descripcion: null },
    mora: {
        etiqueta: 'Recargo por mora',
        icono: 'i-lucide-calendar-x',
        color: 'warning',
        descripcion: 'Recargo por el vencimiento de otra factura.',
    },
    cargo: {
        etiqueta: 'Cargo interno',
        icono: 'i-lucide-receipt',
        color: 'neutral',
        descripcion: 'Cargo interno no fiscal y sin IVA: la diferencia de cobro que volvió a deberse al anular el pago que la cerró. No va a FEL ni cuenta para limitar o cortar el servicio.',
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

/** Texto de la relación con `factura_origen_id`: "mora de la", "cargo de la"… */
export function relacionOrigen(tipo: string | null | undefined): string {
    if (tipo === 'cargo') {
        return 'diferencia de cobro de la'
    }
    return tipo === 'mora' ? 'mora de la' : 'originada por la'
}

/**
 * Estado FEL para la ficha: un cargo interno y una factura acreditada sin DTE no se certifican
 * (certificar a mano da 409 `factura_acreditada`), así que no se muestran como "Sin certificar".
 */
export function felDeFactura(factura: Pick<FacturaApi, 'tipo' | 'estado' | 'fel_estado'>): string {
    if (factura.fel_estado) {
        return factura.fel_estado
    }
    if (factura.tipo === 'cargo') {
        return 'No se certifica (cargo interno)'
    }
    if (factura.estado === 'acreditada') {
        return 'No se certifica (acreditada)'
    }
    return 'Sin certificar'
}
