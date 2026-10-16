import type { Schema } from '@argosisp/contracts'

/**
 * Espejo, para la vista previa del panel, de `apps/api/app/network/velocidad.ts` (A1,
 * `contratos/velocidad.md`): el `Mikrotik-Rate-Limit` que recibirá el servicio y la coherencia
 * del modelo (422 por campo). La fuente de verdad es la API: lo que guarda y lo que manda a
 * RouterOS (`PlanEfectivo.rate_limit`) sale de allá; si alguna vez difieren, gana la API y esta
 * copia se corrige con `tests/nuxt/velocidad.test.ts` (los mismos casos que la prueba de A1).
 *
 * - `rx/tx` = `subida/bajada` del cliente.
 * - `k` = 1000 bit/s y `M` = 1 000 000; múltiplos de 1000 kbps en `M`; 0 sin unidad.
 * - Formato: `rx/tx ráfaga-rx/tx umbral-rx/tx tiempo-rx/tx prioridad limit-at-rx/tx`.
 * - CIR y umbral se redondean hacia abajo, en aritmética entera.
 */

export type ControlVelocidad = NonNullable<Schema<'Router'>['control_velocidad']>
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

export const VELOCIDAD_POR_DEFECTO = {
    reuso: 1,
    garantizado_pct: null,
    rafaga_bajada_kbps: null,
    rafaga_subida_kbps: null,
    rafaga_umbral_pct: 75,
    rafaga_segundos: 16,
    prioridad: 8,
} as const

/** La vista `Plan` deja opcionales los campos nuevos (la API siempre los manda): sus defectos. */
export function velocidadDePlan(plan: Pick<Schema<'Plan'>, 'bajada_kbps' | 'subida_kbps' | 'bajada_limitada_kbps' | 'subida_limitada_kbps' | 'reuso' | 'garantizado_pct' | 'rafaga_bajada_kbps' | 'rafaga_subida_kbps' | 'rafaga_umbral_pct' | 'rafaga_segundos' | 'prioridad'>): VelocidadPlan {
    return {
        bajada_kbps: plan.bajada_kbps,
        subida_kbps: plan.subida_kbps,
        bajada_limitada_kbps: plan.bajada_limitada_kbps,
        subida_limitada_kbps: plan.subida_limitada_kbps,
        reuso: plan.reuso,
        garantizado_pct: plan.garantizado_pct ?? null,
        rafaga_bajada_kbps: plan.rafaga_bajada_kbps ?? null,
        rafaga_subida_kbps: plan.rafaga_subida_kbps ?? null,
        rafaga_umbral_pct: plan.rafaga_umbral_pct ?? VELOCIDAD_POR_DEFECTO.rafaga_umbral_pct,
        rafaga_segundos: plan.rafaga_segundos ?? VELOCIDAD_POR_DEFECTO.rafaga_segundos,
        prioridad: plan.prioridad ?? VELOCIDAD_POR_DEFECTO.prioridad,
    }
}

/** kbps → texto de RouterOS: `0`, `<n>M` si es múltiplo de 1000, si no `<n>k`. `?` si no es válido. */
export function formatoKbps(kbps: number): string {
    if (!Number.isFinite(kbps) || kbps < 0 || !Number.isInteger(kbps)) {
        return '?'
    }
    if (kbps === 0) {
        return '0'
    }
    return kbps % 1000 === 0 ? `${kbps / 1000}M` : `${kbps}k`
}

/** `valor × pct / 100` hacia abajo, en aritmética entera (pct con hasta 2 decimales). */
function porcentaje(valor: number, pct: number): number {
    const centesimas = Math.round(pct * 100)
    return Math.floor((valor * centesimas) / 10_000)
}

/** CIR (`limit-at`) en kbps para una velocidad máxima `mir`. */
export function garantizadoKbps(mir: number, plan: Pick<VelocidadPlan, 'reuso' | 'garantizado_pct'>): number {
    if (plan.garantizado_pct === null) {
        return Math.floor(mir / Math.max(plan.reuso, 1))
    }
    return porcentaje(mir, plan.garantizado_pct)
}

/** % garantizado efectivo (el explícito o `100 / reuso`), con 2 decimales. */
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

/** `Mikrotik-Rate-Limit` del servicio: activo con ráfaga; limitado (y cortado) sin ráfaga. */
export function rateLimitServicio(plan: VelocidadPlan, estado: EstadoServicio): string {
    if (estado === 'activo') {
        return rateLimit(plan, { mir: plan.subida_kbps, rafaga: plan.rafaga_subida_kbps }, { mir: plan.bajada_kbps, rafaga: plan.rafaga_bajada_kbps })
    }
    return rateLimit(plan, { mir: plan.subida_limitada_kbps, rafaga: null }, { mir: plan.bajada_limitada_kbps, rafaga: null })
}

/** Cola padre del plan en un router con `activos` servicios (con 0 se calcula como 1). */
export function limitesPadrePlan(plan: VelocidadPlan, activos: number): { max_limit: string, limit_at: string } {
    const n = Math.max(Math.floor(activos), 1)
    const reuso = Math.max(plan.reuso, 1)
    const max = (mir: number) => Math.ceil((mir * n) / reuso)
    return {
        max_limit: par(max(plan.subida_kbps), max(plan.bajada_kbps)),
        limit_at: par(garantizadoKbps(plan.subida_kbps, plan) * n, garantizadoKbps(plan.bajada_kbps, plan) * n),
    }
}

export interface ErrorVelocidad {
    field: keyof VelocidadPlan
    message: string
}

/**
 * Las mismas reglas cruzadas que `validarVelocidad` (A1), con sus mensajes: CIR ≤ 100 / reuso,
 * umbral 1..99 con ráfaga, ráfaga > velocidad, prioridad 1..8, reuso 1..64, tiempo ≥ 1 s.
 */
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

/** Partes del rate-limit con su significado, para explicarlo en la vista previa. */
export function partesRateLimit(cadena: string): { etiqueta: string, valor: string }[] {
    const [maximo, rafaga, umbral, tiempo, prioridad, garantizado] = cadena.split(' ')
    return [
        { etiqueta: 'Máximo (subida/bajada)', valor: maximo ?? '' },
        { etiqueta: 'Ráfaga', valor: rafaga ?? '' },
        { etiqueta: 'Umbral de ráfaga', valor: umbral ?? '' },
        { etiqueta: 'Tiempo de ráfaga (s)', valor: tiempo ?? '' },
        { etiqueta: 'Prioridad', valor: prioridad ?? '' },
        { etiqueta: 'Garantizado (limit-at)', valor: garantizado ?? '' },
    ]
}

export const CONTROLES_VELOCIDAD: Record<ControlVelocidad, { etiqueta: string, cambiarA: string, descripcion: string, icono: string }> = {
    simple: {
        etiqueta: 'Colas simples',
        cambiarA: 'Cambiar a colas simples',
        descripcion: 'Una cola por servicio (la dinámica de PPPoE o una estática en WISP) bajo una cola padre por plan con el reuso. Bien hasta unos cientos de clientes por router.',
        icono: 'i-lucide-list',
    },
    arbol_pcq: {
        etiqueta: 'Árbol con PCQ',
        cambiarA: 'Cambiar a árbol con PCQ',
        descripcion: 'Queue tree en global con un hijo por plan y tipos PCQ por plan (también /64 de IPv6): cada cliente tiene su tope y el reuso lo pone el padre. Recomendado para muchos clientes por router.',
        icono: 'i-lucide-git-fork',
    },
}
