import type { Schema, paths } from '@argosisp/contracts'
import type { BadgeProps } from '@nuxt/ui'
import Decimal from 'decimal.js'
import { z } from 'zod'

/**
 * Bonificaciones (A3, decisión del PM): lo que antes era una factura de Q0. Un periodo regalado
 * (mes gratis o descuento del 100 % de lealtad) o un cargo único sin costo no es una factura: queda
 * como bonificación con su motivo, su valor bruto y un asiento interno 5.1.01 / ingreso (sin CxC,
 * IVA ni DTE). Etiquetas, el periodo legible y el esquema del cargo único (`POST /facturas/cargo-unico`).
 */

type Bonificacion = Schema<'Bonificacion'>
type CuerpoCargoUnico = paths['/api/v1/facturas/cargo-unico']['post']['requestBody']['content']['application/json']
type Color = NonNullable<BadgeProps['color']>

export type OrigenBonificacion = Bonificacion['origen']

export const ORIGENES_BONIFICACION: Record<OrigenBonificacion, { etiqueta: string, icono: string, color: Color }> = {
    mes_gratis: { etiqueta: 'Mes gratis', icono: 'i-lucide-calendar-heart', color: 'success' },
    descuento_100: { etiqueta: 'Descuento del 100 %', icono: 'i-lucide-badge-percent', color: 'info' },
    canje: { etiqueta: 'Canje de lealtad', icono: 'i-lucide-gem', color: 'primary' },
    cargo_sin_costo: { etiqueta: 'Cargo sin costo', icono: 'i-lucide-hand-heart', color: 'warning' },
}

/** Solo las etiquetas, para los selectores de filtros. */
export const ETIQUETAS_ORIGEN_BONIFICACION: Record<OrigenBonificacion, string> = {
    mes_gratis: ORIGENES_BONIFICACION.mes_gratis.etiqueta,
    descuento_100: ORIGENES_BONIFICACION.descuento_100.etiqueta,
    canje: ORIGENES_BONIFICACION.canje.etiqueta,
    cargo_sin_costo: ORIGENES_BONIFICACION.cargo_sin_costo.etiqueta,
}

/** Un origen que la API agregue después se muestra por su nombre. */
export function origenBonificacionVisual(origen: string): { etiqueta: string, icono: string, color: Color } {
    if (Object.hasOwn(ORIGENES_BONIFICACION, origen)) {
        return ORIGENES_BONIFICACION[origen as OrigenBonificacion]
    }
    const texto = origen.replace(/_/g, ' ')
    return { etiqueta: texto.charAt(0).toUpperCase() + texto.slice(1), icono: 'i-lucide-badge-percent', color: 'neutral' }
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/**
 * Periodo de la bonificación: el mes del servicio («octubre 2026») si ocupa un periodo
 * (`clave_unica` = `servicio-periodo`); un cargo sin costo (`cargo-…`) no ocupa periodo y se muestra
 * con su fecha.
 */
export function periodoBonificacion(b: Pick<Bonificacion, 'periodo' | 'clave_unica'>): string {
    const [anio, mes, dia] = b.periodo.slice(0, 10).split('-')
    if (b.clave_unica.startsWith('cargo-')) {
        return `${dia}/${mes}/${anio}`
    }
    const nombre = MESES[Number(mes) - 1]
    return nombre ? `${nombre} ${anio}` : b.periodo
}

/** Si la bonificación ocupa un periodo del servicio (el cron no lo vuelve a facturar). */
export function ocupaPeriodo(b: Pick<Bonificacion, 'clave_unica'>): boolean {
    return !b.clave_unica.startsWith('cargo-')
}

/* Cargo único (`POST /facturas/cargo-unico`). */

const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const CANTIDAD = /^\d{1,6}(\.\d{1,4})?$/

const esquemaLineaCargo = z.object({
    concepto_id: z.number().int().positive().nullable().refine(v => v !== null, 'Elija el concepto'),
    descripcion: z.string().trim().max(200, 'Hasta 200 caracteres'),
    cantidad: z.string().trim().regex(CANTIDAD, 'Cantidad con hasta 4 decimales').refine(v => !CANTIDAD.test(v) || new Decimal(v).gt(0), 'Mayor que 0'),
    precio_unitario: z.string().trim().regex(MONTO, 'Precio con IVA, hasta 2 decimales, sin comas').refine(v => !MONTO.test(v) || new Decimal(v).gt(0), 'Mayor que 0 (lo regalado va como descuento)'),
    descuento: z.string().trim().refine(v => v === '' || MONTO.test(v), 'Monto con hasta 2 decimales'),
    descuento_concepto: z.string().trim().max(200, 'Hasta 200 caracteres'),
    /** Venta de inventario (A3, fase C): producto y bodega de donde sale; por serie, el equipo. */
    producto_id: z.number().int().positive().nullable().default(null),
    bodega_id: z.number().int().positive().nullable().default(null),
    unidad_id: z.number().int().positive().nullable().default(null),
    seguimiento: z.enum(['cantidad', 'serie']).nullable().default(null),
}).superRefine((l, ctx) => {
    if (l.producto_id !== null && l.bodega_id === null) {
        ctx.addIssue({ code: 'custom', path: ['bodega_id'], message: 'Elija la bodega de donde sale' })
    }
    if (l.producto_id !== null && l.seguimiento === 'serie' && l.unidad_id === null) {
        ctx.addIssue({ code: 'custom', path: ['unidad_id'], message: 'Elija el equipo que se vende' })
    }
})

/** Bruto de una línea (cantidad × precio, a centavos) y su neto tras el descuento. */
export function totalesLineaCargo(linea: { cantidad: string, precio_unitario: string, descuento: string }): { bruto: Decimal, descuento: Decimal, neto: Decimal } | null {
    if (!CANTIDAD.test(linea.cantidad.trim()) || !MONTO.test(linea.precio_unitario.trim()) || (linea.descuento.trim() !== '' && !MONTO.test(linea.descuento.trim()))) {
        return null
    }
    const bruto = new Decimal(linea.cantidad).times(linea.precio_unitario).toDecimalPlaces(2)
    const descuento = linea.descuento.trim() ? new Decimal(linea.descuento) : new Decimal(0)
    return { bruto, descuento, neto: bruto.minus(descuento) }
}

/** Total del cargo (neto de descuentos), o `null` si alguna línea aún no es válida. */
export function totalCargoUnico(lineas: readonly { cantidad: string, precio_unitario: string, descuento: string }[]): Decimal | null {
    let total = new Decimal(0)
    for (const linea of lineas) {
        const t = totalesLineaCargo(linea)
        if (!t) {
            return null
        }
        total = total.plus(t.neto)
    }
    return total
}

export const esquemaCargoUnico = z.object({
    vence_en: z.string().trim().refine(v => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Fecha inválida'),
    lineas: z.array(esquemaLineaCargo).min(1, 'Al menos una línea').max(50, 'Hasta 50 líneas'),
    motivo_sin_costo_id: z.number().int().positive().nullable(),
    motivo_sin_costo_texto: z.string().trim().max(500, 'Hasta 500 caracteres'),
}).superRefine((d, ctx) => {
    d.lineas.forEach((linea, i) => {
        const t = totalesLineaCargo(linea)
        if (t?.descuento.gt(0) && !linea.descuento_concepto) {
            ctx.addIssue({ code: 'custom', path: ['lineas', i, 'descuento_concepto'], message: 'Diga por qué se descuenta' })
        }
        if (t && t.descuento.gt(t.bruto)) {
            ctx.addIssue({ code: 'custom', path: ['lineas', i, 'descuento'], message: 'El descuento no puede pasar del bruto de la línea' })
        }
    })
    const total = totalCargoUnico(d.lineas)
    if (total?.isZero()) {
        if (d.motivo_sin_costo_id === null) {
            ctx.addIssue({ code: 'custom', path: ['motivo_sin_costo_id'], message: 'Con total Q 0.00 elija el motivo' })
        }
        if (!d.motivo_sin_costo_texto) {
            ctx.addIssue({ code: 'custom', path: ['motivo_sin_costo_texto'], message: 'Explique por qué no se cobra' })
        }
    }
})

export type EntradaCargoUnico = z.input<typeof esquemaCargoUnico>
export type EntradaLineaCargo = EntradaCargoUnico['lineas'][number]

export function lineaCargoVacia(): EntradaLineaCargo {
    return { concepto_id: null, descripcion: '', cantidad: '1', precio_unitario: '', descuento: '', descuento_concepto: '', producto_id: null, bodega_id: null, unidad_id: null, seguimiento: null }
}

export function entradaCargoUnicoVacia(): EntradaCargoUnico {
    return { vence_en: '', lineas: [lineaCargoVacia()], motivo_sin_costo_id: null, motivo_sin_costo_texto: '' }
}

/** Cuerpo de `POST /facturas/cargo-unico` para un servicio o un cliente; el motivo solo con total Q0. */
export function cuerpoCargoUnico(destino: { servicio_id: number } | { cliente_id: number, empresa_id: number | null }, datos: z.output<typeof esquemaCargoUnico>): CuerpoCargoUnico {
    const total = totalCargoUnico(datos.lineas)
    const sinCosto = total?.isZero() ?? false
    return {
        ...('servicio_id' in destino ? { servicio_id: destino.servicio_id } : { cliente_id: destino.cliente_id, empresa_id: destino.empresa_id }),
        vence_en: datos.vence_en || null,
        lineas: datos.lineas.map((l) => {
            const descuento = l.descuento ? new Decimal(l.descuento) : null
            return {
                concepto_id: l.concepto_id ?? 0,
                descripcion: l.descripcion || null,
                cantidad: new Decimal(l.cantidad).toString(),
                precio_unitario: new Decimal(l.precio_unitario).toFixed(2),
                ...(descuento?.gt(0) ? { descuentos: [{ concepto: l.descuento_concepto, monto: descuento.toFixed(2) }] } : {}),
                ...(l.producto_id !== null ? { producto_id: l.producto_id, bodega_id: l.bodega_id, ...(l.seguimiento === 'serie' ? { unidad_id: l.unidad_id } : {}) } : {}),
            }
        }),
        motivo_sin_costo_id: sinCosto ? datos.motivo_sin_costo_id : null,
        motivo_sin_costo_texto: sinCosto ? datos.motivo_sin_costo_texto || null : null,
    }
}
