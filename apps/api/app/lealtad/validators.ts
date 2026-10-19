import vine from '@vinejs/vine'
import { errors as erroresVine } from '@vinejs/vine'
import { ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { reglasPaginacion } from '#shared/paginacion'
import { dinero, empresasConsulta, fechaIso, idEntidad, motivo, versionEsperada } from '#shared/validadores'
import { ESTADOS_REFERIDO } from '#lealtad/referidos'
import { TIPOS_DESCUENTO, TIPOS_PREMIO } from '#lealtad/premios'
import { ESTADOS_CANJE } from '#lealtad/canjes'
import { completarCondiciones, TIPOS_REGLA, type CondicionesPorTipo, type TipoRegla } from '#lealtad/reglas'

/**
 * Validadores VineJS del programa de lealtad. `condiciones` tiene un esquema por `tipo`
 * (contrato §4): el alta de una regla se publica en el OpenAPI como unión por `tipo`; la edición
 * valida `condiciones` en la acción con el esquema del tipo de la regla.
 */

const porcentaje = () =>
    vine
        .string()
        .trim()
        .regex(/^\d{1,3}(\.\d{1,6})?$/)
        .meta({
            description: 'Porcentaje de 0 a 100 con hasta 6 decimales, como string',
            examples: ['100', '80.5'],
        })

const camposPrograma = {
    nombre: vine.string().trim().minLength(1).maxLength(120),
    valor_punto: vine
        .string()
        .trim()
        .regex(/^\d{1,12}(\.\d{1,2})?$/)
        .meta({ description: 'Q por punto con hasta 2 decimales, como string', examples: ['0.10'] }),
    diferimiento: vine.boolean().optional().meta({
        description:
            'NIIF 15: true = los puntos son un pasivo (2.1.10) y llevan asientos; false (por defecto) = solo un indicador',
    }),
    canje_esperado_pct: porcentaje().optional(),
    vencimiento_meses: vine
        .number()
        .withoutDecimals()
        .range([1, 120])
        .nullable()
        .optional()
        .meta({ description: 'Meses desde la acumulación (por defecto 12); null = los puntos no vencen' }),
    aviso_vencimiento_dias: vine.number().withoutDecimals().range([0, 365]).optional(),
    minimo_canje: vine.number().withoutDecimals().min(0).optional(),
    terminos: vine.string().trim().maxLength(20000).optional().meta({
        description:
            'Términos publicados en el portal; deben decir el plazo de vencimiento (inv. F.4, art. 24)',
    }),
    vigente_desde: fechaIso().optional(),
    vigente_hasta: fechaIso().nullable().optional(),
}

export const crearProgramaValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad()
            .optional()
            .meta({ description: 'Empresa del programa; por defecto la activa' }),
        ...camposPrograma,
    }),
)

export const editarProgramaValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        nombre: camposPrograma.nombre.optional(),
        valor_punto: dinero().optional(),
        diferimiento: camposPrograma.diferimiento,
        canje_esperado_pct: porcentaje().optional(),
        vencimiento_meses: camposPrograma.vencimiento_meses,
        aviso_vencimiento_dias: camposPrograma.aviso_vencimiento_dias,
        minimo_canje: camposPrograma.minimo_canje,
        terminos: camposPrograma.terminos,
        vigente_desde: fechaIso().optional(),
        vigente_hasta: fechaIso().nullable().optional(),
    }),
)

export const motivoValidator = vine.compile(vine.object({ motivo: motivo() }))

export const listarProgramasValidator = vine.compile(vine.object({ empresas: empresasConsulta() }))

/*
| Condiciones por tipo (§4)
*/

const diasNoNegativos = () => vine.number().withoutDecimals().min(0)
const positivo = () => vine.number().withoutDecimals().min(1)

const ESQUEMAS_CONDICIONES = {
    pago_a_tiempo: vine.object({
        dias_antes_vencimiento: diasNoNegativos().max(365).optional(),
        solo_servicio: vine.boolean().optional(),
        sin_promesa: vine.boolean().optional(),
        racha: vine
            .object({ periodos: positivo().max(120), puntos_extra: positivo() })
            .nullable()
            .optional()
            .meta({ description: 'Bono cada vez que se completan `periodos` facturas seguidas a tiempo' }),
        monto_minimo: dinero().nullable().optional(),
    }),
    antiguedad: vine.object({
        cada_meses: positivo().max(240).optional(),
        sin_vencidas_mas_de_dias: diasNoNegativos().nullable().optional(),
        estados_validos: vine
            .array(vine.enum(['activo', 'limitado', 'suspendido'] as const))
            .minLength(1)
            .optional(),
    }),
    referido: vine.object({
        facturas_pagadas_minimas: positivo().max(60).optional(),
        dias_maximos: positivo().nullable().optional(),
        tope_por_referidor: positivo().nullable().optional(),
        puntos_referido: diasNoNegativos().optional(),
    }),
    pago_adelantado: vine.object({
        periodos_minimos: positivo().max(60).optional(),
        puntos_por_periodo: diasNoNegativos().optional(),
    }),
} as const

const VALIDADORES_CONDICIONES = Object.fromEntries(
    Object.entries(ESQUEMAS_CONDICIONES).map(([tipo, esquema]) => [tipo, vine.compile(esquema)]),
) as unknown as Record<TipoRegla, ReturnType<typeof vine.compile>>

/** Valida y completa `condiciones` con el esquema del tipo (422 en `condiciones.<campo>`). */
export async function validarCondiciones<T extends TipoRegla>(
    tipo: T,
    condiciones: unknown,
): Promise<CondicionesPorTipo[T]> {
    try {
        const validas = await VALIDADORES_CONDICIONES[tipo].validate(condiciones ?? {})
        return completarCondiciones(tipo, validas as Partial<CondicionesPorTipo[T]>)
    } catch (error) {
        if (error instanceof erroresVine.E_VALIDATION_ERROR) {
            const errores = (error.messages as ErrorCampo[]).map((m) => ({
                ...m,
                field: m.field ? `condiciones.${m.field}` : 'condiciones',
            }))
            throw new ValidacionFallida(errores)
        }
        throw error
    }
}

const camposRegla = {
    recompensa: vine
        .enum(['puntos'] as const)
        .optional()
        .meta({ description: 'Fase 1: solo puntos (premio y boletos llegan con canjes y sorteos)' }),
    puntos: vine.number().withoutDecimals().min(0).max(1_000_000),
    tope_por_cliente: positivo().nullable().optional().meta({
        description: 'Otorgamientos de esta regla por cliente en cada periodo_tope; null = sin tope',
    }),
    periodo_tope: vine
        .enum(['mes', 'anio'] as const)
        .nullable()
        .optional(),
    activa: vine.boolean().optional(),
    vigente_desde: fechaIso().optional(),
    vigente_hasta: fechaIso().nullable().optional(),
}

/** Alta de regla: unión por `tipo`, cada una con su esquema de `condiciones`. */
export const crearReglaValidator = vine.compile(
    vine
        .union(
            TIPOS_REGLA.map((tipo) =>
                vine.union.if(
                    (valor) =>
                        vine.helpers.isObject(valor) && (valor as Record<string, unknown>).tipo === tipo,
                    vine.object({
                        programa_id: idEntidad(),
                        tipo: vine.literal(tipo),
                        condiciones: ESQUEMAS_CONDICIONES[tipo].optional(),
                        ...camposRegla,
                    }),
                ),
            ),
        )
        .otherwise((_valor, campo) => {
            // el error va en `tipo` (no en la raíz del cuerpo)
            campo.report(`tipo debe ser uno de: ${TIPOS_REGLA.join(', ')}`, 'tipo', {
                ...campo,
                name: 'tipo',
                wildCardPath: 'tipo',
                getFieldPath: () => 'tipo',
            })
        }),
)

export const editarReglaValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        condiciones: vine
            .object({})
            .allowUnknownProperties()
            .optional()
            .meta({ description: 'Condiciones del tipo de la regla (mismo esquema que en el alta, §4)' }),
        recompensa: camposRegla.recompensa,
        puntos: camposRegla.puntos.optional(),
        tope_por_cliente: camposRegla.tope_por_cliente,
        periodo_tope: camposRegla.periodo_tope,
        activa: camposRegla.activa,
        vigente_desde: camposRegla.vigente_desde,
        vigente_hasta: camposRegla.vigente_hasta,
    }),
)

export const listarReglasValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        programa_id: idEntidad().optional(),
        tipo: vine.enum(TIPOS_REGLA).optional(),
        activa: vine.boolean().optional(),
    }),
)

/*
| Puntos, ajustes y referidos
*/

export const puntosClienteValidator = vine.compile(vine.object({ ...reglasPaginacion }))

export const ajusteValidator = vine.compile(
    vine.object({
        cliente_id: idEntidad(),
        servicio_id: idEntidad().optional(),
        puntos: vine.number().withoutDecimals().range([-1_000_000, 1_000_000]).meta({
            description:
                'Con signo, distinto de 0: positivo agrega un lote, negativo descuenta (sin dejar saldo negativo)',
        }),
        motivo: motivo(),
    }),
)

export const listarReferidosValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        estado: vine.enum(ESTADOS_REFERIDO).optional(),
        referidor_id: idEntidad().optional(),
        referido_id: idEntidad().optional(),
    }),
)

export const reporteLealtadValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        desde: fechaIso().optional(),
        hasta: fechaIso().optional(),
    }),
)

/*
| Premios y canjes (fase 2)
*/

const camposPremio = {
    nombre: vine.string().trim().minLength(1).maxLength(120),
    costo_puntos: vine.number().withoutDecimals().range([1, 10_000_000]),
    descuento_tipo: vine.enum(TIPOS_DESCUENTO).nullable().optional(),
    descuento_valor: dinero().nullable().optional(),
    tope: dinero().nullable().optional(),
    plan_destino_id: idEntidad().nullable().optional(),
    dias: vine.number().withoutDecimals().range([1, 366]).nullable().optional(),
    costo_unitario: dinero().nullable().optional(),
    existencias: vine.number().withoutDecimals().min(0).nullable().optional(),
    en_portal: vine.boolean().optional(),
    activo: vine.boolean().optional(),
}

export const crearPremioValidator = vine.compile(
    vine.object({
        programa_id: idEntidad(),
        tipo: vine.enum(TIPOS_PREMIO).meta({
            description:
                'descuento_factura (descuento_tipo y descuento_valor), mes_gratis, mejora_plan (plan_destino_id y dias), bien; boletos llega en la fase 3',
        }),
        ...camposPremio,
    }),
)

export const editarPremioValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        ...camposPremio,
        nombre: camposPremio.nombre.optional(),
        costo_puntos: vine.number().withoutDecimals().range([1, 10_000_000]).optional(),
    }),
)

export const listarPremiosValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        programa_id: idEntidad().optional(),
        tipo: vine.enum(TIPOS_PREMIO).optional(),
        activo: vine.boolean().optional(),
        en_portal: vine.boolean().optional(),
    }),
)

export const canjearValidator = vine.compile(
    vine.object({
        cliente_id: idEntidad(),
        servicio_id: idEntidad(),
        premio_id: idEntidad(),
        factura_id: idEntidad().optional().meta({
            description: 'Solo descuentos: aplicarlo a una factura ya emitida con nota de crédito (NCRE con FEL)',
        }),
    }),
)

export const listarCanjesValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        cliente_id: idEntidad().optional(),
        servicio_id: idEntidad().optional(),
        estado: vine.enum(ESTADOS_CANJE).optional(),
    }),
)
