import type { Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import * as z from 'zod'

type PagoCaja = Schema<'Pago'>
type EgresoCaja = Pick<Schema<'Egreso'>, 'metodo' | 'estado' | 'turno_id' | 'monto'>

/** Billetes y monedas de quetzal, de mayor a menor (en string para no usar `number` con dinero). */
export const DENOMINACIONES: { valor: string, etiqueta: string, tipo: 'billete' | 'moneda' }[] = [
    { valor: '200', etiqueta: 'Q 200', tipo: 'billete' },
    { valor: '100', etiqueta: 'Q 100', tipo: 'billete' },
    { valor: '50', etiqueta: 'Q 50', tipo: 'billete' },
    { valor: '20', etiqueta: 'Q 20', tipo: 'billete' },
    { valor: '10', etiqueta: 'Q 10', tipo: 'billete' },
    { valor: '5', etiqueta: 'Q 5', tipo: 'billete' },
    { valor: '1', etiqueta: 'Q 1', tipo: 'moneda' },
    { valor: '0.50', etiqueta: '50 ¢', tipo: 'moneda' },
    { valor: '0.25', etiqueta: '25 ¢', tipo: 'moneda' },
    { valor: '0.10', etiqueta: '10 ¢', tipo: 'moneda' },
    { valor: '0.05', etiqueta: '5 ¢', tipo: 'moneda' },
    { valor: '0.01', etiqueta: '1 ¢', tipo: 'moneda' },
]

/** Total contado a partir de cantidades por denominación (`{ '200': 3, '0.25': 4 }`). */
export function totalDenominaciones(cantidades: Record<string, number | null | undefined>): Decimal {
    return DENOMINACIONES.reduce((suma, d) => {
        const cantidad = cantidades[d.valor]
        return Number.isInteger(cantidad) && (cantidad ?? 0) > 0 ? suma.plus(new Decimal(d.valor).times(cantidad ?? 0)) : suma
    }, new Decimal(0))
}

/** Cobros que entran al efectivo de la caja: método `caja` y no anulados. */
export function cobrosEnEfectivo(pagos: readonly PagoCaja[]): PagoCaja[] {
    return pagos.filter(p => p.metodo === 'caja' && p.estado !== 'anulado')
}

/** Egresos que salieron del efectivo de este turno: método `caja`, del turno y no anulados. */
export function egresosEnEfectivo<T extends EgresoCaja>(egresos: readonly T[], turnoId: number): T[] {
    return egresos.filter(e => e.metodo === 'caja' && e.turno_id === turnoId && e.estado === 'registrado')
}

/**
 * Esperado provisional, con la misma regla que `CerrarCaja` (A3): fondo inicial + cobros en
 * efectivo del turno − egresos en efectivo del turno. Solo se calcula con los dos datos leídos;
 * la API calcula el oficial al cerrar.
 */
export function esperadoProvisional(fondoInicial: string, pagos: readonly PagoCaja[], egresos: readonly EgresoCaja[], turnoId: number): Decimal {
    const cobrado = cobrosEnEfectivo(pagos).reduce((suma, p) => suma.plus(p.monto), new Decimal(fondoInicial))
    return egresosEnEfectivo(egresos, turnoId).reduce((suma, e) => suma.minus(e.monto), cobrado)
}

/** Color de una diferencia de arqueo: exacto verde, faltante rojo, sobrante ámbar. */
export function colorDiferencia(diferencia: string | Decimal | null): 'success' | 'error' | 'warning' | 'neutral' {
    if (diferencia === null) {
        return 'neutral'
    }
    const valor = new Decimal(diferencia)
    if (valor.isZero()) {
        return 'success'
    }
    return valor.isNegative() ? 'error' : 'warning'
}

/** Icono de la diferencia del arqueo: cuadra, faltante o sobrante (siempre junto al texto). */
export function iconoDiferencia(diferencia: string | Decimal | null): string {
    if (diferencia === null) {
        return 'i-lucide-circle-help'
    }
    const valor = new Decimal(diferencia)
    if (valor.isZero()) {
        return 'i-lucide-circle-check'
    }
    return valor.isNegative() ? 'i-lucide-circle-minus' : 'i-lucide-circle-plus'
}

export function etiquetaDiferencia(diferencia: string | Decimal): string {
    const valor = new Decimal(diferencia)
    if (valor.isZero()) {
        return 'Cuadra'
    }
    return valor.isNegative() ? `Faltante ${formatearQuetzales(valor.abs())}` : `Sobrante ${formatearQuetzales(valor)}`
}

const MONTO = /^\d{1,12}(\.\d{1,2})?$/

/** Espejo de `abrirCajaValidator`: `fondo_inicial` string con hasta 2 decimales. */
export const esquemaApertura = z.object({
    fondo_inicial: z.string().trim().regex(MONTO, 'Escribe un monto con hasta 2 decimales, sin comas (ej. 500.00)'),
})

export type DatosApertura = z.output<typeof esquemaApertura>

/**
 * Espejo de `cerrarCajaValidator`: `contado` con hasta 2 decimales y `motivo` de 3 a 500. El
 * motivo es obligatorio si hay diferencia; `esperado` es el provisional del panel (`null` si no
 * se pudo calcular: entonces la API decide y responde 422 si falta).
 */
export function esquemaCierre(esperado: Decimal | null) {
    return z.object({
        contado: z.string().trim().regex(MONTO, 'Escribe un monto con hasta 2 decimales, sin comas (ej. 1450.00)'),
        motivo: z.string().trim().max(500, 'Máximo 500 caracteres'),
    }).superRefine((datos, ctx) => {
        if (datos.motivo && datos.motivo.length < 3) {
            ctx.addIssue({ code: 'custom', path: ['motivo'], message: 'Al menos 3 caracteres' })
        }
        if (esperado && MONTO.test(datos.contado) && !new Decimal(datos.contado).equals(esperado) && !datos.motivo) {
            ctx.addIssue({ code: 'custom', path: ['motivo'], message: 'Hay diferencia: explica el motivo' })
        }
    })
}

export type DatosCierreFormulario = z.output<ReturnType<typeof esquemaCierre>>
