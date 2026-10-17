import type { Schema, paths } from '@argosisp/contracts'

/**
 * Presentación del modelo de velocidad (`contratos/velocidad.md`). El panel no calcula el
 * `Mikrotik-Rate-Limit`: lo pide a `POST /planes/vista-previa` (formulario de planes) y lo lee
 * de `PlanEfectivo.rate_limit` (routers). Aquí solo quedan etiquetas, valores por defecto del
 * formulario y cómo se explica una cadena que ya calculó la API.
 */

export type ControlVelocidad = NonNullable<Schema<'Router'>['control_velocidad']>
export type VistaPreviaVelocidad = Schema<'VistaPreviaVelocidad'>
export type DatosVistaPreviaPlan = paths['/api/v1/planes/vista-previa']['post']['requestBody']['content']['application/json']

/** Valores por defecto del formulario: los mismos que pone la API cuando no llegan. */
export const VELOCIDAD_POR_DEFECTO = {
    reuso: 1,
    garantizado_pct: null,
    rafaga_bajada_kbps: null,
    rafaga_subida_kbps: null,
    rafaga_umbral_pct: 75,
    rafaga_segundos: 16,
    prioridad: 8,
} as const

/** Partes del rate-limit con su significado, para explicar la cadena que devolvió la API. */
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

/** Resumen de una fila de planes: `1:4 · garantía 30 % · prioridad 2 · con ráfaga`. */
export function resumenVelocidadPlan(plan: Pick<Schema<'Plan'>, 'reuso' | 'garantizado_pct' | 'prioridad' | 'rafaga_bajada_kbps' | 'rafaga_subida_kbps'>): string {
    const garantia = plan.garantizado_pct === null ? 'garantía automática' : `garantía ${plan.garantizado_pct} %`
    const rafaga = plan.rafaga_bajada_kbps !== null || plan.rafaga_subida_kbps !== null ? ' · con ráfaga' : ''
    return `1:${plan.reuso} · ${garantia} · prioridad ${plan.prioridad}${rafaga}`
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
