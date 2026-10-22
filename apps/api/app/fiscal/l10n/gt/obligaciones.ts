import type { RegimenGt } from '#fiscal/l10n/gt/parametros'

/**
 * Obligaciones fiscales de Guatemala (contrato §9.3): qué declaración presenta cada régimen, con
 * qué periodicidad y qué parámetro fija su plazo y su formulario. El plazo **no** vive aquí: se lee
 * del parámetro (con vigencia) en la fecha del periodo, así un cambio de ley es una versión del
 * parámetro y no una edición de este catálogo.
 *
 * Formas del valor del parámetro de plazo (las de `l10n/gt/parametros.ts`):
 *  - `{ plazo: 'mes_siguiente' }`: último día del mes siguiente al fin del periodo.
 *  - `{ dias: n, dias_habiles: true }`: el n-ésimo día hábil del mes siguiente.
 *  - `{ dias: n }`: el día n del mes siguiente (días calendario).
 *  - `{ vence: 'MM-DD' }`: ese día del año siguiente al fin del periodo.
 *  - `cuarto_trimestre: 'con_la_anual'`: el 4.º trimestre no es obligación propia (va con la anual).
 * Un vencimiento que cae en día inhábil pasa al siguiente día hábil (§15 #60: contador).
 */

export const IMPUESTOS_OBLIGACION = [
    'iva_mensual',
    'pc_mensual',
    'isr_opcional_mensual',
    'isr_trimestral',
    'iso_trimestral',
    'isr_anual',
    'retenciones_iva',
    'retenciones_isr',
] as const
export type ImpuestoObligacion = (typeof IMPUESTOS_OBLIGACION)[number]

export type Periodicidad = 'mensual' | 'trimestral' | 'anual'

/**
 * Condición adicional al régimen:
 *  - `agente_retencion_iva`: la bandera de la empresa vigente en el periodo.
 *  - `retuvo_isr`: el periodo tiene retenciones de ISR emitidas (abono neto a `2.1.05` sin contar
 *    su pago ni su liquidación). «Quien retenga» (§9.3) no es una bandera: sale del libro.
 */
export type CondicionObligacion = 'agente_retencion_iva' | 'retuvo_isr'

export interface DefinicionObligacion {
    impuesto: ImpuestoObligacion
    nombre: string
    periodicidad: Periodicidad
    regimenes: readonly RegimenGt[]
    condicion?: CondicionObligacion
    /** parámetro con el plazo y el formulario (`formulario: null` = por confirmar) */
    parametro_plazo: string
    fuente: string
}

const TODOS: readonly RegimenGt[] = ['utilidades', 'opcional_simplificado', 'pequeno_contribuyente']

export const OBLIGACIONES_GT: readonly DefinicionObligacion[] = [
    {
        impuesto: 'iva_mensual',
        nombre: 'IVA mensual (régimen general)',
        periodicidad: 'mensual',
        regimenes: ['utilidades', 'opcional_simplificado'],
        parametro_plazo: 'iva_declaracion',
        fuente: 'inv. A.1 (Ley IVA, art. 40)',
    },
    {
        impuesto: 'pc_mensual',
        nombre: 'Pequeño contribuyente mensual (aunque no haya ventas)',
        periodicidad: 'mensual',
        regimenes: ['pequeno_contribuyente'],
        parametro_plazo: 'pc_declaracion',
        fuente: 'inv. A.3 (Ley IVA, art. 48)',
    },
    {
        impuesto: 'isr_opcional_mensual',
        nombre: 'ISR régimen opcional simplificado mensual',
        periodicidad: 'mensual',
        regimenes: ['opcional_simplificado'],
        parametro_plazo: 'isr_opcional_plazo',
        fuente: 'inv. A.2 (LAT, art. 49)',
    },
    {
        impuesto: 'isr_trimestral',
        nombre: 'ISR pago trimestral (régimen sobre utilidades)',
        periodicidad: 'trimestral',
        regimenes: ['utilidades'],
        parametro_plazo: 'isr_trimestral_plazo',
        fuente: 'inv. A.2 (LAT, art. 38)',
    },
    {
        impuesto: 'iso_trimestral',
        nombre: 'Impuesto de Solidaridad trimestral',
        periodicidad: 'trimestral',
        regimenes: ['utilidades'],
        parametro_plazo: 'iso_plazo',
        fuente: 'inv. A.4',
    },
    {
        impuesto: 'isr_anual',
        nombre: 'ISR anual (régimen sobre utilidades)',
        periodicidad: 'anual',
        regimenes: ['utilidades'],
        parametro_plazo: 'isr_anual_plazo',
        fuente: 'inv. A.2 (LAT, art. 39)',
    },
    {
        impuesto: 'retenciones_iva',
        nombre: 'Retenciones de IVA (agente de retención)',
        periodicidad: 'mensual',
        regimenes: TODOS,
        condicion: 'agente_retencion_iva',
        parametro_plazo: 'ret_iva_plazo',
        fuente: 'inv. A.1',
    },
    {
        impuesto: 'retenciones_isr',
        nombre: 'Retenciones de ISR (quien retenga)',
        periodicidad: 'mensual',
        regimenes: TODOS,
        condicion: 'retuvo_isr',
        parametro_plazo: 'isr_retenciones_plazo',
        fuente: 'inv. A.2 (LAT, arts. 48, 94 y 105)',
    },
]

/** Obligaciones del paquete por país (hoy solo GT). */
export const OBLIGACIONES_POR_PAIS: Readonly<Record<string, readonly DefinicionObligacion[]>> = {
    GT: OBLIGACIONES_GT,
}
