import type { Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import { z } from 'zod'

/**
 * Cartera (A3, fase 4 §10.9): estimación de incobrables y castigo. Las dos acciones mueven el libro
 * y no se deshacen desde el panel, así que piden confirmación escrita (la frase exacta).
 */

type FacturaApi = Schema<'Factura'>

/** Frase que hay que escribir para provisionar un año. */
export function fraseProvision(anio: number): string {
    return `PROVISIONAR ${anio}`
}

/** Frase que hay que escribir para castigar. */
export const FRASE_CASTIGO = 'CASTIGAR'

/** Igual sin importar mayúsculas ni espacios de más. */
export function confirmacionValida(escrito: string, frase: string): boolean {
    return escrito.trim().replace(/\s+/g, ' ').toUpperCase() === frase
}

/** Espejo de `provisionarCarteraValidator`: año 2000 a 2100, corte opcional, y la frase. */
export function esquemaProvision(hoy: string) {
    return z.object({
        anio: z.number({ message: 'Elige el año' }).int().min(2000).max(2100),
        fecha: z.string()
            .trim()
            .refine(valor => valor === '' || /^\d{4}-\d{2}-\d{2}$/.test(valor), 'Elige una fecha válida (día, mes y año)')
            .refine(valor => valor === '' || valor <= hoy, 'El corte no puede ser futuro'),
        confirmacion: z.string(),
    }).superRefine((datos, ctx) => {
        if (!confirmacionValida(datos.confirmacion, fraseProvision(datos.anio))) {
            ctx.addIssue({ code: 'custom', path: ['confirmacion'], message: `Escribe ${fraseProvision(datos.anio)} para confirmar` })
        }
        if (datos.fecha && Number(datos.fecha.slice(0, 4)) !== datos.anio) {
            ctx.addIssue({ code: 'custom', path: ['fecha'], message: 'El corte debe ser del año que se provisiona' })
        }
    })
}

export type EntradaProvision = z.input<ReturnType<typeof esquemaProvision>>

/**
 * Espejo de `castigarCarteraValidator` y `CastigarCartera`: al menos una factura, motivo y
 * evidencia de la gestión de cobro (LAT art. 21.20) de 3 caracteres o más (la API responde 422
 * `castigo_sin_evidencia`), y la frase.
 */
export const esquemaCastigo = z.object({
    facturas: z.array(z.number().int().positive()).min(1, 'Elige al menos una factura'),
    motivo: z.string().trim().min(3, 'Escribe el motivo (al menos 3 caracteres)').max(500, 'Máximo 500 caracteres'),
    evidencia: z.string().trim().min(3, 'Describe la gestión de cobro (llamadas, cartas, avisos)').max(4000, 'Máximo 4000 caracteres'),
    confirmacion: z.string().refine(valor => confirmacionValida(valor, FRASE_CASTIGO), `Escribe ${FRASE_CASTIGO} para confirmar`),
})

export type EntradaCastigo = z.input<typeof esquemaCastigo>

/** Facturas que se pueden castigar: con saldo y en un estado que todavía se debe. */
export function facturasCastigables<T extends Pick<FacturaApi, 'estado' | 'total' | 'pagado'>>(facturas: readonly T[]): T[] {
    // Saldo = total − pagado (`pagado` ya incluye lo acreditado con notas de crédito).
    return facturas.filter(f => ['emitida', 'parcial', 'vencida'].includes(f.estado) && new Decimal(f.total).gt(f.pagado))
}
