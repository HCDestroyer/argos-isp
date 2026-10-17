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
 * Vista previa de `POST /pagos` con `facturas[]`: la API paga primero las pedidas (en ese orden,
 * de cualquier cliente: pago de terceros), luego las demás **del pagador** de la más antigua a la
 * más nueva, y el excedente queda como anticipo del pagador (`registrarPago` de A3). `propias`
 * son las facturas del pagador; sin ella, se usan todas. Todo con `decimal.js`.
 */
export function distribuirPago(monto: Decimal, facturas: readonly Factura[], marcadas: readonly number[], propias: readonly Factura[] = facturas): DistribucionPago {
    const elegidas = marcadas
        .map(id => facturas.find(f => f.id === id))
        .filter((f): f is Factura => f !== undefined)
    const primera = repartir(monto, elegidas)
    const demas = propias.filter(f => !marcadas.includes(f.id)).sort(ordenApi)
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

/** Métodos que registra el cajero (todos los del enum salvo `pasarela`, que llega por la pasarela). */
export type MetodoCobro = Exclude<Metodo, 'pasarela'>

export interface OpcionMetodo {
    metodo: MetodoCobro
    etiqueta: string
    icono: string
}

/** Métodos del cobro, con los valores del enum del contrato (`Pago.metodo`). */
export const METODOS_COBRO: OpcionMetodo[] = [
    { metodo: 'caja', etiqueta: 'Efectivo en caja', icono: 'i-lucide-banknote' },
    { metodo: 'deposito', etiqueta: 'Depósito bancario', icono: 'i-lucide-landmark' },
    { metodo: 'transferencia', etiqueta: 'Transferencia', icono: 'i-lucide-arrow-right-left' },
    { metodo: 'ach', etiqueta: 'ACH', icono: 'i-lucide-building-2' },
    { metodo: 'remesa', etiqueta: 'Remesa', icono: 'i-lucide-send' },
    { metodo: 'agente', etiqueta: 'Agente bancario', icono: 'i-lucide-store' },
    { metodo: 'debito', etiqueta: 'Débito / tarjeta', icono: 'i-lucide-credit-card' },
]

export const ETIQUETAS_METODO: Record<Metodo, string> = {
    caja: 'Efectivo en caja',
    deposito: 'Depósito bancario',
    transferencia: 'Transferencia',
    ach: 'ACH',
    remesa: 'Remesa',
    agente: 'Agente bancario',
    debito: 'Débito / tarjeta',
    pasarela: 'Pago en línea',
}

type DatoBancario = 'referencia' | 'cuenta_bancaria_id' | 'banco_origen_id'

/**
 * Datos obligatorios por método, igual que `DATOS_POR_METODO` de `registrarPago` (A3). Con otro
 * método, `cuenta_bancaria_id` y `banco_origen_id` no se mandan (la API responde `no_aplica`).
 */
export const DATOS_POR_METODO: Record<MetodoCobro, readonly DatoBancario[]> = {
    caja: [],
    deposito: ['cuenta_bancaria_id', 'referencia'],
    transferencia: ['banco_origen_id', 'cuenta_bancaria_id', 'referencia'],
    ach: ['banco_origen_id', 'cuenta_bancaria_id', 'referencia'],
    remesa: ['cuenta_bancaria_id', 'referencia'],
    agente: [],
    debito: [],
}

export function pideDato(metodo: MetodoCobro, dato: DatoBancario): boolean {
    return DATOS_POR_METODO[metodo].includes(dato)
}

/** Cómo se llama la referencia en cada método (boleta, código de remesa, autorización…). */
export function etiquetaReferencia(metodo: Metodo): string {
    switch (metodo) {
        case 'deposito':
            return 'Número de boleta'
        case 'transferencia':
            return 'Referencia de la transferencia'
        case 'ach':
            return 'Referencia ACH'
        case 'remesa':
            return 'Código de la remesa'
        case 'debito':
            return 'Autorización'
        default:
            return 'Referencia'
    }
}

/** El código de un problema (`urn:argosisp:problema:<codigo>`) o `null`. */
export function codigoProblema(problema: { type: string }): string | null {
    const prefijo = 'urn:argosisp:problema:'
    return problema.type.startsWith(prefijo) ? problema.type.slice(prefijo.length) : null
}

/**
 * La empresa sin caja abierta de un 422 `caja_no_abierta` (A3: `errors[0].field = 'empresa_id'`,
 * `rule` = su id). `null` si el problema es otro.
 */
export function empresaSinCaja(problema: { status: number, type: string, errors?: { field: string, rule?: string }[] }): number | null {
    if (problema.status !== 422 || codigoProblema(problema) !== 'caja_no_abierta') {
        return null
    }
    const id = Number(problema.errors?.find(e => e.field === 'empresa_id')?.rule)
    return Number.isInteger(id) && id > 0 ? id : null
}

/** Una referencia ya registrada (409 `referencia_duplicada`, única por método y cuenta). */
export function esReferenciaDuplicada(problema: { status: number, type: string }): boolean {
    return problema.status === 409 && problema.type.endsWith(':referencia_duplicada')
}

const MONTO = /^\d{1,12}(\.\d{1,2})?$/

/**
 * Espejo del validador de `POST /pagos` y de `registrarPago`: monto string con hasta 2 decimales
 * y mayor que cero; `caja_id` opcional (sin caja, la del turno abierto o la principal);
 * referencia hasta 100; nota hasta 500; y por método los datos de `DATOS_POR_METODO`
 * (transferencia y ACH: banco de origen, cuenta de destino y referencia; remesa: cuenta y
 * código; depósito: cuenta y boleta). La cuenta debe ser activa y en GTQ (el selector solo
 * ofrece esas).
 */
export const esquemaCobro = z.object({
    monto: z.string()
        .trim()
        .regex(MONTO, 'Escribe un monto con hasta 2 decimales, sin comas (ej. 175.00)')
        .refine(valor => !MONTO.test(valor) || new Decimal(valor).gt(0), 'El monto debe ser mayor que cero'),
    metodo: z.enum(['caja', 'deposito', 'transferencia', 'ach', 'remesa', 'agente', 'debito']),
    caja_id: z.number().int().positive().nullable(),
    cuenta_bancaria_id: z.number().int().positive().nullable(),
    banco_origen_id: z.number().int().positive().nullable(),
    referencia: z.string().trim().max(100, 'Máximo 100 caracteres'),
    nota: z.string().trim().max(500, 'Máximo 500 caracteres'),
}).superRefine((datos, ctx) => {
    if (pideDato(datos.metodo, 'banco_origen_id') && datos.banco_origen_id === null) {
        ctx.addIssue({ code: 'custom', path: ['banco_origen_id'], message: 'Elige el banco de origen' })
    }
    if (pideDato(datos.metodo, 'cuenta_bancaria_id') && datos.cuenta_bancaria_id === null) {
        ctx.addIssue({ code: 'custom', path: ['cuenta_bancaria_id'], message: 'Elige la cuenta de destino' })
    }
    if (pideDato(datos.metodo, 'referencia') && !datos.referencia) {
        ctx.addIssue({ code: 'custom', path: ['referencia'], message: `${etiquetaReferencia(datos.metodo)}: obligatorio con este método` })
    }
})

export type EntradaCobro = z.input<typeof esquemaCobro>
export type SalidaCobro = z.output<typeof esquemaCobro>

/** Datos bancarios del cuerpo de `POST /pagos`: solo los que pide el método. */
export function datosBancarios(datos: SalidaCobro): { cuenta_bancaria_id?: number | null, banco_origen_id?: number | null, caja_id?: number | null } {
    return {
        ...(datos.metodo === 'caja' ? { caja_id: datos.caja_id } : {}),
        ...(pideDato(datos.metodo, 'cuenta_bancaria_id') ? { cuenta_bancaria_id: datos.cuenta_bancaria_id } : {}),
        ...(pideDato(datos.metodo, 'banco_origen_id') ? { banco_origen_id: datos.banco_origen_id } : {}),
    }
}
