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
    lealtad: { etiqueta: 'Programa de lealtad', icono: 'i-lucide-gift' },
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
    if (asiento.origen_tipo === 'nota_credito') {
        return `/notas-credito/${asiento.origen_id}`
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
