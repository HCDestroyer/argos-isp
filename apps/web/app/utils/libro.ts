import type { Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'

type AsientoLibro = Schema<'Asiento'>
type Origen = AsientoLibro['origen_tipo']

export const ORIGENES_ASIENTO: Record<Origen, { etiqueta: string, icono: string }> = {
    factura: { etiqueta: 'Factura', icono: 'i-lucide-receipt-text' },
    pago: { etiqueta: 'Pago', icono: 'i-lucide-banknote' },
    mora: { etiqueta: 'Mora', icono: 'i-lucide-calendar-x' },
    nota_credito: { etiqueta: 'Nota de crédito', icono: 'i-lucide-file-minus' },
    egreso: { etiqueta: 'Egreso', icono: 'i-lucide-arrow-up-right' },
    cierre_caja: { etiqueta: 'Cierre de caja', icono: 'i-lucide-lock' },
    ajuste: { etiqueta: 'Ajuste', icono: 'i-lucide-scale' },
    reclasificacion: { etiqueta: 'Reclasificación de IVA', icono: 'i-lucide-arrow-left-right' },
    liquidacion_cobro: { etiqueta: 'Liquidación de cobros', icono: 'i-lucide-hand-coins' },
    deposito: { etiqueta: 'Depósito de caja', icono: 'i-lucide-landmark' },
    traslado: { etiqueta: 'Traslado entre bancos', icono: 'i-lucide-arrow-right-left' },
    banco: { etiqueta: 'Partida del extracto', icono: 'i-lucide-file-spreadsheet' },
    provision: { etiqueta: 'Estimación de incobrables', icono: 'i-lucide-shield-alert' },
    castigo: { etiqueta: 'Castigo de cartera', icono: 'i-lucide-file-x' },
    diferencia_cobro: { etiqueta: 'Diferencia de cobro', icono: 'i-lucide-scissors' },
    compra: { etiqueta: 'Compra', icono: 'i-lucide-shopping-cart' },
    pago_proveedor: { etiqueta: 'Pago a proveedor', icono: 'i-lucide-hand-coins' },
    depreciacion: { etiqueta: 'Depreciación', icono: 'i-lucide-trending-down' },
    baja_activo: { etiqueta: 'Baja de activo', icono: 'i-lucide-package-x' },
    diferido: { etiqueta: 'Diferido', icono: 'i-lucide-calendar-range' },
    alta_activo: { etiqueta: 'Alta de activo', icono: 'i-lucide-package-plus' },
    lealtad: { etiqueta: 'Programa de lealtad', icono: 'i-lucide-gift' },
    sorteo: { etiqueta: 'Sorteo', icono: 'i-lucide-ticket' },
    bonificacion: { etiqueta: 'Bonificación', icono: 'i-lucide-badge-percent' },
}

interface OrigenVisual {
    etiqueta: string
    icono: string
}

/** Etiqueta e icono del origen de un asiento; uno desconocido se muestra por su nombre, sin romper la vista. */
export function origenAsiento(tipo: string): OrigenVisual {
    if (Object.hasOwn(ORIGENES_ASIENTO, tipo)) {
        return ORIGENES_ASIENTO[tipo as Origen]
    }
    const texto = tipo.replace(/_/g, ' ')
    return { etiqueta: texto.charAt(0).toUpperCase() + texto.slice(1), icono: 'i-lucide-file' }
}

export const TIPOS_CUENTA: Record<Schema<'Cuenta'>['tipo'], string> = {
    activo: 'Activo',
    pasivo: 'Pasivo',
    patrimonio: 'Patrimonio',
    ingreso: 'Ingreso',
    gasto: 'Gasto',
}

export interface TotalesPartida {
    debe: Decimal
    haber: Decimal
}

/** Suma Debe y Haber con `decimal.js` (nunca `number`). */
export function totalesPartida(movimientos: readonly { debe: string, haber: string }[]): TotalesPartida {
    return movimientos.reduce<TotalesPartida>((suma, m) => ({
        debe: suma.debe.plus(m.debe),
        haber: suma.haber.plus(m.haber),
    }), { debe: new Decimal(0), haber: new Decimal(0) })
}

/** Debe y Haber de varios asientos juntos. */
export function totalesAsientos(asientos: readonly AsientoLibro[]): TotalesPartida {
    return totalesPartida(asientos.flatMap(a => a.movimientos))
}

/** `true` si Debe = Haber (la base de datos lo exige; el panel lo avisa si llegara roto). */
export function cuadra(totales: TotalesPartida): boolean {
    return totales.debe.equals(totales.haber)
}

/** Ruta del panel del documento que originó el asiento, o `null`. */
export function rutaOrigen(asiento: Pick<AsientoLibro, 'origen_tipo' | 'origen_id'>): string | null {
    if (asiento.origen_id === null) {
        return null
    }
    // El recargo por mora es otra factura (`tipo = mora`): su asiento lleva el id de esa factura.
    if (asiento.origen_tipo === 'factura' || asiento.origen_tipo === 'mora') {
        return `/facturas/${asiento.origen_id}`
    }
    if (asiento.origen_tipo === 'pago') {
        return `/pagos/${asiento.origen_id}`
    }
    // Decisión del PM (A3): el periodo regalado o el cargo sin costo es una bonificación, no una factura.
    if (asiento.origen_tipo === 'bonificacion') {
        return `/bonificaciones/${asiento.origen_id}`
    }
    if (asiento.origen_tipo === 'nota_credito') {
        return `/notas-credito/${asiento.origen_id}`
    }
    // Fase 4 (bancos): la liquidación tiene ficha; depósitos y traslados se ven en fondos en tránsito.
    if (asiento.origen_tipo === 'liquidacion_cobro') {
        return `/cobros/liquidaciones/${asiento.origen_id}`
    }
    if (asiento.origen_tipo === 'deposito' || asiento.origen_tipo === 'traslado') {
        return '/bancos/transito'
    }
    if (asiento.origen_tipo === 'provision' || asiento.origen_tipo === 'castigo') {
        return '/cartera'
    }
    return null
}

/** Monto vacío para la columna que no aplica (un movimiento va al Debe o al Haber). */
export function montoLado(monto: string): string {
    return new Decimal(monto).isZero() ? '' : formatearQuetzales(monto)
}

/** `2026-10-15` ± `dias`, en calendario (sin zona horaria). */
export function sumarDiasFecha(fecha: string, dias: number): string {
    const resultado = new Date(`${fecha}T00:00:00Z`)
    resultado.setUTCDate(resultado.getUTCDate() + dias)
    return resultado.toISOString().slice(0, 10)
}

/** Día en Guatemala de un instante UTC (`2026-10-16T02:00:00Z` → `2026-10-15`). */
export function fechaGuatemala(instante: string): string {
    return hoyGuatemala(new Date(instante))
}
