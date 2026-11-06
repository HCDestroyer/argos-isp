import type { EstadoServicio } from '#shared/eventos'

/**
 * Modelo de velocidad (decisión del PM, día 4; `.claude/integration/contratos/velocidad.md`).
 *
 * **Única** fuente del `Mikrotik-Rate-Limit` y de los límites de las colas padre: la usan el
 * endpoint interno de `aaa` y la caché `aaa:user:*` (A1), `aaa` y el dispatcher de RouterOS (A2),
 * para que PPPoE y WISP nunca difieran. Funciones puras: sin base de datos ni reloj.
 *
 * Convenciones de RouterOS:
 * - `rx/tx` de la cola es `subida/bajada` del cliente (rx = lo que el router recibe del cliente).
 * - `k` = 1000 bit/s y `M` = 1 000 000 bit/s. Un valor en kbps múltiplo de 1000 se escribe en
 *   `M` (`20000` → `20M`); si no, en `k` (`20480` → `20480k`); 0 se escribe `0`.
 * - Formato completo: `rx/tx burst-rx/burst-tx umbral-rx/umbral-tx tiempo-rx/tiempo-tx
 *   prioridad limit-at-rx/limit-at-tx`. Una dirección sin ráfaga lleva `0` en ráfaga, umbral y
 *   tiempo (RouterOS la desactiva).
 *
 * Redondeos (siempre a kbps enteros):
 * - CIR (`limit-at`) y umbral de ráfaga: hacia abajo, para que nunca superen lo que el padre
 *   puede garantizar (`limit-at ≤ max-limit` y Σ hijos ≤ padre).
 * - `max-limit` del padre: hacia arriba (`ceil(Σ MIR / reuso)`, acotado por `topePadre`).
 */

export const CONTROLES_VELOCIDAD = ['simple', 'arbol_pcq'] as const
export type ControlVelocidad = (typeof CONTROLES_VELOCIDAD)[number]

/** Campos de velocidad del plan que `planes_routers` puede sobrescribir (null = hereda). */
export const CAMPOS_EXCEPCION_VELOCIDAD = [
    'reuso',
    'garantizado_pct',
    'rafaga_bajada_kbps',
    'rafaga_subida_kbps',
    'rafaga_umbral_pct',
    'rafaga_segundos',
    'prioridad',
] as const
export type CampoExcepcionVelocidad = (typeof CAMPOS_EXCEPCION_VELOCIDAD)[number]

/** Campos del plan que cambian una cola: emiten `plan.velocidad_cambiada` al editarse. */
export const CAMPOS_VELOCIDAD = [
    'bajada_kbps',
    'subida_kbps',
    'bajada_limitada_kbps',
    'subida_limitada_kbps',
    ...CAMPOS_EXCEPCION_VELOCIDAD,
] as const
export type CampoVelocidad = (typeof CAMPOS_VELOCIDAD)[number]

/** Valores por defecto del contrato. `garantizado_pct` null = `100 / reuso`. */
export const VELOCIDAD_POR_DEFECTO = {
    reuso: 1,
    garantizado_pct: null,
    rafaga_bajada_kbps: null,
    rafaga_subida_kbps: null,
    rafaga_umbral_pct: 75,
    rafaga_segundos: 16,
    prioridad: 8,
} as const

/** Velocidad efectiva de un plan en un router (plantilla + excepciones de `planes_routers`). */
export interface VelocidadPlan {
    bajada_kbps: number
    subida_kbps: number
    bajada_limitada_kbps: number
    subida_limitada_kbps: number
    /** N de 1:N (1 = dedicado) */
    reuso: number
    /** CIR como % del MIR; null = `100 / reuso` */
    garantizado_pct: number | null
    rafaga_bajada_kbps: number | null
    rafaga_subida_kbps: number | null
    /** `burst-threshold` como % del MIR */
    rafaga_umbral_pct: number
    /** `burst-time` en segundos */
    rafaga_segundos: number
    /** 1 (alta) a 8 (baja) */
    prioridad: number
    /** `planes_routers.rate_limit_override`: cadena completa que reemplaza la de estado normal */
    rate_limit_override?: string | null
}

export type ExcepcionVelocidad = { [C in CampoExcepcionVelocidad]?: VelocidadPlan[C] | null }

/** Aplica las excepciones del router: un campo null o ausente hereda el del plan. */
export function velocidadEfectiva(
    plan: VelocidadPlan,
    excepcion: ExcepcionVelocidad | null | undefined,
): VelocidadPlan {
    const efectiva: VelocidadPlan = { ...plan }
    if (!excepcion) return efectiva
    for (const campo of CAMPOS_EXCEPCION_VELOCIDAD) {
        const valor = excepcion[campo]
        if (valor !== null && valor !== undefined) {
            ;(efectiva as unknown as Record<string, unknown>)[campo] = valor
        }
    }
    return efectiva
}

/** Normaliza lo que llega de Postgres (`numeric` como string, smallint) a `VelocidadPlan`. */
export function leerVelocidad(fila: Record<string, unknown>): VelocidadPlan {
    const entero = (v: unknown, defecto: number) => (v === null || v === undefined ? defecto : Number(v))
    const opcional = (v: unknown) => (v === null || v === undefined ? null : Number(v))
    return {
        bajada_kbps: Number(fila.bajada_kbps),
        subida_kbps: Number(fila.subida_kbps),
        bajada_limitada_kbps: Number(fila.bajada_limitada_kbps),
        subida_limitada_kbps: Number(fila.subida_limitada_kbps),
        reuso: entero(fila.reuso, VELOCIDAD_POR_DEFECTO.reuso),
        garantizado_pct: opcional(fila.garantizado_pct),
        rafaga_bajada_kbps: opcional(fila.rafaga_bajada_kbps),
        rafaga_subida_kbps: opcional(fila.rafaga_subida_kbps),
        rafaga_umbral_pct: entero(fila.rafaga_umbral_pct, VELOCIDAD_POR_DEFECTO.rafaga_umbral_pct),
        rafaga_segundos: entero(fila.rafaga_segundos, VELOCIDAD_POR_DEFECTO.rafaga_segundos),
        prioridad: entero(fila.prioridad, VELOCIDAD_POR_DEFECTO.prioridad),
        rate_limit_override:
            typeof fila.rate_limit_override === 'string' && fila.rate_limit_override !== ''
                ? fila.rate_limit_override
                : null,
    }
}

/** kbps → texto de RouterOS: `0`, `<n>M` si es múltiplo de 1000, si no `<n>k`. */
export function formatoKbps(kbps: number): string {
    if (!Number.isFinite(kbps) || kbps < 0 || !Number.isInteger(kbps)) {
        throw new RangeError(`Velocidad inválida: ${kbps} kbps`)
    }
    if (kbps === 0) return '0'
    return kbps % 1000 === 0 ? `${kbps / 1000}M` : `${kbps}k`
}

/** `valor × pct / 100` hacia abajo, en aritmética entera (pct con hasta 2 decimales). */
function porcentaje(valor: number, pct: number): number {
    const centesimas = Math.round(pct * 100)
    return Math.floor((valor * centesimas) / 10_000)
}

/** CIR (`limit-at`) en kbps para una velocidad máxima `mir`. */
export function garantizadoKbps(mir: number, plan: Pick<VelocidadPlan, 'reuso' | 'garantizado_pct'>): number {
    if (plan.garantizado_pct === null) return Math.floor(mir / Math.max(plan.reuso, 1))
    return porcentaje(mir, plan.garantizado_pct)
}

const par = (rx: number, tx: number) => `${formatoKbps(rx)}/${formatoKbps(tx)}`

interface Direccion {
    mir: number
    rafaga: number | null
}

function rateLimit(plan: VelocidadPlan, subida: Direccion, bajada: Direccion): string {
    const umbral = (d: Direccion) => (d.rafaga === null ? 0 : porcentaje(d.mir, plan.rafaga_umbral_pct))
    const tiempo = (d: Direccion) => (d.rafaga === null ? 0 : plan.rafaga_segundos)
    const tiempoTxt = (d: Direccion) => String(tiempo(d))
    return [
        par(subida.mir, bajada.mir),
        par(subida.rafaga ?? 0, bajada.rafaga ?? 0),
        par(umbral(subida), umbral(bajada)),
        `${tiempoTxt(subida)}/${tiempoTxt(bajada)}`,
        String(plan.prioridad),
        par(garantizadoKbps(subida.mir, plan), garantizadoKbps(bajada.mir, plan)),
    ].join(' ')
}

/**
 * `Mikrotik-Rate-Limit` completo del servicio según su estado:
 * - `activo`: velocidad normal con ráfaga, prioridad y `limit-at` del plan; si el router tiene
 *   `rate_limit_override`, esa cadena tal cual.
 * - `limitado` (y `suspendido`/`retirado`, que `aaa` corta por su cuenta): velocidad limitada,
 *   sin ráfaga, con la misma prioridad y el mismo % garantizado.
 */
export function rateLimitServicio(plan: VelocidadPlan, estado: EstadoServicio): string {
    if (estado === 'activo') {
        if (plan.rate_limit_override) return plan.rate_limit_override
        return rateLimit(
            plan,
            { mir: plan.subida_kbps, rafaga: plan.rafaga_subida_kbps },
            { mir: plan.bajada_kbps, rafaga: plan.rafaga_bajada_kbps },
        )
    }
    return rateLimit(
        plan,
        { mir: plan.subida_limitada_kbps, rafaga: null },
        { mir: plan.bajada_limitada_kbps, rafaga: null },
    )
}

export interface LimitesPadre {
    /** `max-limit` subida/bajada (`topePadre`) */
    max_limit: string
    /** `limit-at` subida/bajada: Σ CIR de los hijos */
    limit_at: string
    prioridad: number
    max_limit_kbps: { subida: number; bajada: number }
    limit_at_kbps: { subida: number; bajada: number }
}

export interface ParKbps {
    subida: number
    bajada: number
}

/**
 * Hijos que una cola padre contiene de verdad, por velocidad efectiva: `activos` a la velocidad del
 * plan (con su ráfaga) y `limitados` a la velocidad limitada (sin ráfaga). Un suspendido o un
 * servicio sin cola (PPPoE sin sesión, WISP sin IPv4) no es hijo.
 */
export interface HijosPadre {
    activos: number
    limitados?: number
}

/** Agregado de los hijos de un padre: cuántos, Σ MIR, pico del hijo más rápido y Σ CIR. */
export interface SumaHijos {
    n: number
    /** Σ MIR (`max-limit`) de los hijos */
    mir: ParKbps
    /** velocidad máxima que alcanza un solo hijo: su `burst-limit` si tiene ráfaga activa, si no su MIR */
    pico: ParKbps
    /** Σ CIR (`limit-at`) de los hijos */
    cir: ParKbps
}

export const SIN_HIJOS: SumaHijos = {
    n: 0,
    mir: { subida: 0, bajada: 0 },
    pico: { subida: 0, bajada: 0 },
    cir: { subida: 0, bajada: 0 },
}

/** Une dos conjuntos disjuntos de hijos de un mismo padre (Σ MIR, Σ CIR, máximo de los picos). */
export function sumarHijos(a: SumaHijos, b: SumaHijos): SumaHijos {
    return {
        n: a.n + b.n,
        mir: { subida: a.mir.subida + b.mir.subida, bajada: a.mir.bajada + b.mir.bajada },
        pico: {
            subida: Math.max(a.pico.subida, b.pico.subida),
            bajada: Math.max(a.pico.bajada, b.pico.bajada),
        },
        cir: { subida: a.cir.subida + b.cir.subida, bajada: a.cir.bajada + b.cir.bajada },
    }
}

/**
 * Cota por componente de dos lecturas del **mismo** conjunto de hijos (lo que dice la base y lo que
 * el router tiene colgando de verdad): así el padre cubre a los dos mientras un accounting o un CoA
 * está en camino, sin pasar nunca de lo que suma alguno de ellos.
 */
export function mayorHijos(a: SumaHijos, b: SumaHijos): SumaHijos {
    const max = (x: ParKbps, y: ParKbps) => ({
        subida: Math.max(x.subida, y.subida),
        bajada: Math.max(x.bajada, y.bajada),
    })
    return {
        n: Math.max(a.n, b.n),
        mir: max(a.mir, b.mir),
        pico: max(a.pico, b.pico),
        cir: max(a.cir, b.cir),
    }
}

/** Un hijo con esos `max-limit`, `burst-limit` y `limit-at` (kbps). */
export function hijo(mir: ParKbps, rafaga: ParKbps | null, cir: ParKbps): SumaHijos {
    return {
        n: 1,
        mir,
        pico: {
            subida: Math.max(mir.subida, rafaga?.subida ?? 0),
            bajada: Math.max(mir.bajada, rafaga?.bajada ?? 0),
        },
        cir,
    }
}

/** Hijos de un plan: `activos` con MIR, ráfaga y CIR del plan; `limitados` con los limitados, sin ráfaga. */
export function hijosDelPlan(plan: VelocidadPlan, hijos: HijosPadre): SumaHijos {
    const activos = hijos.activos
    const limitados = hijos.limitados ?? 0
    for (const [nombre, n] of [
        ['activos', activos],
        ['limitados', limitados],
    ] as const) {
        if (!Number.isInteger(n) || n < 0) throw new RangeError(`${nombre} inválido: ${n}`)
    }
    const veces = (h: SumaHijos, n: number): SumaHijos =>
        n === 0
            ? SIN_HIJOS
            : {
                  n,
                  mir: { subida: h.mir.subida * n, bajada: h.mir.bajada * n },
                  pico: h.pico,
                  cir: { subida: h.cir.subida * n, bajada: h.cir.bajada * n },
              }
    const activo = hijo(
        { subida: plan.subida_kbps, bajada: plan.bajada_kbps },
        { subida: plan.rafaga_subida_kbps ?? 0, bajada: plan.rafaga_bajada_kbps ?? 0 },
        { subida: garantizadoKbps(plan.subida_kbps, plan), bajada: garantizadoKbps(plan.bajada_kbps, plan) },
    )
    const limitado = hijo({ subida: plan.subida_limitada_kbps, bajada: plan.bajada_limitada_kbps }, null, {
        subida: garantizadoKbps(plan.subida_limitada_kbps, plan),
        bajada: garantizadoKbps(plan.bajada_limitada_kbps, plan),
    })
    return sumarHijos(veces(activo, activos), veces(limitado, limitados))
}

/**
 * `max-limit` de un padre por sentido (`contratos/control-velocidad.md` §«Padres»):
 * `clamp(ceil(Σ MIR / reuso), pico, max(Σ MIR, pico))`, con `pico` = la velocidad máxima de un solo
 * hijo (su ráfaga si la tiene activa). Nunca baja del hijo más rápido (un hijo solo navega a su plan
 * y completa su ráfaga) ni pasa de la suma de los hijos (salvo para no cortar esa ráfaga).
 * Sin hijos devuelve 0: quien lo use decide qué escribir (0 en RouterOS es "sin límite").
 */
export function topePadre(hijos: SumaHijos, reuso: number): ParKbps {
    const r = Math.max(reuso, 1)
    const tope = (mir: number, pico: number) =>
        Math.min(Math.max(Math.ceil(mir / r), pico), Math.max(mir, pico))
    return {
        subida: tope(hijos.mir.subida, hijos.pico.subida),
        bajada: tope(hijos.mir.bajada, hijos.pico.bajada),
    }
}

/**
 * Límites de la cola padre de un plan en un router (`argosisp:plan:<plan_id>` en modo `simple`,
 * nodo del árbol en `arbol_pcq`), sobre los hijos que contiene de verdad (`HijosPadre`; un número
 * son `activos` a velocidad del plan). `max-limit` = `topePadre`; `limit-at` = Σ CIR, que nunca pasa
 * del `max-limit` (regla de oro: CIR ≤ MIR / reuso). Sin hijos el padre queda listo para el primero:
 * `max-limit` = el pico de un hijo del plan (no 0, que en RouterOS es "sin límite") y `limit-at` 0.
 */
export function limitesPadrePlan(plan: VelocidadPlan, hijos: number | HijosPadre): LimitesPadre {
    return limitesPadreSuma(plan, hijosDelPlan(plan, typeof hijos === 'number' ? { activos: hijos } : hijos))
}

/** `limitesPadrePlan` sobre hijos ya sumados (p. ej. lo de la base más lo que se leyó del router). */
export function limitesPadreSuma(plan: VelocidadPlan, suma: SumaHijos): LimitesPadre {
    const maxLimit = suma.n > 0 ? topePadre(suma, plan.reuso) : hijosDelPlan(plan, { activos: 1 }).pico
    return limitesDe(maxLimit, suma.cir, plan.prioridad)
}

/** Arma `LimitesPadre` desde kbps. */
export function limitesDe(maxLimit: ParKbps, limitAt: ParKbps, prioridad: number): LimitesPadre {
    return {
        max_limit: par(maxLimit.subida, maxLimit.bajada),
        limit_at: par(limitAt.subida, limitAt.bajada),
        prioridad,
        max_limit_kbps: maxLimit,
        limit_at_kbps: limitAt,
    }
}

export interface VistaPreviaVelocidad {
    /** `Mikrotik-Rate-Limit` en estado activo (o `rate_limit_override` si viene) */
    rate_limit: string
    /** `Mikrotik-Rate-Limit` en estado limitado (sin ráfaga) */
    rate_limit_limitado: string
    /** % garantizado que se aplica: `garantizado_pct` o `100 / reuso`, con 2 decimales hacia abajo */
    garantizado_pct_efectivo: number
    /** CIR (`limit-at`) de cada servicio en kbps */
    limit_at_servicio_kbps: { subida: number; bajada: number }
    /** cola padre del plan con `activos` hijos en estado activo (`limitesPadrePlan`) */
    padre: LimitesPadre & { activos: number }
}

/**
 * Vista previa del formulario de planes (`POST /planes/vista-previa`, semana 3): lo mismo que
 * verán `aaa` y el dispatcher, sin guardar nada. El panel no copia estas fórmulas.
 */
export function vistaPreviaVelocidad(plan: VelocidadPlan, activos: number): VistaPreviaVelocidad {
    const pct = plan.garantizado_pct ?? 100 / Math.max(plan.reuso, 1)
    return {
        rate_limit: rateLimitServicio(plan, 'activo'),
        rate_limit_limitado: rateLimitServicio(plan, 'limitado'),
        garantizado_pct_efectivo: Math.floor(pct * 100 + 1e-9) / 100,
        limit_at_servicio_kbps: {
            subida: garantizadoKbps(plan.subida_kbps, plan),
            bajada: garantizadoKbps(plan.bajada_kbps, plan),
        },
        padre: { ...limitesPadrePlan(plan, activos), activos },
    }
}

export interface ErrorVelocidad {
    field: string
    message: string
    rule: string
}

/**
 * Coherencia del modelo (422 por campo):
 * - CIR ≤ MIR / reuso (`garantizado_pct ≤ 100 / reuso`): así `limit-at ≤ max-limit` y la suma de
 *   los `limit-at` de los hijos no supera el `max-limit` del padre;
 * - ráfaga sana: `umbral < MIR < ráfaga` en cada dirección con ráfaga (`rafaga_umbral_pct < 100`
 *   y `rafaga_*_kbps > *_kbps`);
 * - prioridad 1..8 y reuso 1..64.
 */
export function validarVelocidad(plan: VelocidadPlan): ErrorVelocidad[] {
    const errores: ErrorVelocidad[] = []
    if (!Number.isInteger(plan.reuso) || plan.reuso < 1 || plan.reuso > 64) {
        errores.push({ field: 'reuso', message: 'El reuso debe estar entre 1 y 64', rule: 'range' })
    }
    if (!Number.isInteger(plan.prioridad) || plan.prioridad < 1 || plan.prioridad > 8) {
        errores.push({ field: 'prioridad', message: 'La prioridad debe estar entre 1 y 8', rule: 'range' })
    }
    if (plan.garantizado_pct !== null) {
        const maximo = 100 / Math.max(plan.reuso, 1)
        if (plan.garantizado_pct <= 0 || plan.garantizado_pct > maximo + 1e-9) {
            errores.push({
                field: 'garantizado_pct',
                message:
                    plan.reuso > 1
                        ? `Con reuso 1:${plan.reuso} el garantizado no puede pasar de ${Math.floor(maximo * 100) / 100} % (CIR × activos ≤ max-limit del padre)`
                        : 'El garantizado debe estar entre 0 y 100 % (CIR ≤ MIR)',
                rule: 'cir',
            })
        }
    }
    const conRafaga = plan.rafaga_bajada_kbps !== null || plan.rafaga_subida_kbps !== null
    if (conRafaga && (plan.rafaga_umbral_pct <= 0 || plan.rafaga_umbral_pct >= 100)) {
        errores.push({
            field: 'rafaga_umbral_pct',
            message: 'El umbral de ráfaga debe ser menor que la velocidad máxima (entre 1 y 99 %)',
            rule: 'rafaga',
        })
    }
    if (plan.rafaga_bajada_kbps !== null && plan.rafaga_bajada_kbps <= plan.bajada_kbps) {
        errores.push({
            field: 'rafaga_bajada_kbps',
            message: `La ráfaga de bajada debe ser mayor que la velocidad de bajada (${plan.bajada_kbps} kbps)`,
            rule: 'rafaga',
        })
    }
    if (plan.rafaga_subida_kbps !== null && plan.rafaga_subida_kbps <= plan.subida_kbps) {
        errores.push({
            field: 'rafaga_subida_kbps',
            message: `La ráfaga de subida debe ser mayor que la velocidad de subida (${plan.subida_kbps} kbps)`,
            rule: 'rafaga',
        })
    }
    if (plan.rafaga_segundos < 1) {
        errores.push({
            field: 'rafaga_segundos',
            message: 'El tiempo de ráfaga debe ser al menos 1 s',
            rule: 'range',
        })
    }
    return errores
}
