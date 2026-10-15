import vine, { errors as erroresVine } from '@vinejs/vine'
import { ValidacionFallida } from '#shared/errores'
import { dinero } from '#shared/validadores'
import {
    normalizarReglasPromesa,
    reglasPromesaSchema,
    type ReglasPromesa,
    type ReglasPromesaParciales,
} from '#billing/reglas_promesa'

/**
 * Excepciones a la plantilla de facturación por servicio (`core.servicios_excepciones`).
 *
 * A1 guarda las filas `(servicio_id, campo, valor jsonb)` y expone la configuración efectiva; A3
 * define **qué campos** se pueden exceptuar y cómo se validan y combinan. A1 debe:
 *   - validar con `validarExcepcion(campo, valor)` antes de guardar (lanza 422);
 *   - calcular la configuración efectiva con `aplicarExcepciones(plantilla, filas)`.
 *
 * No son exceptuables `nombre` ni `ciclo` (cambiar el ciclo de un servicio = cambiar de plantilla).
 * `reglas_promesa` se exceptúa parcialmente: el objeto se combina clave a clave sobre el de la
 * plantilla.
 */

export const CAMPOS_EXCEPCION = [
    'dia',
    'prorrateo',
    'dias_gracia',
    'facturas_para_limitar',
    'facturas_para_cortar',
    'mora_tipo',
    'mora_valor',
    'mora_recurrente',
    'hora_corte',
    'certificar_al',
    'reglas_promesa',
] as const
export type CampoExcepcion = (typeof CAMPOS_EXCEPCION)[number]

export function esCampoExcepcion(campo: string): campo is CampoExcepcion {
    return (CAMPOS_EXCEPCION as readonly string[]).includes(campo)
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/

const VALIDADORES: Record<CampoExcepcion, ReturnType<typeof vine.compile>> = {
    dia: vine.compile(vine.object({ valor: vine.number().withoutDecimals().range([1, 28]) })),
    prorrateo: vine.compile(vine.object({ valor: vine.boolean({ strict: true }) })),
    dias_gracia: vine.compile(vine.object({ valor: vine.number().withoutDecimals().range([0, 90]) })),
    facturas_para_limitar: vine.compile(
        vine.object({ valor: vine.number().withoutDecimals().range([0, 24]) }),
    ),
    facturas_para_cortar: vine.compile(
        vine.object({ valor: vine.number().withoutDecimals().range([1, 24]) }),
    ),
    mora_tipo: vine.compile(vine.object({ valor: vine.enum(['ninguna', 'fija', 'porcentaje'] as const) })),
    mora_valor: vine.compile(vine.object({ valor: dinero() })),
    mora_recurrente: vine.compile(vine.object({ valor: vine.boolean({ strict: true }) })),
    hora_corte: vine.compile(vine.object({ valor: vine.string().trim().regex(HORA) })),
    certificar_al: vine.compile(vine.object({ valor: vine.enum(['emitir', 'pagar', 'nunca'] as const) })),
    reglas_promesa: vine.compile(vine.object({ valor: reglasPromesaSchema() })),
}

/**
 * Valida y normaliza el valor de una excepción. Devuelve el valor a guardar en `valor jsonb`.
 * Lanza `ValidacionFallida` (422) si el campo no es exceptuable o el valor no es válido.
 */
export async function validarExcepcion(campo: string, valor: unknown): Promise<unknown> {
    if (!esCampoExcepcion(campo)) {
        throw new ValidacionFallida([
            {
                field: 'campo',
                message: `El campo ${campo} no admite excepción; permitidos: ${CAMPOS_EXCEPCION.join(', ')}`,
                rule: 'campo_excepcion',
            },
        ])
    }
    try {
        const { valor: limpio } = (await VALIDADORES[campo].validate({ valor })) as { valor: unknown }
        return limpio
    } catch (error) {
        if (error instanceof erroresVine.E_VALIDATION_ERROR) {
            const mensajes = error.messages as Array<{ field: string; message: string; rule?: string }>
            throw new ValidacionFallida(
                mensajes.map((m) => ({
                    field: m.field,
                    message: m.message,
                    ...(m.rule ? { rule: m.rule } : {}),
                })),
            )
        }
        throw error
    }
}

/** Configuración de facturación que usan generarFacturas, vencerFacturas y evaluarEstadoServicio. */
export interface ConfiguracionFacturacion {
    plantilla_id: number
    nombre: string
    ciclo: 'dia_fijo' | 'aniversario'
    dia: number | null
    prorrateo: boolean
    dias_gracia: number
    facturas_para_limitar: number
    facturas_para_cortar: number
    mora_tipo: 'ninguna' | 'fija' | 'porcentaje'
    mora_valor: string
    mora_recurrente: boolean
    /** HH:MM, hora de Guatemala */
    hora_corte: string
    certificar_al: 'emitir' | 'pagar' | 'nunca'
    reglas_promesa: ReglasPromesa
    /** campos que vinieron de `servicios_excepciones` */
    excepciones: CampoExcepcion[]
}

export type PlantillaBase = Omit<ConfiguracionFacturacion, 'excepciones'>

/**
 * Aplica las excepciones de un servicio sobre su plantilla. Ignora campos no exceptuables
 * (filas viejas o inválidas) para no romper la facturación; la validación es al guardar.
 */
export function aplicarExcepciones(
    plantilla: PlantillaBase,
    filas: ReadonlyArray<{ campo: string; valor: unknown }>,
): ConfiguracionFacturacion {
    const efectiva: ConfiguracionFacturacion = {
        ...plantilla,
        reglas_promesa: normalizarReglasPromesa(plantilla.reglas_promesa),
        excepciones: [],
    }
    for (const { campo, valor } of filas) {
        if (!esCampoExcepcion(campo) || valor === null || valor === undefined) continue
        if (campo === 'reglas_promesa') {
            efectiva.reglas_promesa = normalizarReglasPromesa(
                valor as ReglasPromesaParciales,
                efectiva.reglas_promesa,
            )
        } else if (campo === 'hora_corte') {
            efectiva.hora_corte = String(valor).slice(0, 5)
        } else if (campo === 'mora_valor') {
            efectiva.mora_valor = String(valor)
        } else {
            ;(efectiva as unknown as Record<string, unknown>)[campo] = valor
        }
        efectiva.excepciones.push(campo)
    }
    if (efectiva.ciclo === 'aniversario') efectiva.dia = null
    efectiva.excepciones.sort()
    return efectiva
}
