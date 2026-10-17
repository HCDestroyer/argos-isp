import type { Schema, paths } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import * as z from 'zod'

type Plan = Schema<'Plan'>
type DatosPlan = paths['/api/v1/planes']['post']['requestBody']['content']['application/json']
type CambiosPlan = paths['/api/v1/planes/{id}']['put']['requestBody']['content']['application/json']

const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const KBPS_MAX = 100_000_000

function kbps(etiqueta: string) {
    return z.number({ message: `Escribe la ${etiqueta} en kbps` })
        .int('Solo kbps enteros')
        .min(1, 'Debe ser al menos 1 kbps')
        .max(KBPS_MAX, 'Máximo 100 000 000 kbps')
}

function opcional(min: number, max: number, mensaje: string) {
    return z.number().min(min, mensaje).max(max, mensaje).nullable()
}

/**
 * Espejo de `crearPlanValidator` / `editarPlanValidator` (A1): tipos y rangos por campo. Las
 * reglas cruzadas del modelo de velocidad (CIR ≤ 100 / reuso, ráfaga > velocidad…) no se copian:
 * las responde `POST /planes/vista-previa` como 422 por campo mientras se escribe, y otra vez
 * `POST`/`PUT /planes` al guardar. La garantía y la ráfaga se activan con un interruptor:
 * apagadas viajan como `null` (garantía = 100 / reuso; sin ráfaga).
 */
export const esquemaPlan = z.object({
    nombre: z.string().trim().min(2, 'Al menos 2 caracteres').max(100, 'Máximo 100 caracteres'),
    precio: z.string()
        .trim()
        .regex(MONTO, 'Escribe un monto con hasta 2 decimales, sin comas (ej. 175.00)'),
    bajada_kbps: kbps('bajada'),
    subida_kbps: kbps('subida'),
    bajada_limitada_kbps: kbps('bajada limitada'),
    subida_limitada_kbps: kbps('subida limitada'),
    reuso: z.number({ message: 'Escribe el reuso' }).int('Solo enteros').min(1, 'El reuso debe estar entre 1 y 64').max(64, 'El reuso debe estar entre 1 y 64'),
    garantia_automatica: z.boolean(),
    garantizado_pct: opcional(0.01, 100, 'Entre 0.01 y 100 %'),
    con_rafaga: z.boolean(),
    rafaga_bajada_kbps: opcional(1, KBPS_MAX, 'kbps inválidos'),
    rafaga_subida_kbps: opcional(1, KBPS_MAX, 'kbps inválidos'),
    rafaga_umbral_pct: z.number({ message: 'Escribe el umbral' }).int('Solo enteros').min(1, 'Entre 1 y 99 %').max(99, 'Entre 1 y 99 %'),
    rafaga_segundos: z.number({ message: 'Escribe el tiempo' }).int('Solo enteros').min(1, 'Entre 1 y 3600 s').max(3600, 'Entre 1 y 3600 s'),
    prioridad: z.number({ message: 'Elige la prioridad' }).int().min(1, 'La prioridad debe estar entre 1 y 8').max(8, 'La prioridad debe estar entre 1 y 8'),
    dual_stack: z.enum(['ambos', 'v4', 'v6']),
    tamano_prefijo_delegado: z.union([z.literal(64), z.literal(56), z.literal(48)]),
    global: z.boolean(),
    activo: z.boolean(),
}).superRefine((datos, ctx) => {
    if (!datos.garantia_automatica && datos.garantizado_pct === null) {
        ctx.addIssue({ code: 'custom', path: ['garantizado_pct'], message: 'Escribe el % garantizado o usa el automático' })
    }
    if (datos.con_rafaga && datos.rafaga_bajada_kbps === null && datos.rafaga_subida_kbps === null) {
        ctx.addIssue({ code: 'custom', path: ['rafaga_bajada_kbps'], message: 'Escribe la ráfaga de bajada, de subida o ambas' })
    }
})

export type EntradaPlan = z.input<typeof esquemaPlan>
export type SalidaPlan = z.output<typeof esquemaPlan>

type CamposVelocidad = 'bajada_kbps' | 'subida_kbps' | 'bajada_limitada_kbps' | 'subida_limitada_kbps' | 'reuso' | 'garantia_automatica' | 'garantizado_pct' | 'con_rafaga' | 'rafaga_bajada_kbps' | 'rafaga_subida_kbps' | 'rafaga_umbral_pct' | 'rafaga_segundos' | 'prioridad'
type VelocidadFormulario = Pick<DatosPlan, 'bajada_kbps' | 'subida_kbps' | 'bajada_limitada_kbps' | 'subida_limitada_kbps' | 'reuso' | 'garantizado_pct' | 'rafaga_bajada_kbps' | 'rafaga_subida_kbps' | 'rafaga_umbral_pct' | 'rafaga_segundos' | 'prioridad'>

/** Modelo de velocidad que resulta del formulario (lo que la API guardaría). */
export function velocidadDeFormulario(datos: Pick<EntradaPlan, CamposVelocidad>): VelocidadFormulario {
    return {
        bajada_kbps: datos.bajada_kbps,
        subida_kbps: datos.subida_kbps,
        bajada_limitada_kbps: datos.bajada_limitada_kbps,
        subida_limitada_kbps: datos.subida_limitada_kbps,
        reuso: datos.reuso,
        garantizado_pct: datos.garantia_automatica ? null : datos.garantizado_pct,
        rafaga_bajada_kbps: datos.con_rafaga ? datos.rafaga_bajada_kbps : null,
        rafaga_subida_kbps: datos.con_rafaga ? datos.rafaga_subida_kbps : null,
        rafaga_umbral_pct: datos.rafaga_umbral_pct,
        rafaga_segundos: datos.rafaga_segundos,
        prioridad: datos.prioridad,
    }
}

export function entradaPlanVacia(): EntradaPlan {
    return {
        nombre: '',
        precio: '',
        bajada_kbps: 20_000,
        subida_kbps: 10_000,
        bajada_limitada_kbps: 1024,
        subida_limitada_kbps: 512,
        reuso: VELOCIDAD_POR_DEFECTO.reuso,
        garantia_automatica: true,
        garantizado_pct: null,
        con_rafaga: false,
        rafaga_bajada_kbps: null,
        rafaga_subida_kbps: null,
        rafaga_umbral_pct: VELOCIDAD_POR_DEFECTO.rafaga_umbral_pct,
        rafaga_segundos: VELOCIDAD_POR_DEFECTO.rafaga_segundos,
        prioridad: VELOCIDAD_POR_DEFECTO.prioridad,
        dual_stack: 'ambos',
        tamano_prefijo_delegado: 56,
        global: true,
        activo: true,
    }
}

/**
 * Cuerpo de `POST /planes/vista-previa` con lo que hay en el formulario, o `null` si falta algún
 * número entero: sin datos completos no se pide (ni se muestra) ninguna cadena.
 */
export function cuerpoVistaPrevia(datos: EntradaPlan, activos: number | null): DatosVistaPreviaPlan | null {
    const enteros = [datos.bajada_kbps, datos.subida_kbps, datos.bajada_limitada_kbps, datos.subida_limitada_kbps, datos.reuso, datos.rafaga_umbral_pct, datos.rafaga_segundos, datos.prioridad]
    if (!enteros.every(n => typeof n === 'number' && Number.isInteger(n) && n > 0)) {
        return null
    }
    // Garantía manual sin escribir: mandar `null` sería pedir la automática.
    if (!datos.garantia_automatica && typeof datos.garantizado_pct !== 'number') {
        return null
    }
    return {
        ...velocidadDeFormulario(datos),
        activos: typeof activos === 'number' && Number.isInteger(activos) && activos >= 0 ? activos : 1,
    }
}

export function entradaDesdePlan(plan: Plan): EntradaPlan {
    return {
        nombre: plan.nombre,
        precio: plan.precio,
        bajada_kbps: plan.bajada_kbps,
        subida_kbps: plan.subida_kbps,
        bajada_limitada_kbps: plan.bajada_limitada_kbps,
        subida_limitada_kbps: plan.subida_limitada_kbps,
        reuso: plan.reuso,
        garantia_automatica: plan.garantizado_pct === null,
        garantizado_pct: plan.garantizado_pct,
        con_rafaga: plan.rafaga_bajada_kbps !== null || plan.rafaga_subida_kbps !== null,
        rafaga_bajada_kbps: plan.rafaga_bajada_kbps,
        rafaga_subida_kbps: plan.rafaga_subida_kbps,
        rafaga_umbral_pct: plan.rafaga_umbral_pct,
        rafaga_segundos: plan.rafaga_segundos,
        prioridad: plan.prioridad,
        dual_stack: plan.dual_stack,
        tamano_prefijo_delegado: plan.tamano_prefijo_delegado,
        global: plan.global,
        activo: plan.activo,
    }
}

/** Cuerpo de `POST /planes`. */
export function cuerpoPlan(datos: SalidaPlan): DatosPlan {
    const velocidad = velocidadDeFormulario(datos)
    return {
        nombre: datos.nombre,
        precio: new Decimal(datos.precio).toFixed(2),
        bajada_kbps: datos.bajada_kbps,
        subida_kbps: datos.subida_kbps,
        bajada_limitada_kbps: datos.bajada_limitada_kbps,
        subida_limitada_kbps: datos.subida_limitada_kbps,
        reuso: velocidad.reuso,
        garantizado_pct: velocidad.garantizado_pct,
        rafaga_bajada_kbps: velocidad.rafaga_bajada_kbps,
        rafaga_subida_kbps: velocidad.rafaga_subida_kbps,
        rafaga_umbral_pct: velocidad.rafaga_umbral_pct,
        rafaga_segundos: velocidad.rafaga_segundos,
        prioridad: velocidad.prioridad,
        dual_stack: datos.dual_stack,
        tamano_prefijo_delegado: datos.tamano_prefijo_delegado,
        global: datos.global,
        activo: datos.activo,
    }
}

/** Cuerpo de `PUT /planes/:id`: todos los campos con la `version` leída. */
export function cambiosPlan(datos: SalidaPlan, version: number): CambiosPlan {
    return { ...cuerpoPlan(datos), version }
}

export const PRIORIDADES: { label: string, value: number }[] = Array.from({ length: 8 }, (_, i) => ({
    label: i === 0 ? '1 · alta (corporativos)' : i === 7 ? '8 · baja (residencial)' : String(i + 1),
    value: i + 1,
}))
