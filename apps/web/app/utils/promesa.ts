import type { Schema } from '@argosisp/contracts'
import type { BadgeProps } from '@nuxt/ui'
import Decimal from 'decimal.js'
import * as z from 'zod'

type PromesaPago = Schema<'Promesa'>
type Color = NonNullable<BadgeProps['color']>

export const ESTADOS_PROMESA: Record<PromesaPago['estado'], { etiqueta: string, color: Color, icono: string }> = {
    activa: { etiqueta: 'Activa', color: 'info', icono: 'i-lucide-calendar-clock' },
    pendiente_aprobacion: { etiqueta: 'Pendiente de aprobación', color: 'warning', icono: 'i-lucide-hourglass' },
    cumplida: { etiqueta: 'Cumplida', color: 'success', icono: 'i-lucide-circle-check' },
    incumplida: { etiqueta: 'Incumplida', color: 'error', icono: 'i-lucide-circle-x' },
    rechazada: { etiqueta: 'Rechazada', color: 'error', icono: 'i-lucide-ban' },
    cancelada: { etiqueta: 'Cancelada', color: 'neutral', icono: 'i-lucide-circle-slash' },
}

export const CANALES_PROMESA: Record<PromesaPago['canal'], string> = {
    operador: 'Operador',
    supervisor: 'Supervisor',
    portal: 'Portal del cliente',
    ia: 'Agente de IA',
}

/** Nombres legibles de las reglas de `ReglasPromesa` (las desconocidas se muestran tal cual). */
const REGLAS: Record<string, string> = {
    plantilla: 'Plantilla de facturación',
    habilitadas: 'Promesas habilitadas',
    canal: 'Canal permitido',
    permitido: 'Canal permitido',
    plazo_max_dias: 'Plazo máximo',
    max_por_periodo: 'Máximo por periodo',
    max_por_periodo_buen_historial: 'Máximo por buen historial',
    no_exceder_siguiente_facturacion: 'Antes de la siguiente factura',
    deuda_maxima: 'Deuda máxima',
    abono_inicial_pct: 'Abono inicial',
    antiguedad_minima_dias: 'Antigüedad mínima',
    cumplimiento_minimo_pct: 'Cumplimiento mínimo',
    bloqueo_tras_incumplida_dias: 'Bloqueo tras incumplir',
    requiere_aprobacion: 'Requiere aprobación',
}

/** `canales.operador.requiere_aprobacion` → `Requiere aprobación (operador)`. */
export function etiquetaRegla(regla: string): string {
    const partes = regla.split('.')
    const ultima = partes.at(-1) ?? regla
    const nombre = REGLAS[ultima] ?? regla
    return partes[0] === 'canales' && partes[1] ? `${nombre} (${CANALES_PROMESA[partes[1] as PromesaPago['canal']] ?? partes[1]})` : nombre
}

export type DecisionPromesa = 'aprobada' | 'rechazada' | 'pendiente'

export interface Verificacion {
    regla: string
    cumple: boolean
    detalle: string | null
}

export interface EvaluacionLegible {
    decision: DecisionPromesa | null
    regla: string | null
    motivo: string | null
    verificaciones: Verificacion[]
    /** Claves que el panel no sabe leer, para no esconder nada de lo que mande la API. */
    otros: { clave: string, valor: string }[]
}

function texto(valor: unknown): string | null {
    return typeof valor === 'string' && valor.trim() ? valor.trim() : null
}

function decisionDe(valor: unknown): DecisionPromesa | null {
    const t = texto(valor)?.toLowerCase()
    if (!t) {
        return null
    }
    if (['aprobada', 'aprobado', 'activa', 'ok', 'aceptada'].includes(t)) {
        return 'aprobada'
    }
    if (['rechazada', 'rechazado', 'denegada'].includes(t)) {
        return 'rechazada'
    }
    if (t.startsWith('pendiente')) {
        return 'pendiente'
    }
    return null
}

function verificacionesDe(valor: unknown): Verificacion[] {
    if (!Array.isArray(valor)) {
        return []
    }
    return valor.flatMap((item: unknown): Verificacion[] => {
        if (typeof item !== 'object' || item === null) {
            return []
        }
        const registro = item as Record<string, unknown>
        const regla = texto(registro.regla) ?? texto(registro.nombre)
        const cumple = registro.cumple ?? registro.ok ?? registro.paso
        if (!regla || typeof cumple !== 'boolean') {
            return []
        }
        return [{ regla, cumple, detalle: texto(registro.detalle) ?? texto(registro.motivo) }]
    })
}

const CONOCIDAS = new Set(['decision', 'resultado', 'estado', 'regla', 'regla_aplicada', 'motivo', 'detalle', 'mensaje', 'verificaciones', 'reglas', 'canal'])

/**
 * Lee `resultado_evaluacion` (el contrato lo deja libre; la forma propuesta a A3 es
 * `{ decision, regla, motivo, canal, verificaciones: [{ regla, cumple, detalle }] }`). Si falta la
 * decisión, se deduce del estado de la promesa. Nunca inventa una regla: sin ella queda `null`.
 */
export function leerEvaluacion(promesa: Pick<PromesaPago, 'estado' | 'resultado_evaluacion'>): EvaluacionLegible {
    const datos = promesa.resultado_evaluacion ?? {}
    const decision = decisionDe(datos.decision ?? datos.resultado ?? datos.estado) ?? decisionPorEstado(promesa.estado)
    const otros = Object.entries(datos)
        .filter(([clave]) => !CONOCIDAS.has(clave))
        .map(([clave, valor]) => ({ clave, valor: typeof valor === 'string' ? valor : JSON.stringify(valor) }))
    return {
        decision,
        regla: texto(datos.regla) ?? texto(datos.regla_aplicada),
        motivo: texto(datos.motivo) ?? texto(datos.detalle) ?? texto(datos.mensaje),
        verificaciones: verificacionesDe(datos.verificaciones ?? datos.reglas),
        otros,
    }
}

function decisionPorEstado(estado: PromesaPago['estado']): DecisionPromesa | null {
    if (estado === 'rechazada') {
        return 'rechazada'
    }
    if (estado === 'pendiente_aprobacion') {
        return 'pendiente'
    }
    if (estado === 'activa' || estado === 'cumplida' || estado === 'incumplida') {
        return 'aprobada'
    }
    return null
}

export const DECISIONES: Record<DecisionPromesa, { etiqueta: string, color: 'success' | 'error' | 'warning', icono: string }> = {
    aprobada: { etiqueta: 'Aprobada', color: 'success', icono: 'i-lucide-circle-check' },
    rechazada: { etiqueta: 'Rechazada', color: 'error', icono: 'i-lucide-ban' },
    pendiente: { etiqueta: 'Pendiente de aprobación', color: 'warning', icono: 'i-lucide-hourglass' },
}

const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const FECHA = /^\d{4}-\d{2}-\d{2}$/

/**
 * Espejo de `POST /promesas`: monto > 0 con hasta 2 decimales y vencimiento en el futuro. El
 * día se elige en hora de Guatemala y se manda como el final de ese día en UTC.
 */
export function esquemaPromesa(hoy: string) {
    return z.object({
        monto: z.string()
            .trim()
            .regex(MONTO, 'Escribe un monto con hasta 2 decimales, sin comas (ej. 175.00)')
            .refine(valor => !MONTO.test(valor) || new Decimal(valor).gt(0), 'El monto debe ser mayor que cero'),
        vence: z.string().regex(FECHA, 'Elige el día').refine(dia => dia >= hoy, 'Debe ser hoy o un día futuro'),
        canal: z.enum(['operador', 'supervisor']),
    })
}

export type DatosFormularioPromesa = z.output<ReturnType<typeof esquemaPromesa>>
