import type { Schema, paths } from '@argosisp/contracts'
import type { BadgeProps } from '@nuxt/ui'
import Decimal from 'decimal.js'
import { z } from 'zod'

type Egreso = Schema<'Egreso'>
export type MetodoEgreso = Egreso['metodo']
export type CategoriaEgreso = Egreso['categoria']
export type EstadoEgreso = Egreso['estado']
export type CuerpoEgreso = paths['/api/v1/egresos']['post']['requestBody']['content']['application/json']

export const METODOS_EGRESO: Record<MetodoEgreso, string> = {
    caja: 'Efectivo de caja',
    banco: 'Banco',
    cuenta_bancaria: 'Cuenta bancaria propia',
}

/** Nombres de respaldo; la pantalla usa los de `GET /egresos/categorias` cuando los tiene. */
export const CATEGORIAS_EGRESO: Record<CategoriaEgreso, string> = {
    energia: 'Energía',
    transito: 'Tránsito de internet',
    nomina: 'Nómina',
    vehiculos: 'Vehículos',
    alquileres: 'Alquileres',
    otros: 'Otros',
}

export const ESTADOS_EGRESO: Record<EstadoEgreso, { etiqueta: string, color: NonNullable<BadgeProps['color']>, icono: string }> = {
    registrado: { etiqueta: 'Registrado', color: 'success', icono: 'i-lucide-circle-check' },
    anulado: { etiqueta: 'Anulado', color: 'neutral', icono: 'i-lucide-ban' },
}

/** De dónde salió el dinero, en una línea: `Caja principal`, `Banrural · Monetaria`. */
export function origenEgreso(egreso: Pick<Egreso, 'metodo' | 'caja_nombre' | 'banco_nombre' | 'cuenta_bancaria_nombre'>): string {
    const nombre = egreso.metodo === 'caja'
        ? egreso.caja_nombre
        : egreso.metodo === 'banco' ? egreso.banco_nombre : egreso.cuenta_bancaria_nombre
    return nombre ? `${METODOS_EGRESO[egreso.metodo]} · ${nombre}` : METODOS_EGRESO[egreso.metodo]
}

const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const FECHA = /^\d{4}-\d{2}-\d{2}$/

/**
 * Espejo de `registrarEgresoValidator` y de `RegistrarEgreso`: monto string > 0 con hasta 2
 * decimales; fecha opcional y no futura (día de Guatemala); la caja es obligatoria con `caja` y
 * la cuenta con `cuenta_bancaria`; con `banco` se elige uno de `GET /libro/bancos` (vacío: el
 * banco principal, como la API sin `banco_id`). Proveedor
 * hasta 150, descripción hasta 500 y comprobante hasta 100.
 */
export function esquemaEgreso(hoy: string) {
    return z.object({
        categoria: z.enum(['energia', 'transito', 'nomina', 'vehiculos', 'alquileres', 'otros'], { message: 'Elige la categoría' }),
        monto: z.string()
            .trim()
            .regex(MONTO, 'Escribe un monto con hasta 2 decimales, sin comas (ej. 150.00)')
            .refine(valor => !MONTO.test(valor) || new Decimal(valor).gt(0), 'El monto debe ser mayor que cero'),
        metodo: z.enum(['caja', 'banco', 'cuenta_bancaria']),
        fecha: z.string()
            .trim()
            .refine(valor => valor === '' || FECHA.test(valor), 'Fecha inválida')
            .refine(valor => valor === '' || valor <= hoy, 'La fecha del egreso no puede ser futura'),
        caja_id: z.number().int().positive().nullable(),
        banco_id: z.number().int().positive().nullable(),
        cuenta_bancaria_id: z.number().int().positive().nullable(),
        proveedor: z.string().trim().max(150, 'Máximo 150 caracteres'),
        descripcion: z.string().trim().max(500, 'Máximo 500 caracteres'),
        comprobante: z.string().trim().max(100, 'Máximo 100 caracteres'),
    }).superRefine((datos, ctx) => {
        if (datos.metodo === 'caja' && datos.caja_id === null) {
            ctx.addIssue({ code: 'custom', path: ['caja_id'], message: 'La caja es obligatoria' })
        }
        if (datos.metodo === 'cuenta_bancaria' && datos.cuenta_bancaria_id === null) {
            ctx.addIssue({ code: 'custom', path: ['cuenta_bancaria_id'], message: 'La cuenta bancaria es obligatoria' })
        }
    })
}

export type EntradaEgreso = z.input<ReturnType<typeof esquemaEgreso>>
export type SalidaEgreso = z.output<ReturnType<typeof esquemaEgreso>>

export function entradaEgresoVacia(): EntradaEgreso {
    return { categoria: 'otros', monto: '', metodo: 'caja', fecha: '', caja_id: null, banco_id: null, cuenta_bancaria_id: null, proveedor: '', descripcion: '', comprobante: '' }
}

/**
 * Cuerpo de `POST /egresos`: solo el origen del método elegido (la API responde 422
 * `no_aplica` si viaja el de otro) y sin textos vacíos.
 */
export function cuerpoEgreso(datos: SalidaEgreso): CuerpoEgreso {
    const cuerpo: CuerpoEgreso = { categoria: datos.categoria, monto: new Decimal(datos.monto).toFixed(2), metodo: datos.metodo }
    if (datos.fecha) {
        cuerpo.fecha = datos.fecha
    }
    if (datos.metodo === 'caja') {
        cuerpo.caja_id = datos.caja_id
    }
    if (datos.metodo === 'banco' && datos.banco_id !== null) {
        cuerpo.banco_id = datos.banco_id
    }
    if (datos.metodo === 'cuenta_bancaria') {
        cuerpo.cuenta_bancaria_id = datos.cuenta_bancaria_id
    }
    if (datos.proveedor) {
        cuerpo.proveedor = datos.proveedor
    }
    if (datos.descripcion) {
        cuerpo.descripcion = datos.descripcion
    }
    if (datos.comprobante) {
        cuerpo.comprobante = datos.comprobante
    }
    return cuerpo
}

/** Suma de los egresos vigentes de la página (los anulados no cuentan). */
export function totalEgresos(egresos: readonly Pick<Egreso, 'monto' | 'estado'>[]): Decimal {
    return egresos.filter(e => e.estado === 'registrado').reduce((suma, e) => suma.plus(e.monto), new Decimal(0))
}

/* Cierre mensual del libro. */

type Cierre = Schema<'CierrePeriodo'>

export const ESTADOS_CIERRE: Record<Cierre['estado'], { etiqueta: string, color: NonNullable<BadgeProps['color']>, icono: string }> = {
    cerrado: { etiqueta: 'Cerrado', color: 'neutral', icono: 'i-lucide-lock' },
    reabierto: { etiqueta: 'Reabierto', color: 'warning', icono: 'i-lucide-lock-open' },
}

/** `2026-09` → `{ anio: 2026, mes: 9 }`. */
export function anioMes(periodo: string): { anio: number, mes: number } {
    return { anio: Number(periodo.slice(0, 4)), mes: Number(periodo.slice(5, 7)) }
}

/**
 * Meses que se pueden cerrar: los 12 anteriores al mes en curso (el en curso responde 422
 * `periodo_en_curso`), sin los que ya están cerrados.
 */
export function mesesCerrables(hoy: string, cierres: readonly Pick<Cierre, 'periodo' | 'estado'>[]): string[] {
    const cerrados = new Set(cierres.filter(c => c.estado === 'cerrado').map(c => c.periodo))
    return periodosRecientes(hoy, 13).slice(1).map(p => p.slice(0, 7)).filter(p => !cerrados.has(p))
}

export interface ResumenCierre {
    asientos: number | null
    debe: string | null
    haber: string | null
}

/** Lo que guarda la API en `resumen` al cerrar (asientos, debe y haber del mes), si viene. */
export function resumenCierre(cierre: Pick<Cierre, 'resumen'>): ResumenCierre {
    const r = cierre.resumen ?? {}
    const texto = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : null)
    return {
        asientos: typeof r.asientos === 'number' ? r.asientos : null,
        debe: texto(r.debe),
        haber: texto(r.haber),
    }
}
