import vine from '@vinejs/vine'
import { errors as erroresVine } from '@vinejs/vine'
import { ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { reglasPaginacion } from '#shared/paginacion'
import { dinero, empresasConsulta, fechaIso, idEntidad, motivo, versionEsperada } from '#shared/validadores'
import { ESTADOS_REFERIDO } from '#lealtad/referidos'
import { TIPOS_DESCUENTO, TIPOS_PREMIO } from '#lealtad/premios'
import { ESTADOS_CANJE } from '#lealtad/canjes'
import { ESTADOS_REQUISITO, ESTADOS_SORTEO, TIPOS_PREMIO_SORTEO } from '#lealtad/sorteos'
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
        visible_portal: vine
            .boolean()
            .optional()
            .meta({ description: 'El cliente ve sus puntos en el portal' }),
        canje_portal: vine
            .boolean()
            .optional()
            .meta({ description: 'El cliente canjea desde el portal (necesita visible_portal)' }),
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
    sorteo_id: idEntidad()
        .nullable()
        .optional()
        .meta({ description: 'Solo boletos: el sorteo (que admita canjes)' }),
    boletos: vine
        .number()
        .withoutDecimals()
        .range([1, 1000])
        .nullable()
        .optional()
        .meta({ description: 'Solo boletos: cuántos da cada canje' }),
    en_portal: vine.boolean().optional(),
    activo: vine.boolean().optional(),
}

export const crearPremioValidator = vine.compile(
    vine.object({
        programa_id: idEntidad(),
        tipo: vine.enum(TIPOS_PREMIO).meta({
            description:
                'descuento_factura (descuento_tipo y descuento_valor), mes_gratis, mejora_plan (plan_destino_id y dias), bien, boletos (sorteo_id y boletos)',
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
            description:
                'Solo descuentos: aplicarlo a una factura ya emitida con nota de crédito (NCRE con FEL)',
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

/*
| Sorteos (fase 3, §7 y §8)
*/

const basesSorteo = vine
    .object({
        mecanica: vine.string().trim().maxLength(4000).optional(),
        regla_participacion: vine.string().trim().maxLength(2000).optional().meta({
            description: 'Cómo se ganan boletos; es lo que ve el cliente en el portal',
        }),
        plazo_reclamo_dias: vine.number().withoutDecimals().range([1, 365]).optional(),
        no_reclamados: vine.string().trim().maxLength(2000).optional(),
        publicacion_resultados: vine.string().trim().maxLength(2000).optional(),
        resolucion_gobernacion: vine.string().trim().maxLength(200).nullable().optional(),
        fuente_valor_publico: vine.string().trim().maxLength(1000).optional().meta({
            description:
                'Fuente pública del valor del acto (p. ej. «números del sorteo X de la Lotería Santa Lucía del día D»); congelada con bases_hash',
        }),
    })
    .optional()
    .meta({ description: 'Bases (§7.2); todas obligatorias para publicar salvo la resolución' })

const criteriosSorteo = vine
    .object({
        boletos_por_servicio: vine.number().withoutDecimals().range([0, 100]).optional().meta({
            description: 'Boletos por servicio activo sin facturas vencidas al corte (por defecto 1)',
        }),
        admite_canje: vine.boolean().optional().meta({ description: 'Admite boletos canjeados con puntos' }),
    })
    .optional()

const premioSorteo = vine.object({
    nombre: vine.string().trim().minLength(1).maxLength(200),
    cantidad: vine.number().withoutDecimals().range([1, 100]).optional(),
    imagen_url: vine.string().trim().maxLength(1000).nullable().optional().meta({
        description: 'Solo null: la imagen se sube (POST /lealtad/sorteos/:id/premios/:posicion/imagen)',
    }),
    valor: dinero(),
    tipo: vine.enum(TIPOS_PREMIO_SORTEO).meta({
        description:
            'efectivo (egreso de Caja o Bancos), bien (5.1.03 / 2.1.03 o una cuenta de activo) o servicio (canje sin puntos)',
    }),
    premio_id: idEntidad().nullable().optional().meta({
        description: 'Solo servicio: descuento o mes gratis del catálogo de lealtad de la empresa',
    }),
    retiene_isr: vine.boolean().optional(),
    isr_pct: vine
        .string()
        .trim()
        .regex(/^\d{1,3}(\.\d{1,2})?$/)
        .nullable()
        .optional()
        .meta({ description: 'Porcentaje del ISR del premio (10 por defecto)' }),
})

const camposSorteo = {
    descripcion: vine.string().trim().maxLength(4000).nullable().optional(),
    bases: basesSorteo,
    criterios: criteriosSorteo,
    inscripcion_desde: fechaIso().nullable().optional(),
    corte_en: vine
        .date({ formats: ['iso8601'] })
        .nullable()
        .optional()
        .meta({ type: 'string', format: 'date-time' }),
    fecha_sorteo: vine
        .date({ formats: ['iso8601'] })
        .nullable()
        .optional()
        .meta({ type: 'string', format: 'date-time' }),
    lugar: vine.string().trim().maxLength(300).nullable().optional(),
    suplentes: vine.number().withoutDecimals().range([0, 20]).optional(),
    premios: vine.array(premioSorteo).maxLength(50).optional(),
    aviso_portal: vine
        .boolean()
        .optional()
        .meta({ description: 'Se anuncia en el portal (false por defecto)' }),
}

export const crearSorteoValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad().nullable().optional(),
        nombre: vine.string().trim().minLength(1).maxLength(200),
        ...camposSorteo,
    }),
)

export const editarSorteoValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        nombre: vine.string().trim().minLength(1).maxLength(200).optional(),
        ...camposSorteo,
    }),
)

export const listarSorteosValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        estado: vine.enum(ESTADOS_SORTEO).optional(),
    }),
)

export const marcarRequisitoValidator = vine.compile(
    vine.object({
        estado: vine.enum(ESTADOS_REQUISITO),
        valor: vine.string().trim().maxLength(500).nullable().optional().meta({
            description: 'Número de resolución, monto de la fianza…',
        }),
        evidencia: vine.string().trim().maxLength(2000).nullable().optional().meta({
            description:
                'Obligatoria con cumplido o no_aplica: referencia o texto (archivos en la segunda PR)',
        }),
        archivo_id: idEntidad().nullable().optional().meta({
            description:
                'Evidencia como archivo de este sorteo (POST /lealtad/sorteos/:id/archivos, uso evidencia)',
        }),
        nota: vine.string().trim().maxLength(2000).nullable().optional(),
    }),
)

export const avisoPortalSorteoValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        aviso_portal: vine.boolean(),
    }),
)

export const subirArchivoSorteoValidator = vine.compile(
    vine.object({
        uso: vine.enum(['evidencia', 'constancia'] as const).meta({
            description: 'evidencia del checklist o constancia firmada de una entrega',
        }),
    }),
)

/** campos de texto del multipart de la imagen de un premio (solo el archivo `imagen`) */
export const imagenPremioSorteoValidator = vine.compile(vine.object({}))

export const cerrarActaSorteoValidator = vine.compile(
    vine.object({
        constancia: vine.string().trim().minLength(3).maxLength(2000).meta({
            description: 'Firma o constancia del notario o del delegado',
        }),
    }),
)

export const participantesSorteoValidator = vine.compile(
    vine.object({
        formato: vine
            .enum(['json', 'csv', 'xlsx'] as const)
            .optional()
            .meta({ description: 'json (por defecto), csv o xlsx (descarga, con lista_hash al pie)' }),
    }),
)

export const ejecutarSorteoValidator = vine.compile(
    vine.object({
        valor_publico: vine.string().trim().minLength(1).maxLength(500).meta({
            description:
                'El valor de la fuente declarada en las bases (bases.fuente_valor_publico), conocido en el acto',
        }),
        valor_publico_evidencia: vine.string().trim().minLength(3).maxLength(2000).meta({
            description:
                'Cómo se obtuvo el valor (acta del notario, enlace o número de la publicación oficial)',
        }),
        asistentes: vine
            .array(
                vine.object({
                    nombre: vine.string().trim().minLength(1).maxLength(200),
                    rol: vine.string().trim().maxLength(200).nullable().optional(),
                }),
            )
            .maxLength(20)
            .optional(),
    }),
)

export const entregarPremioValidator = vine.compile(
    vine.object({
        metodo: vine
            .enum(['caja', 'banco', 'cuenta_bancaria'] as const)
            .nullable()
            .optional()
            .meta({
                description: 'Solo efectivo: de dónde sale el dinero (como POST /egresos)',
            }),
        caja_id: idEntidad().nullable().optional(),
        banco_id: idEntidad().nullable().optional(),
        cuenta_bancaria_id: idEntidad().nullable().optional(),
        contrapartida: vine
            .enum(['compra', 'proveedor', 'cuenta'] as const)
            .nullable()
            .optional()
            .meta({
                description:
                    'Solo bien: compra (compra_linea_id: el bien se compró con factura; gasto 5.1.03 por la base sin IVA) o cuenta (cuenta_codigo de activo fuera de las cuentas control, p. ej. inventario de premios); proveedor responde 422 (registra la compra)',
            }),
        cuenta_codigo: vine.string().trim().maxLength(30).nullable().optional(),
        constancia_archivo_id: idEntidad().nullable().optional().meta({
            description:
                'Constancia firmada de la entrega (POST /lealtad/sorteos/:id/archivos, uso constancia)',
        }),
        compra_linea_id: idEntidad().nullable().optional().meta({
            description: 'Con contrapartida compra: línea (bien) de una compra registrada de la empresa',
        }),
        unidades: vine.number().withoutDecimals().min(1).nullable().optional().meta({
            description:
                'Con contrapartida compra: unidades de la línea que se entregan (1 por defecto); sin pasar de su cantidad',
        }),
        nota: vine.string().trim().maxLength(2000).nullable().optional(),
    }),
)
