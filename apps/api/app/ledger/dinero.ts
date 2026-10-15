import DecimalJs from 'decimal.js'
import type { Decimal as ClaseDecimal } from 'decimal.js'

/**
 * decimal.js publica un único `.d.ts` con forma CommonJS; en ESM (NodeNext) el default import
 * se tipa como el módulo y no como la clase, aunque en tiempo de ejecución sí es la clase.
 */
const Decimal = DecimalJs as unknown as typeof ClaseDecimal
type Decimal = ClaseDecimal

/**
 * Dinero con decimal.js. Nunca `number`.
 *
 * Regla del módulo: se calcula con precisión completa y se redondea a 2 decimales **al final** de
 * cada cálculo (`redondear`), no en cada línea intermedia. En JSON y en la base de datos el dinero
 * viaja como string con 2 decimales (`aTexto`).
 */

/** Precisión amplia para cálculos intermedios (IVA, prorrateos). */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP })
export type Dec = InstanceType<typeof D>

/** Lo que se acepta como monto de entrada: string decimal o Decimal (nunca number). */
export type Monto = string | Decimal | Dec

export const CERO: Dec = new D(0)

export function dec(valor: Monto | null | undefined): Dec {
    if (valor === null || valor === undefined || valor === '') return CERO
    return new D(valor.toString())
}

/** Redondeo final a centavos (half-up, como la SAT). */
export function redondear(valor: Monto): Dec {
    return dec(valor).toDecimalPlaces(2, D.ROUND_HALF_UP)
}

/** String con exactamente 2 decimales: "150.00". */
export function aTexto(valor: Monto): string {
    return redondear(valor).toFixed(2)
}

/** true si el monto no tiene más de 2 decimales. */
export function tieneCentavosExactos(valor: Monto): boolean {
    return dec(valor).decimalPlaces() <= 2
}

export function sumar(valores: Iterable<Monto>): Dec {
    let total: Dec = CERO
    for (const valor of valores) total = total.plus(dec(valor))
    return total
}
