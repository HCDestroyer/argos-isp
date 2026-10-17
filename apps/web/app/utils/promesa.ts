import type { Schema } from '@argosisp/contracts'
import type { BadgeProps } from '@nuxt/ui'
import Decimal from 'decimal.js'
import * as z from 'zod'
import { formatearFecha, formatearFechaHora, formatearQuetzales } from './formato'

type PromesaPago = Schema<'Promesa'>
export type EvaluacionPromesaApi = Schema<'EvaluacionPromesa'>
export type ReglaEvaluada = Schema<'ReglaEvaluada'>
export type ReglaPromesa = ReglaEvaluada['regla']
type Color = NonNullable<BadgeProps['color']>

export const ESTADOS_PROMESA: Record<PromesaPago['estado'], { etiqueta: string, color: Color, icono: string }> = {
    activa: { etiqueta: 'Activa', color: 'info', icono: 'i-lucide-calendar-clock' },
    pendiente_aprobacion: { etiqueta: 'Pendiente de aprobación', color: 'warning', icono: 'i-lucide-hourglass' },
    cumplida: { etiqueta: 'Cumplida', color: 'success', icono: 'i-lucide-circle-check' },
    incumplida: { etiqueta: 'Incumplida', color: 'error', icono: 'i-lucide-circle-x' },
    rechazada: { etiqueta: 'Rechazada', color: 'neutral', icono: 'i-lucide-ban' },
    cancelada: { etiqueta: 'Cancelada', color: 'neutral', icono: 'i-lucide-circle-slash' },
}

export const CANALES_PROMESA: Record<PromesaPago['canal'], string> = {
    operador: 'Operador',
    supervisor: 'Supervisor',
    portal: 'Portal del cliente',
    ia: 'Agente de IA',
}

/** Nombres legibles de las reglas de `contratos/promesas.md` (las desconocidas se muestran tal cual). */
const REGLAS: Record<ReglaPromesa, string> = {
    habilitadas: 'Promesas habilitadas',
    canal_permitido: 'Canal permitido',
    sin_deuda: 'Tiene deuda',
    plazo_max_dias: 'Plazo máximo',
    no_exceder_siguiente_facturacion: 'Antes de la siguiente factura',
    deuda_maxima: 'Deuda máxima',
    abono_inicial_pct: 'Abono inicial',
    antiguedad_minima_dias: 'Antigüedad mínima',
    cumplimiento_minimo_pct: 'Cumplimiento mínimo',
    bloqueo_tras_incumplida_dias: 'Bloqueo tras incumplir',
    max_por_periodo: 'Máximo por periodo',
    requiere_aprobacion: 'Requiere aprobación',
}

export function etiquetaRegla(regla: string): string {
    return regla in REGLAS ? REGLAS[regla as ReglaPromesa] : regla
}

/** De dónde salió el límite: el general de la plantilla o el del canal que lo reemplazó. */
export function etiquetaOrigenRegla(origen: ReglaEvaluada['origen']): string | null {
    return origen === 'general' ? null : `límite del canal ${CANALES_PROMESA[origen].toLowerCase()}`
}

export type DecisionPromesa = 'aprobada' | 'rechazada' | 'pendiente'

const RESULTADOS: readonly EvaluacionPromesaApi['resultado'][] = ['aprobada', 'rechazada', 'pendiente_aprobacion']
const ORIGENES: readonly ReglaEvaluada['origen'][] = ['general', 'portal', 'ia', 'operador', 'supervisor']
const CANALES: readonly PromesaPago['canal'][] = ['portal', 'ia', 'operador', 'supervisor']

function esRegistro(valor: unknown): valor is Record<string, unknown> {
    return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
}

function esReglaEvaluada(valor: unknown): valor is ReglaEvaluada {
    return esRegistro(valor)
        && typeof valor.regla === 'string'
        && typeof valor.ok === 'boolean'
        && typeof valor.detalle === 'string'
        && (ORIGENES as readonly unknown[]).includes(valor.origen)
}

/**
 * `resultado_evaluacion` con la forma estable `Schema<'EvaluacionPromesa'>` (A3). El OpenAPI
 * todavía lo declara como objeto libre: este guardia lo comprueba en lugar de suponerlo.
 */
export function esEvaluacionPromesa(valor: unknown): valor is EvaluacionPromesaApi {
    return esRegistro(valor)
        && (RESULTADOS as readonly unknown[]).includes(valor.resultado)
        && (valor.regla === null || typeof valor.regla === 'string')
        && typeof valor.motivo === 'string'
        && (CANALES as readonly unknown[]).includes(valor.canal)
        && typeof valor.evaluada_en === 'string'
        && Array.isArray(valor.reglas) && valor.reglas.every(esReglaEvaluada)
        && esRegistro(valor.deuda)
        && esRegistro(valor.historial)
}

export interface EvaluacionLegible {
    decision: DecisionPromesa | null
    /** La evaluación de la API, o `null` si la promesa no la trae (o no tiene la forma estable). */
    evaluacion: EvaluacionPromesaApi | null
}

/**
 * Lee `resultado_evaluacion` como `Schema<'EvaluacionPromesa'>`. Sin evaluación (promesas
 * anteriores o un dato inesperado) la decisión se deduce del estado y nada más: nunca se inventa
 * una regla ni un motivo.
 */
export function leerEvaluacion(promesa: Pick<PromesaPago, 'estado' | 'resultado_evaluacion'>): EvaluacionLegible {
    const evaluacion = esEvaluacionPromesa(promesa.resultado_evaluacion) ? promesa.resultado_evaluacion : null
    return {
        decision: evaluacion ? decisionDeResultado(evaluacion.resultado) : decisionPorEstado(promesa.estado),
        evaluacion,
    }
}

export function decisionDeResultado(resultado: EvaluacionPromesaApi['resultado']): DecisionPromesa {
    return resultado === 'pendiente_aprobacion' ? 'pendiente' : resultado
}

/** `valor` / `limite` de una regla en texto: montos con Q y dos decimales, booleanos en español. */
export function textoValorRegla(valor: ReglaEvaluada['valor']): string | null {
    if (valor === null) {
        return null
    }
    if (typeof valor === 'boolean') {
        return valor ? 'sí' : 'no'
    }
    if (typeof valor === 'string' && /^-?\d+\.\d{2}$/.test(valor)) {
        return formatearQuetzales(valor)
    }
    return String(valor)
}

/** Datos de la evaluación en español, para la ficha (deuda, historial, fechas, aprobación, cierre). */
export function datosEvaluacion(evaluacion: EvaluacionPromesaApi): { clave: string, etiqueta: string, valor: string }[] {
    const datos: { clave: string, etiqueta: string, valor: string }[] = []
    const d = evaluacion.deuda
    const vencidas = `${d.facturas_vencidas} ${d.facturas_vencidas === 1 ? 'factura vencida' : 'facturas vencidas'}`
    datos.push({ clave: 'deuda', etiqueta: 'Deuda del servicio', valor: `Vencida ${formatearQuetzales(d.vencida)} · pendiente ${formatearQuetzales(d.pendiente)} · ${vencidas}` })
    const h = evaluacion.historial
    const ventana = ` (últimas ${h.ventana})`
    datos.push({
        clave: 'historial',
        etiqueta: 'Historial de promesas',
        valor: h.resueltas === 0 ? `Sin promesas anteriores${ventana}` : `${h.cumplidas} de ${h.resueltas} cumplidas${h.cumplimiento_pct !== null ? ` (${h.cumplimiento_pct} %)` : ''}${ventana}`,
    })
    datos.push({ clave: 'evaluada_en', etiqueta: 'Evaluada', valor: `${formatearFechaHora(evaluacion.evaluada_en)} · ${CANALES_PROMESA[evaluacion.canal]}` })
    if (evaluacion.siguiente_facturacion) {
        datos.push({ clave: 'siguiente_facturacion', etiqueta: 'Siguiente facturación', valor: formatearFecha(evaluacion.siguiente_facturacion) })
    }
    if (evaluacion.aprobacion) {
        const a = evaluacion.aprobacion
        datos.push({ clave: 'aprobacion', etiqueta: 'Aprobación', valor: `${formatearFechaHora(a.en)}${a.nota ? ` · ${a.nota}` : ''}` })
    }
    if (evaluacion.cierre) {
        const c = evaluacion.cierre
        const partes = [ESTADOS_PROMESA[c.estado].etiqueta, formatearFechaHora(c.en)]
        if (c.motivo) {
            partes.push(c.motivo)
        }
        if (c.pagado) {
            partes.push(`pagó ${formatearQuetzales(c.pagado)}`)
        }
        if (c.deuda_vencida) {
            partes.push(`deuda vencida ${formatearQuetzales(c.deuda_vencida)}`)
        }
        datos.push({ clave: 'cierre', etiqueta: 'Cierre', valor: partes.join(' · ') })
    }
    return datos
}

/** Lo último que pasó con una promesa ya evaluada (cierre o aprobación), en una línea. */
export function ultimoPaso(evaluacion: EvaluacionPromesaApi | null): string | null {
    if (evaluacion?.cierre) {
        const c = evaluacion.cierre
        return `${ESTADOS_PROMESA[c.estado].etiqueta}: ${formatearFechaHora(c.en)}${c.motivo ? ` · ${c.motivo}` : ''}`
    }
    if (evaluacion?.aprobacion) {
        const a = evaluacion.aprobacion
        return `Aprobada: ${formatearFechaHora(a.en)}${a.nota ? ` · ${a.nota}` : ''}`
    }
    return null
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
