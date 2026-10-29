import type { Schema, paths } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import * as z from 'zod'

type Simulacion = Schema<'SimulacionPromesa'>
type ReglaSimulada = Schema<'ReglaSimulada'>

export type EstadoReglaSimulada = 'cumple' | 'falla' | 'no_aplica'

export const ESTADOS_REGLA: Record<EstadoReglaSimulada, { etiqueta: string, icono: string, clase: string }> = {
    cumple: { etiqueta: 'Cumple', icono: 'i-lucide-circle-check', clase: 'text-success' },
    falla: { etiqueta: 'No cumple', icono: 'i-lucide-circle-x', clase: 'text-error' },
    no_aplica: { etiqueta: 'No aplica', icono: 'i-lucide-circle-minus', clase: 'text-dimmed' },
}

/** `aplica: false` = la configuración de la plantilla no exige esa regla. */
export function estadoRegla(regla: Pick<ReglaSimulada, 'ok' | 'aplica'>): EstadoReglaSimulada {
    if (!regla.aplica) {
        return 'no_aplica'
    }
    return regla.ok ? 'cumple' : 'falla'
}

/** `aprobada`, `rechazada` o `pendiente_aprobacion` → la clave de `DECISIONES`. */
export function decisionSimulacion(resultado: Simulacion['resultado']): DecisionPromesa {
    return resultado === 'pendiente_aprobacion' ? 'pendiente' : resultado
}

/** El límite vino del canal (reemplaza al general de la plantilla). */
export function origenRegla(regla: Pick<ReglaSimulada, 'origen'>): string | null {
    if (regla.origen === 'general') {
        return null
    }
    const canal = Object.entries(CANALES_PROMESA).find(([clave]) => clave === regla.origen)?.[1]
    return `Límite del canal ${canal ?? regla.origen}`
}

/** Canales con los que el panel puede crear (portal e IA crean desde su propio canal). */
export const CANALES_CREACION_PANEL = ['operador', 'supervisor'] as const

/**
 * ¿Se puede ofrecer "Crear con estos datos"? Solo si la promesa quedaría activa o pendiente (una
 * rechazada solo dejaría el registro), crear no daría 422/409 y el canal simulado es uno con el
 * que el panel crea.
 */
export function creableDesdeSimulacion(simulacion: Pick<Simulacion, 'resultado_creacion' | 'canal'>): boolean {
    return (simulacion.resultado_creacion === 'aprobada' || simulacion.resultado_creacion === 'pendiente_aprobacion')
        && (CANALES_CREACION_PANEL as readonly string[]).includes(simulacion.canal)
}

/** Cupo de promesas del periodo: `0 de 1`. */
export function cupoPeriodo(limites: Pick<Simulacion['limites'], 'en_periodo' | 'max_por_periodo'>): string {
    return `${limites.en_periodo} de ${limites.max_por_periodo}`
}

/** Abono que falta pagar antes de prometer (nunca negativo). */
export function abonoFaltante(limites: Pick<Simulacion['limites'], 'abono_requerido' | 'abono_pagado'>): Decimal {
    return Decimal.max(0, new Decimal(limites.abono_requerido).minus(limites.abono_pagado))
}

const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const FECHA = /^\d{4}-\d{2}-\d{2}$/

/**
 * Formulario del simulador: todo es opcional como en `POST /promesas/simular` (sin monto, la
 * deuda pendiente; sin fecha, el fin de mañana). Se permite simular cualquier canal, también
 * portal e IA, para ver qué reglas les tocan.
 */
export const esquemaSimulacion = z.object({
    servicio_id: z.number({ message: 'Elige el servicio' }).int().positive('Elige el servicio'),
    monto: z.string()
        .trim()
        .refine(valor => valor === '' || MONTO.test(valor), 'Escribe un monto con hasta 2 decimales, sin comas (ej. 175.00)')
        .refine(valor => valor === '' || !MONTO.test(valor) || new Decimal(valor).gt(0), 'El monto debe ser mayor que cero'),
    vence: z.string().refine(valor => valor === '' || FECHA.test(valor), 'Elige una fecha válida (día, mes y año)'),
    canal: z.enum(['operador', 'supervisor', 'portal', 'ia']),
})

export type EntradaSimulacion = z.input<typeof esquemaSimulacion>
export type SalidaSimulacion = z.output<typeof esquemaSimulacion>
export type CuerpoSimulacion = paths['/api/v1/promesas/simular']['post']['requestBody']['content']['application/json']

export function cuerpoSimulacion(datos: SalidaSimulacion): CuerpoSimulacion {
    const cuerpo: CuerpoSimulacion = { servicio_id: datos.servicio_id, canal: datos.canal }
    if (datos.monto) {
        cuerpo.monto = new Decimal(datos.monto).toFixed(2)
    }
    if (datos.vence) {
        cuerpo.vence_en = finDiaGuatemala(datos.vence)
    }
    return cuerpo
}
