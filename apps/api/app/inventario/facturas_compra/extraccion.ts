import vine from '@vinejs/vine'
import { dec, redondear } from '#ledger/dinero'

/**
 * Esquema común de lo que se lee de una factura de compra (fase D, `contratos/inventario.md` D.5): lo
 * devuelven el parser determinístico del XML FEL y la IA (que además da su confianza por campo), y lo
 * corrige el usuario en el borrador. Montos como texto con 2 decimales y cantidades con hasta 3.
 */

export const TIPOS_DTE_COMPRA = ['FACT', 'FCAM', 'FPEQ', 'FCAP', 'FESP', 'NCRE', 'NDEB', 'RECIBO'] as const

export interface LineaExtraida {
    /** código del proveedor (si la factura lo trae) */
    codigo: string | null
    descripcion: string
    cantidad: string
    unidad: string | null
    precio_unitario: string
    descuento: string
    /** total de la línea con el IVA incluido (precio × cantidad − descuento) */
    total: string
    iva: string
    /** B = bien, S = servicio */
    bien_o_servicio: 'B' | 'S'
}

export interface ExtraccionCompra {
    emisor: { nit: string; nombre: string }
    receptor: { nit: string | null; nombre: string | null }
    tipo_documento: string
    serie: string | null
    numero: string
    autorizacion: string | null
    fecha: string
    moneda: string
    lineas: LineaExtraida[]
    totales: { total: string; iva: string }
}

/** Confianza (0 a 1) por campo y por línea, como la devuelve la IA. */
export type Confianza = Record<string, number | Record<string, number>[] | Record<string, number>>

const monto = () =>
    vine
        .string()
        .trim()
        .regex(/^-?\d{1,12}(\.\d{1,2})?$/)
const cantidad = () =>
    vine
        .string()
        .trim()
        .regex(/^\d{1,11}(\.\d{1,6})?$/)

export const reglasExtraccion = {
    emisor: vine.object({
        nit: vine.string().trim().minLength(1).maxLength(30),
        nombre: vine.string().trim().minLength(1).maxLength(300),
    }),
    receptor: vine.object({
        nit: vine.string().trim().maxLength(30).nullable(),
        nombre: vine.string().trim().maxLength(300).nullable(),
    }),
    tipo_documento: vine.string().trim().toUpperCase().maxLength(10),
    serie: vine.string().trim().maxLength(40).nullable(),
    numero: vine.string().trim().minLength(1).maxLength(60),
    autorizacion: vine.string().trim().maxLength(100).nullable(),
    fecha: vine
        .string()
        .trim()
        .regex(/^\d{4}-\d{2}-\d{2}$/),
    moneda: vine.string().trim().toUpperCase().fixedLength(3),
    lineas: vine
        .array(
            vine.object({
                codigo: vine.string().trim().maxLength(100).nullable(),
                descripcion: vine.string().trim().minLength(1).maxLength(500),
                cantidad: cantidad(),
                unidad: vine.string().trim().maxLength(30).nullable(),
                precio_unitario: monto(),
                descuento: monto(),
                total: monto(),
                iva: monto(),
                bien_o_servicio: vine.enum(['B', 'S'] as const),
            }),
        )
        .minLength(1)
        .maxLength(500),
    totales: vine.object({ total: monto(), iva: monto() }),
}

/** Valida una extracción (la de la IA o la corregida por el usuario): 422 con los campos. */
export const extraccionValidator = vine.compile(vine.object(reglasExtraccion))

/** Monto como texto con 2 decimales (decimal.js; 0.00 si no es un número). */
export function aMonto(valor: string | null | undefined): string {
    try {
        return redondear(dec((valor ?? '0').trim() || '0')).toFixed(2)
    } catch {
        return '0.00'
    }
}

/** Cantidad como texto con hasta 6 decimales, sin ceros de más. */
export function aCantidadTexto(valor: string | null | undefined): string {
    try {
        return dec((valor ?? '0').trim() || '0')
            .toDecimalPlaces(6)
            .toString()
    } catch {
        return '0'
    }
}
