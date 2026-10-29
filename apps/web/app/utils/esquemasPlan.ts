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
    /** Tipo de plan (A1): solo cambia advertencias y reportes, nunca la velocidad. */
    tipo: z.enum(['residencial', 'empresarial', 'dedicado']),
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
    rafaga_bajada_kbps: opcional(1, KBPS_MAX, 'Escribe la velocidad en kbps, sin decimales'),
    rafaga_subida_kbps: opcional(1, KBPS_MAX, 'Escribe la velocidad en kbps, sin decimales'),
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
        tipo: 'residencial',
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
        tipo: plan.tipo ?? 'residencial',
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
        tipo: datos.tipo,
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

/*
 * Implementación del plan en un router (`PUT /planes/:id/routers/:routerId`, A1).
 */

type PlanRouter = Schema<'PlanRouter'>
type DatosPlanRouter = paths['/api/v1/planes/{id}/routers/{routerId}']['put']['requestBody']['content']['application/json']

const IPV4 = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/
const textoCorto = (max: number) => z.string().trim().max(max, `Máximo ${max} caracteres`)

/**
 * Espejo de `implementarPlanValidator` (A1): textos de RouterOS (vacío = sin valor), `local_address`
 * IPv4 y las excepciones de velocidad del plan en ese router (`null` = hereda del plan). Las reglas
 * cruzadas (garantía ≤ 100 / reuso, ráfaga > MIR) las responde la API como 422 por campo.
 */
export const esquemaPlanRouter = z.object({
    profile_ppp: textoCorto(100),
    pool_ipv4: textoCorto(100),
    pool_ipv6_enlace: textoCorto(100),
    pool_ipv6_delegacion: textoCorto(100),
    local_address: z.string().trim().refine(v => v === '' || IPV4.test(v), 'Escribe una IPv4 (ej. 10.0.0.1)'),
    no_crear_reglas: z.boolean(),
    rate_limit_override: textoCorto(200),
    reuso: opcional(1, 64, 'Entre 1 y 64'),
    garantizado_pct: opcional(0.01, 100, 'Entre 0.01 y 100 %'),
    rafaga_bajada_kbps: opcional(1, KBPS_MAX, 'Escribe la velocidad en kbps, sin decimales'),
    rafaga_subida_kbps: opcional(1, KBPS_MAX, 'Escribe la velocidad en kbps, sin decimales'),
    rafaga_umbral_pct: opcional(1, 99, 'Entre 1 y 99 %'),
    rafaga_segundos: opcional(1, 3600, 'Entre 1 y 3600 s'),
    prioridad: opcional(1, 8, 'Entre 1 y 8'),
})

export type EntradaPlanRouter = z.input<typeof esquemaPlanRouter>
export type SalidaPlanRouter = z.output<typeof esquemaPlanRouter>

export function entradaPlanRouter(implementacion: PlanRouter | null): EntradaPlanRouter {
    const texto = (v: string | null | undefined) => v ?? ''
    return {
        profile_ppp: texto(implementacion?.profile_ppp),
        pool_ipv4: texto(implementacion?.pool_ipv4),
        pool_ipv6_enlace: texto(implementacion?.pool_ipv6_enlace),
        pool_ipv6_delegacion: texto(implementacion?.pool_ipv6_delegacion),
        local_address: texto(implementacion?.local_address),
        no_crear_reglas: implementacion?.no_crear_reglas ?? false,
        rate_limit_override: texto(implementacion?.rate_limit_override),
        reuso: implementacion?.reuso ?? null,
        garantizado_pct: implementacion?.garantizado_pct ?? null,
        rafaga_bajada_kbps: implementacion?.rafaga_bajada_kbps ?? null,
        rafaga_subida_kbps: implementacion?.rafaga_subida_kbps ?? null,
        rafaga_umbral_pct: implementacion?.rafaga_umbral_pct ?? null,
        rafaga_segundos: implementacion?.rafaga_segundos ?? null,
        prioridad: implementacion?.prioridad ?? null,
    }
}

/** Cuerpo del `PUT`: textos vacíos como `null`; con `version` solo si ya existía. */
export function cuerpoPlanRouter(datos: SalidaPlanRouter, version: number | null): DatosPlanRouter {
    const nulo = (v: string) => (v === '' ? null : v)
    return {
        ...(version === null ? {} : { version }),
        profile_ppp: nulo(datos.profile_ppp),
        pool_ipv4: nulo(datos.pool_ipv4),
        pool_ipv6_enlace: nulo(datos.pool_ipv6_enlace),
        pool_ipv6_delegacion: nulo(datos.pool_ipv6_delegacion),
        local_address: nulo(datos.local_address),
        no_crear_reglas: datos.no_crear_reglas,
        rate_limit_override: nulo(datos.rate_limit_override),
        reuso: datos.reuso,
        garantizado_pct: datos.garantizado_pct,
        rafaga_bajada_kbps: datos.rafaga_bajada_kbps,
        rafaga_subida_kbps: datos.rafaga_subida_kbps,
        rafaga_umbral_pct: datos.rafaga_umbral_pct,
        rafaga_segundos: datos.rafaga_segundos,
        prioridad: datos.prioridad,
    }
}

/** Qué cambia la implementación respecto al plan, en palabras. */
export function resumenImplementacion(implementacion: PlanRouter): string {
    const partes: string[] = []
    if (implementacion.profile_ppp) {
        partes.push(`profile ${implementacion.profile_ppp}`)
    }
    if (implementacion.pool_ipv4) {
        partes.push(`pool ${implementacion.pool_ipv4}`)
    }
    if (implementacion.rate_limit_override) {
        partes.push('rate-limit propio')
    }
    const velocidad = (['reuso', 'garantizado_pct', 'rafaga_bajada_kbps', 'rafaga_subida_kbps', 'rafaga_umbral_pct', 'rafaga_segundos', 'prioridad'] as const).filter(c => implementacion[c] !== null)
    if (velocidad.length) {
        partes.push(`${velocidad.length} ${velocidad.length === 1 ? 'excepción' : 'excepciones'} de velocidad`)
    }
    if (implementacion.no_crear_reglas) {
        partes.push('sin reglas automáticas')
    }
    return partes.join(' · ') || 'Igual que el plan'
}
