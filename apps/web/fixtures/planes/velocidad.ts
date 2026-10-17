import type { Schema } from '@argosisp/contracts'

/**
 * Simulación, solo para el modo fixtures, de `apps/api/app/network/velocidad.ts` (A1,
 * `contratos/velocidad.md`). El panel ya no calcula el rate-limit: lo pide a
 * `POST /planes/vista-previa` y lo lee de `PlanEfectivo.rate_limit`. Esta copia existe para que
 * los fixtures respondan como la API; `tests/nuxt/velocidad.test.ts` la prueba con los mismos
 * casos que `tests/network/velocidad.spec.ts`.
 *
 * - `rx/tx` = `subida/bajada` del cliente; `k` = 1000 bit/s y `M` = 1 000 000.
 * - CIR y umbral hacia abajo, en aritmética entera; max-limit del padre hacia arriba.
 */

type EstadoServicio = Schema<'EstadoServicio'>

export interface VelocidadPlan {
    bajada_kbps: number
    subida_kbps: number
    bajada_limitada_kbps: number
    subida_limitada_kbps: number
    reuso: number
    garantizado_pct: number | null
    rafaga_bajada_kbps: number | null
    rafaga_subida_kbps: number | null
    rafaga_umbral_pct: number
    rafaga_segundos: number
    prioridad: number
}

export function velocidadDePlan(plan: Pick<Schema<'Plan'>, keyof VelocidadPlan>): VelocidadPlan {
    return {
        bajada_kbps: plan.bajada_kbps,
        subida_kbps: plan.subida_kbps,
        bajada_limitada_kbps: plan.bajada_limitada_kbps,
        subida_limitada_kbps: plan.subida_limitada_kbps,
        reuso: plan.reuso,
        garantizado_pct: plan.garantizado_pct,
        rafaga_bajada_kbps: plan.rafaga_bajada_kbps,
        rafaga_subida_kbps: plan.rafaga_subida_kbps,
        rafaga_umbral_pct: plan.rafaga_umbral_pct,
        rafaga_segundos: plan.rafaga_segundos,
        prioridad: plan.prioridad,
    }
}

export function formatoKbps(kbps: number): string {
    if (!Number.isFinite(kbps) || kbps < 0 || !Number.isInteger(kbps)) {
        return '?'
    }
    if (kbps === 0) {
        return '0'
    }
    return kbps % 1000 === 0 ? `${kbps / 1000}M` : `${kbps}k`
}

function porcentaje(valor: number, pct: number): number {
    const centesimas = Math.round(pct * 100)
    return Math.floor((valor * centesimas) / 10_000)
}

export function garantizadoKbps(mir: number, plan: Pick<VelocidadPlan, 'reuso' | 'garantizado_pct'>): number {
    if (plan.garantizado_pct === null) {
        return Math.floor(mir / Math.max(plan.reuso, 1))
    }
    return porcentaje(mir, plan.garantizado_pct)
}

export function garantizadoEfectivoPct(plan: Pick<VelocidadPlan, 'reuso' | 'garantizado_pct'>): number {
    return plan.garantizado_pct ?? Math.floor((100 / Math.max(plan.reuso, 1)) * 100) / 100
}

const par = (rx: number, tx: number) => `${formatoKbps(rx)}/${formatoKbps(tx)}`

interface Direccion {
    mir: number
    rafaga: number | null
}

function rateLimit(plan: VelocidadPlan, subida: Direccion, bajada: Direccion): string {
    const umbral = (d: Direccion) => (d.rafaga === null ? 0 : porcentaje(d.mir, plan.rafaga_umbral_pct))
    const tiempo = (d: Direccion) => (d.rafaga === null ? 0 : plan.rafaga_segundos)
    return [
        par(subida.mir, bajada.mir),
        par(subida.rafaga ?? 0, bajada.rafaga ?? 0),
        par(umbral(subida), umbral(bajada)),
        `${tiempo(subida)}/${tiempo(bajada)}`,
        String(plan.prioridad),
        par(garantizadoKbps(subida.mir, plan), garantizadoKbps(bajada.mir, plan)),
    ].join(' ')
}

export function rateLimitServicio(plan: VelocidadPlan, estado: EstadoServicio): string {
    if (estado === 'activo') {
        return rateLimit(plan, { mir: plan.subida_kbps, rafaga: plan.rafaga_subida_kbps }, { mir: plan.bajada_kbps, rafaga: plan.rafaga_bajada_kbps })
    }
    return rateLimit(plan, { mir: plan.subida_limitada_kbps, rafaga: null }, { mir: plan.bajada_limitada_kbps, rafaga: null })
}

/** `VistaPreviaVelocidad` de `POST /planes/vista-previa` con `activos` servicios (0 cuenta como 1). */
export function vistaPreviaVelocidad(plan: VelocidadPlan, activos: number, override: string | null = null): Schema<'VistaPreviaVelocidad'> {
    const n = Math.max(Math.floor(activos), 1)
    const reuso = Math.max(plan.reuso, 1)
    const max = (mir: number) => Math.ceil((mir * n) / reuso)
    const cir = { subida: garantizadoKbps(plan.subida_kbps, plan), bajada: garantizadoKbps(plan.bajada_kbps, plan) }
    const maxLimit = { subida: max(plan.subida_kbps), bajada: max(plan.bajada_kbps) }
    const limitAt = { subida: cir.subida * n, bajada: cir.bajada * n }
    return {
        rate_limit: override ?? rateLimitServicio(plan, 'activo'),
        rate_limit_limitado: rateLimitServicio(plan, 'limitado'),
        garantizado_pct_efectivo: garantizadoEfectivoPct(plan),
        limit_at_servicio_kbps: cir,
        padre: {
            max_limit: par(maxLimit.subida, maxLimit.bajada),
            limit_at: par(limitAt.subida, limitAt.bajada),
            prioridad: plan.prioridad,
            max_limit_kbps: maxLimit,
            limit_at_kbps: limitAt,
            activos: Math.max(Math.floor(activos), 0),
        },
    }
}

export interface ErrorVelocidad {
    field: keyof VelocidadPlan
    message: string
}

/** Las reglas cruzadas de `validarVelocidad` (A1) con sus mensajes. */
export function validarVelocidad(plan: VelocidadPlan): ErrorVelocidad[] {
    const errores: ErrorVelocidad[] = []
    if (!Number.isInteger(plan.reuso) || plan.reuso < 1 || plan.reuso > 64) {
        errores.push({ field: 'reuso', message: 'El reuso debe estar entre 1 y 64' })
    }
    if (!Number.isInteger(plan.prioridad) || plan.prioridad < 1 || plan.prioridad > 8) {
        errores.push({ field: 'prioridad', message: 'La prioridad debe estar entre 1 y 8' })
    }
    if (plan.garantizado_pct !== null) {
        const maximo = 100 / Math.max(plan.reuso, 1)
        if (plan.garantizado_pct <= 0 || plan.garantizado_pct > maximo + 1e-9) {
            errores.push({
                field: 'garantizado_pct',
                message: plan.reuso > 1
                    ? `Con reuso 1:${plan.reuso} el garantizado no puede pasar de ${Math.floor(maximo * 100) / 100} % (CIR × activos ≤ max-limit del padre)`
                    : 'El garantizado debe estar entre 0 y 100 % (CIR ≤ MIR)',
            })
        }
    }
    const conRafaga = plan.rafaga_bajada_kbps !== null || plan.rafaga_subida_kbps !== null
    if (conRafaga && (plan.rafaga_umbral_pct <= 0 || plan.rafaga_umbral_pct >= 100)) {
        errores.push({ field: 'rafaga_umbral_pct', message: 'El umbral de ráfaga debe ser menor que la velocidad máxima (entre 1 y 99 %)' })
    }
    if (plan.rafaga_bajada_kbps !== null && plan.rafaga_bajada_kbps <= plan.bajada_kbps) {
        errores.push({ field: 'rafaga_bajada_kbps', message: `La ráfaga de bajada debe ser mayor que la velocidad de bajada (${plan.bajada_kbps} kbps)` })
    }
    if (plan.rafaga_subida_kbps !== null && plan.rafaga_subida_kbps <= plan.subida_kbps) {
        errores.push({ field: 'rafaga_subida_kbps', message: `La ráfaga de subida debe ser mayor que la velocidad de subida (${plan.subida_kbps} kbps)` })
    }
    if (plan.rafaga_segundos < 1) {
        errores.push({ field: 'rafaga_segundos', message: 'El tiempo de ráfaga debe ser al menos 1 s' })
    }
    return errores
}
