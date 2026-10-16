import type { Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import * as z from 'zod'

type Factura = Schema<'Factura'>
type Metodo = Schema<'Pago'>['metodo']

/** Fecha de hoy en Guatemala (`2026-10-15`), para decidir qué facturas están vencidas. */
export function hoyGuatemala(ahora: Date = new Date()): string {
    // en-CA da `AAAA-MM-DD`.
    return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_HORARIA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora)
}

/** Lo que falta pagar de una factura (`total - pagado`). */
export function saldoFactura(factura: Factura): Decimal {
    return new Decimal(factura.total).minus(factura.pagado)
}

/** Vencida: la API ya la marcó, o su `vence_en` es anterior a hoy en Guatemala. */
export function facturaVencida(factura: Factura, hoy: string): boolean {
    return factura.estado === 'vencida' || factura.vence_en < hoy
}

export interface ResumenPendiente {
    /** Suma de lo que falta pagar de las facturas pendientes. */
    pendiente: Decimal
    /** Solo de las vencidas. */
    vencido: Decimal
    vencidas: number
    facturas: Factura[]
}

/** Totales del cobro sobre `facturas_pendientes` del estado de cuenta, con `decimal.js`. */
export function resumenPendiente(facturas: Factura[], hoy: string): ResumenPendiente {
    const conSaldo = facturas
        .filter(f => f.estado !== 'pagada' && f.estado !== 'anulada' && saldoFactura(f).gt(0))
        .sort((a, b) => a.periodo.localeCompare(b.periodo) || a.id - b.id)
    let pendiente = new Decimal(0)
    let vencido = new Decimal(0)
    let vencidas = 0
    for (const factura of conSaldo) {
        const saldo = saldoFactura(factura)
        pendiente = pendiente.plus(saldo)
        if (facturaVencida(factura, hoy)) {
            vencido = vencido.plus(saldo)
            vencidas++
        }
    }
    return { pendiente, vencido, vencidas, facturas: conSaldo }
}

/** Facturas marcadas por defecto al elegir cliente: las vencidas, en el orden de la pantalla. */
export function marcadasPorDefecto(resumen: ResumenPendiente, hoy: string): number[] {
    return resumen.facturas.filter(f => facturaVencida(f, hoy)).map(f => f.id)
}

/** Suma de lo que falta pagar de las facturas marcadas. */
export function sumaMarcadas(facturas: readonly Factura[], marcadas: readonly number[]): Decimal {
    return facturas.filter(f => marcadas.includes(f.id)).reduce((suma, f) => suma.plus(saldoFactura(f)), new Decimal(0))
}

export interface LineaDistribucion {
    factura: Factura
    aplicado: Decimal
    /** Recibe algo pero no queda pagada. */
    parcial: boolean
}

export interface DistribucionPago {
    /** Las marcadas, en el orden en que se mandan (`facturas[]`). */
    marcadas: LineaDistribucion[]
    /** La marcada que quedará con saldo, si el monto no alcanza. */
    parcial: LineaDistribucion | null
    /** Marcadas que no reciben nada. */
    sinCubrir: Factura[]
    /** Lo que sobra después de las marcadas. */
    excedente: Decimal
    /** Cómo se reparte el excedente en las demás facturas (la más antigua primero, como la API). */
    otras: LineaDistribucion[]
    /** Lo que queda como saldo a favor (anticipo). */
    aFavor: Decimal
}

/** Orden de `facturasPendientes` en la API: vencimiento, periodo, id. */
function ordenApi(a: Factura, b: Factura): number {
    return a.vence_en.localeCompare(b.vence_en) || a.periodo.localeCompare(b.periodo) || a.id - b.id
}

function repartir(monto: Decimal, facturas: readonly Factura[]): { lineas: LineaDistribucion[], resto: Decimal } {
    let resto = monto
    const lineas = facturas.map((factura) => {
        const saldo = saldoFactura(factura)
        const aplicado = Decimal.min(Decimal.max(resto, 0), saldo)
        resto = resto.minus(aplicado)
        return { factura, aplicado, parcial: aplicado.gt(0) && aplicado.lt(saldo) }
    })
    return { lineas, resto }
}

/**
 * Vista previa de `POST /pagos` con `facturas[]`: la API paga primero las pedidas (en ese orden),
 * luego las demás de la más antigua a la más nueva, y el excedente queda como anticipo
 * (`registrarPago` de A3). Todo con `decimal.js`.
 */
export function distribuirPago(monto: Decimal, facturas: readonly Factura[], marcadas: readonly number[]): DistribucionPago {
    const elegidas = marcadas
        .map(id => facturas.find(f => f.id === id))
        .filter((f): f is Factura => f !== undefined)
    const primera = repartir(monto, elegidas)
    const demas = facturas.filter(f => !marcadas.includes(f.id)).sort(ordenApi)
    const segunda = repartir(primera.resto, demas)
    return {
        marcadas: primera.lineas,
        parcial: primera.lineas.find(l => l.parcial) ?? null,
        sinCubrir: primera.lineas.filter(l => l.aplicado.isZero()).map(l => l.factura),
        excedente: Decimal.max(primera.resto, 0),
        otras: segunda.lineas.filter(l => l.aplicado.gt(0)),
        aFavor: Decimal.max(segunda.resto, 0),
    }
}

/** Monto sugerido: el total vencido; si no hay vencido, el pendiente; si no debe nada, vacío. */
export function montoSugerido(resumen: ResumenPendiente): string {
    if (resumen.vencido.gt(0)) {
        return resumen.vencido.toFixed(2)
    }
    return resumen.pendiente.gt(0) ? resumen.pendiente.toFixed(2) : ''
}

/**
 * Métodos que se cobran a mano, con los valores del enum del contrato (`Pago.metodo`).
 * `pasarela` no aparece: lo registra la pasarela de pago en línea, no el cajero.
 * El contrato no tiene "transferencia"; se registra como `deposito` (pedido a A3 confirmarlo).
 */
export const METODOS_COBRO: { metodo: Metodo, etiqueta: string, icono: string }[] = [
    { metodo: 'caja', etiqueta: 'Efectivo en caja', icono: 'i-lucide-banknote' },
    { metodo: 'deposito', etiqueta: 'Depósito o transferencia', icono: 'i-lucide-landmark' },
    { metodo: 'agente', etiqueta: 'Agente bancario', icono: 'i-lucide-store' },
    { metodo: 'debito', etiqueta: 'Débito / tarjeta', icono: 'i-lucide-credit-card' },
]

export const ETIQUETAS_METODO: Record<Metodo, string> = {
    caja: 'Efectivo en caja',
    deposito: 'Depósito o transferencia',
    agente: 'Agente bancario',
    debito: 'Débito / tarjeta',
    pasarela: 'Pago en línea',
    transferencia: 'Transferencia',
    ach: 'ACH',
    remesa: 'Remesa',
}

const MONTO = /^\d{1,12}(\.\d{1,2})?$/

/**
 * Espejo del validador de `POST /pagos`: monto string con hasta 2 decimales y mayor que cero;
 * `caja_id` opcional (con `caja` y sin caja, la API usa la caja principal); referencia hasta
 * 100 y obligatoria salvo en efectivo (regla del panel: sin referencia no se puede conciliar un
 * depósito); nota hasta 500.
 */
export const esquemaCobro = z.object({
    monto: z.string()
        .trim()
        .regex(MONTO, 'Escribe un monto con hasta 2 decimales, sin comas (ej. 175.00)')
        .refine(valor => !MONTO.test(valor) || new Decimal(valor).gt(0), 'El monto debe ser mayor que cero'),
    metodo: z.enum(['caja', 'deposito', 'agente', 'debito']),
    caja_id: z.number().int().positive().nullable(),
    referencia: z.string().trim().max(100, 'Máximo 100 caracteres'),
    nota: z.string().trim().max(500, 'Máximo 500 caracteres'),
}).superRefine((datos, ctx) => {
    if (datos.metodo !== 'caja' && !datos.referencia) {
        ctx.addIssue({ code: 'custom', path: ['referencia'], message: 'La referencia es obligatoria salvo en efectivo' })
    }
})

export type EntradaCobro = z.input<typeof esquemaCobro>
export type SalidaCobro = z.output<typeof esquemaCobro>
