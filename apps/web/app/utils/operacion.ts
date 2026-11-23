import type { Schema } from '@argosisp/contracts'
import type { TableProps, TableRow } from '@nuxt/ui'

/**
 * Piezas comunes del área de operación (comprobantes, promesas, facturas, bitácora, usuarios):
 * la fila abierta en el panel de la derecha y las etiquetas cortas por canal.
 */

/** Fila abierta en el panel de detalle: fondo índigo suave y filete a la izquierda (tableros Oper*). */
export const CLASE_FILA_ELEGIDA = 'bg-primary/5 shadow-[inset_3px_0_0_var(--ui-primary)]'

/** `meta` de un `UTable` que resalta la fila abierta y pone el cursor de clic en todas. */
export function metaFilaElegida<T>(esElegida: (fila: T) => boolean): NonNullable<TableProps<T>['meta']> {
    return {
        class: { tr: (fila: TableRow<T>) => `cursor-pointer ${esElegida(fila.original) ? CLASE_FILA_ELEGIDA : ''}` },
    }
}

/** Escritorio (lg, 1024 px): las listas abren el detalle a la derecha; en el teléfono, su pantalla. */
export function esEscritorio(): boolean {
    return import.meta.client && window.matchMedia('(min-width: 1024px)').matches
}

/** Por dónde llegó un comprobante, corto y con su tono (pastilla de la cola). */
export const CANAL_COMPROBANTE_CORTO: Record<Schema<'Comprobante'>['canal'], { etiqueta: string, tono: string }> = {
    iris: { etiqueta: 'Iris', tono: 'tono-2' },
    portal: { etiqueta: 'Portal', tono: 'tono-1' },
    panel: { etiqueta: 'Panel', tono: 'tono-marca' },
}

type FacturaNumerada = Pick<Schema<'Factura'>, 'id' | 'fel_serie' | 'fel_numero'>

/** Número a la vista: serie y número del DTE (`A 004512`) o, sin DTE, `#9101`. */
export function numeroFactura(factura: FacturaNumerada): string {
    return factura.fel_serie && factura.fel_numero ? `${factura.fel_serie} ${factura.fel_numero}` : `#${factura.id}`
}

/** Días que lleva vencida una factura con saldo (0 si no ha vencido o ya no se debe). */
export function diasVencidaFactura(factura: Pick<Schema<'Factura'>, 'vence_en' | 'estado'>, hoy: string): number {
    if (!['emitida', 'parcial', 'vencida'].includes(factura.estado) || factura.vence_en >= hoy) {
        return 0
    }
    return Math.round((Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${factura.vence_en}T00:00:00Z`)) / 86_400_000)
}
