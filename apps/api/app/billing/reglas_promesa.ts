import vine from '@vinejs/vine'
import { dinero } from '#shared/validadores'

/**
 * Reglas de promesas de pago de una plantilla (`plantillas_facturacion.reglas_promesa`).
 *
 * Las evalúa `crearPromesaPago` (tarea 10). Se guardan siempre **normalizadas** (todas las claves,
 * con sus valores por defecto), así `reglas_snapshot` de cada promesa es autocontenido.
 *
 * Semántica:
 * - `max_por_periodo`: promesas por periodo de facturación. Si en las últimas `historial_ventana`
 *   promesas el cumplimiento es ≥ `buen_historial_pct`, el máximo es `max_por_periodo_buen_historial`
 *   ("máximo calculado desde el historial").
 * - `plazo_max_dias`: días máximos entre la creación y el vencimiento de la promesa.
 * - `no_exceder_siguiente_facturacion`: la promesa vence antes de la próxima factura del servicio.
 * - `deuda_maxima`: deuda vencida máxima para aceptar promesa (null = sin límite).
 * - `abono_inicial_pct`: porcentaje de la deuda que debe pagarse antes (0 = no exige abono).
 * - `antiguedad_minima_dias`: antigüedad mínima del servicio.
 * - `cumplimiento_minimo_pct`: cumplimiento histórico mínimo (null = no se exige).
 * - `bloqueo_tras_incumplida_dias`: días sin promesas después de una incumplida.
 * - `canales.<canal>`: límites por canal. `permitido: false` rechaza; `requiere_aprobacion: true`
 *   deja la promesa en `pendiente_aprobacion`; los valores no nulos **reemplazan** al general.
 */

export const CANALES_PROMESA = ['portal', 'ia', 'operador', 'supervisor'] as const
export type CanalPromesa = (typeof CANALES_PROMESA)[number]

export interface LimitesCanal {
    permitido: boolean
    requiere_aprobacion: boolean
    plazo_max_dias: number | null
    max_por_periodo: number | null
    /** monto decimal como string, o null */
    deuda_maxima: string | null
}

export interface ReglasPromesa {
    habilitadas: boolean
    max_por_periodo: number
    max_por_periodo_buen_historial: number
    buen_historial_pct: number
    historial_ventana: number
    plazo_max_dias: number
    no_exceder_siguiente_facturacion: boolean
    deuda_maxima: string | null
    abono_inicial_pct: number
    antiguedad_minima_dias: number
    cumplimiento_minimo_pct: number | null
    bloqueo_tras_incumplida_dias: number
    canales: Record<CanalPromesa, LimitesCanal>
}

const SIN_LIMITES_CANAL: LimitesCanal = {
    permitido: true,
    requiere_aprobacion: false,
    plazo_max_dias: null,
    max_por_periodo: null,
    deuda_maxima: null,
}

export const REGLAS_PROMESA_POR_DEFECTO: ReglasPromesa = {
    habilitadas: true,
    max_por_periodo: 1,
    max_por_periodo_buen_historial: 2,
    buen_historial_pct: 100,
    historial_ventana: 6,
    plazo_max_dias: 5,
    no_exceder_siguiente_facturacion: true,
    deuda_maxima: null,
    abono_inicial_pct: 0,
    antiguedad_minima_dias: 0,
    cumplimiento_minimo_pct: null,
    bloqueo_tras_incumplida_dias: 30,
    canales: {
        portal: { ...SIN_LIMITES_CANAL, plazo_max_dias: 3 },
        ia: { ...SIN_LIMITES_CANAL, plazo_max_dias: 3 },
        operador: { ...SIN_LIMITES_CANAL },
        supervisor: { ...SIN_LIMITES_CANAL, plazo_max_dias: 15, max_por_periodo: 3 },
    },
}

/*
|--------------------------------------------------------------------------
| Validación (VineJS → OpenAPI)
|--------------------------------------------------------------------------
*/

const entero = (min: number, max: number) => vine.number().withoutDecimals().range([min, max])

const limitesCanal = () =>
    vine
        .object({
            permitido: vine.boolean().optional(),
            requiere_aprobacion: vine.boolean().optional(),
            plazo_max_dias: entero(1, 60).nullable().optional(),
            max_por_periodo: entero(0, 12).nullable().optional(),
            deuda_maxima: dinero().nullable().optional(),
        })
        .optional()

/** Schema de `reglas_promesa` (todas las claves opcionales; las faltantes toman el valor por defecto). */
export const reglasPromesaSchema = () =>
    vine.object({
        habilitadas: vine.boolean().optional(),
        max_por_periodo: entero(0, 12).optional(),
        max_por_periodo_buen_historial: entero(0, 12).optional(),
        buen_historial_pct: entero(0, 100).optional(),
        historial_ventana: entero(1, 50).optional(),
        plazo_max_dias: entero(1, 60).optional(),
        no_exceder_siguiente_facturacion: vine.boolean().optional(),
        deuda_maxima: dinero().nullable().optional(),
        abono_inicial_pct: entero(0, 100).optional(),
        antiguedad_minima_dias: entero(0, 3650).optional(),
        cumplimiento_minimo_pct: entero(0, 100).nullable().optional(),
        bloqueo_tras_incumplida_dias: entero(0, 365).optional(),
        canales: vine
            .object({
                portal: limitesCanal(),
                ia: limitesCanal(),
                operador: limitesCanal(),
                supervisor: limitesCanal(),
            })
            .optional(),
    })

export type ReglasPromesaParciales = Partial<Omit<ReglasPromesa, 'canales'>> & {
    canales?: Partial<Record<CanalPromesa, Partial<LimitesCanal> | undefined>>
}

/** Completa con los valores por defecto (o con `base`) y devuelve un objeto nuevo. */
export function normalizarReglasPromesa(
    parciales: ReglasPromesaParciales | null | undefined,
    base: ReglasPromesa = REGLAS_PROMESA_POR_DEFECTO,
): ReglasPromesa {
    const entrada = (parciales ?? {}) as ReglasPromesaParciales
    const { canales: canalesEntrada, ...generales } = entrada
    const canales = {} as Record<CanalPromesa, LimitesCanal>
    for (const canal of CANALES_PROMESA) {
        canales[canal] = { ...base.canales[canal], ...sinIndefinidos(canalesEntrada?.[canal] ?? {}) }
    }
    return { ...base, ...sinIndefinidos(generales), canales }
}

function sinIndefinidos<T extends object>(objeto: T): Partial<T> {
    return Object.fromEntries(Object.entries(objeto).filter(([, valor]) => valor !== undefined)) as Partial<T>
}
