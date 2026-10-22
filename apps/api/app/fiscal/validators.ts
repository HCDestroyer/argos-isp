import vine from '@vinejs/vine'
import { empresasConsulta, fechaIso, idEntidad, motivo, versionEsperada } from '#shared/validadores'
import { reglasPaginacion } from '#shared/paginacion'

/**
 * Validadores VineJS del módulo fiscal (de aquí sale el OpenAPI). Las reglas de negocio (rango del
 * parámetro, régimen, signo del impuesto) las valida cada acción con 422 por campo.
 */

const empresaOpcional = () =>
    idEntidad().nullable().optional().meta({ description: 'Empresa; por defecto la activa (X-Empresa-Id)' })

const ambito = () =>
    vine
        .enum(['empresa', 'global'] as const)
        .optional()
        .meta({
            description:
                'empresa (por defecto): de la empresa activa o empresa_id. global: de toda la instalación (alcance global; no en parámetros de alcance E)',
        })

export const consultaFechaValidator = vine.compile(
    vine.object({
        fecha: fechaIso()
            .optional()
            .meta({ description: 'Fecha de vigencia (YYYY-MM-DD); por defecto hoy en Guatemala' }),
        empresa_id: empresaOpcional(),
    }),
)

export const actualizarLocalizacionValidator = vine.compile(
    vine.object({
        codigo: vine
            .string()
            .trim()
            .regex(/^[a-z]{2}-\d{4}\.\d+$/)
            .optional()
            .meta({ description: 'Versión del paquete (gt-2026.1); por defecto la más reciente del país' }),
    }),
)

export const editarParametroValidator = vine.compile(
    vine.object({
        valor: vine.any().meta({
            // `object` sin más queda `Record<string, never>` en los tipos generados (pedido de A4)
            anyOf: [
                { type: 'string' },
                { type: 'number' },
                { type: 'boolean' },
                { type: 'array', items: {} },
                { type: 'object', additionalProperties: true },
            ],
            description:
                'Valor según el tipo del parámetro: porcentaje y monto como string decimal ("12.00", "2500.00"), entero, bool, fecha YYYY-MM-DD, texto, una de las opciones (enum) u objeto/lista con la forma del valor del paquete (json)',
        }),
        vigente_desde: fechaIso(),
        motivo: motivo(),
        ambito: ambito(),
        empresa_id: empresaOpcional(),
    }),
)

export const editarImpuestoValidator = vine.compile(
    vine.object({
        tasa: vine
            .string()
            .trim()
            .regex(/^\d{1,3}(\.\d{1,6})?$/)
            .meta({ description: 'Por ciento positivo ("15.00"); el signo de la retención es del impuesto' }),
        vigente_desde: fechaIso(),
        motivo: motivo(),
        activo: vine
            .boolean()
            .optional()
            .meta({ description: 'false = el impuesto deja de aplicar desde vigente_desde' }),
        ambito: ambito(),
        empresa_id: empresaOpcional(),
    }),
)

export const cambiarRegimenValidator = vine.compile(
    vine.object({
        regimen: vine.enum(['utilidades', 'opcional_simplificado', 'pequeno_contribuyente'] as const),
        vigente_desde: fechaIso(),

        aviso_sat: vine
            .object({
                numero: vine.string().trim().minLength(1).maxLength(60),
                fecha: fechaIso(),
            })
            .nullable()
            .optional()
            .meta({ description: 'Aviso a la SAT (LAT, art. 51); obligatorio en un cambio' }),
        motivo: vine.string().trim().maxLength(500).nullable().optional(),
        empresa_id: empresaOpcional(),
    }),
)

const camposEstablecimiento = {
    nombre: vine.string().trim().minLength(1).maxLength(150),
    direccion: vine.string().trim().maxLength(300).nullable().optional(),
    municipio: vine.string().trim().maxLength(100).nullable().optional(),
    departamento: vine.string().trim().maxLength(100).nullable().optional(),
    por_defecto: vine
        .boolean()
        .optional()
        .meta({ description: 'Establecimiento con el que se emite (uno por empresa)' }),
}

export const crearEstablecimientoValidator = vine.compile(
    vine.object({
        codigo: vine
            .number()
            .withoutDecimals()
            .min(1)
            .meta({ description: 'Código de establecimiento asignado por la SAT' }),
        ...camposEstablecimiento,
        empresa_id: empresaOpcional(),
    }),
)

export const editarEstablecimientoValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        nombre: camposEstablecimiento.nombre.optional(),
        direccion: camposEstablecimiento.direccion,
        municipio: camposEstablecimiento.municipio,
        departamento: camposEstablecimiento.departamento,
        activo: vine.boolean().optional(),
        por_defecto: camposEstablecimiento.por_defecto,
    }),
)

export const listarEstablecimientosValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
    }),
)

export const agregarFraseValidator = vine.compile(
    vine.object({
        tipo_frase: vine.number().withoutDecimals().min(1),
        escenario: vine.number().withoutDecimals().min(1),
        texto: vine.string().trim().maxLength(500).nullable().optional().meta({
            description: 'Obligatorio al agregar; al retirar (activa = false) se toma el vigente',
        }),
        tipos_dte: vine.array(vine.string().trim().toUpperCase()).nullable().optional(),
        vigente_desde: fechaIso(),
        activa: vine
            .boolean()
            .optional()
            .meta({ description: 'false = la frase deja de aplicar desde vigente_desde' }),
        resolucion: vine
            .object({ numero: vine.string().trim().minLength(1).maxLength(60), fecha: fechaIso() })
            .nullable()
            .optional()
            .meta({ description: 'Resolución de la SAT (pago directo)' }),
        motivo: motivo(),
        empresa_id: empresaOpcional(),
    }),
)

/*
| FEL (fase 3, contrato §8 y §11.1)
*/

export const consultaEmpresaValidator = vine.compile(vine.object({ empresa_id: empresaOpcional() }))

export const configurarFelValidator = vine.compile(
    vine.object({
        empresa_id: empresaOpcional(),
        proveedor: vine
            .enum(['infile', 'falso'] as const)
            .nullable()
            .meta({
                description: 'Certificador; falso solo en pruebas. Obligatorio salvo con modo desactivada',
            }),
        ambiente: vine.enum(['pruebas', 'produccion'] as const),
        modo: vine.enum(['obligatoria', 'opcional', 'desactivada'] as const),
        version: vine.number().withoutDecimals().min(0).meta({
            description: 'version leída (0 si la empresa nunca se configuró); si cambió responde 409',
        }),
    }),
)

export const credencialesFelValidator = vine.compile(
    vine.object({
        empresa_id: empresaOpcional(),
        proveedor: vine.enum(['infile', 'falso'] as const).optional(),
        credenciales: vine.record(vine.string().trim().maxLength(500)).meta({
            description:
                'Campos del certificador (infile: usuario_firma, llave_firma, usuario_api, llave_api, correo_copia; falso: usuario, llave). Nunca se devuelven ni se auditan',
        }),
    }),
)

export const contingenciaFelValidator = vine.compile(
    vine.object({ empresa_id: empresaOpcional(), motivo: motivo() }),
)

export const listarDteValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        estado: vine
            .array(
                vine.enum([
                    'pendiente',
                    'enviando',
                    'certificado',
                    'error_temporal',
                    'rechazado',
                    'contingencia',
                    'anulacion_pendiente',
                    'anulado',
                ] as const),
            )
            // `?estado=x` (uno) o `?estado=x&estado=y` / `?estado[]=x&estado[]=y` (varios)
            .parse((valor) =>
                valor === undefined || valor === null || Array.isArray(valor) ? valor : [valor],
            )
            .optional()
            .meta({ description: 'Uno o varios estados (se repite el parámetro): cualquiera de ellos' }),
        desde: fechaIso()
            .optional()
            .meta({ description: 'Fecha de emisión desde (inclusive, en Guatemala)' }),
        hasta: fechaIso()
            .optional()
            .meta({ description: 'Fecha de emisión hasta (inclusive, en Guatemala)' }),
        documento_tipo: vine.enum(['factura', 'nota_credito', 'nota_debito'] as const).optional(),
        documento_id: idEntidad().optional(),
    }),
)

export const loteFelValidator = vine.compile(
    vine.object({
        empresa_id: empresaOpcional(),
        facturas: vine
            .array(idEntidad())
            .minLength(1)
            .maxLength(500)
            .optional()
            .meta({ description: 'Facturas a certificar; o desde/hasta (fecha de emisión, Guatemala)' }),
        desde: fechaIso().optional(),
        hasta: fechaIso().optional(),
    }),
)

// ---------------------------------------------------------------------------------------------
// Calendario fiscal (fase 7 PR A)
// ---------------------------------------------------------------------------------------------

/** `?x=a` (uno) o `?x=a&x=b` (varios) → lista. */
const repetible = (valor: unknown) =>
    valor === undefined || valor === null || Array.isArray(valor) ? valor : [valor]

export const listarObligacionesValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        impuesto: vine
            .array(
                vine.enum([
                    'iva_mensual',
                    'pc_mensual',
                    'isr_opcional_mensual',
                    'isr_trimestral',
                    'iso_trimestral',
                    'isr_anual',
                    'retenciones_iva',
                    'retenciones_isr',
                ] as const),
            )
            .parse(repetible)
            .optional()
            .meta({ description: 'Uno o varios impuestos (se repite el parámetro)' }),
        estado: vine
            .array(vine.enum(['pendiente', 'borrador', 'presentada', 'no_aplica'] as const))
            .parse(repetible)
            .optional()
            .meta({ description: 'Uno o varios estados (se repite el parámetro); por defecto todos' }),
        desde: fechaIso().optional().meta({ description: 'Vence desde (inclusive)' }),
        hasta: fechaIso().optional().meta({ description: 'Vence hasta (inclusive)' }),
    }),
)

export const consultaFeriadosValidator = vine.compile(
    vine.object({
        anio: vine
            .number()
            .withoutDecimals()
            .range([2000, 2100])
            .optional()
            .meta({ description: 'Año; por defecto el año en curso (Guatemala)' }),
    }),
)

export const agregarFeriadoValidator = vine.compile(
    vine.object({
        fecha: fechaIso(),
        nombre: vine.string().trim().maxLength(120).nullable().optional().meta({
            description: 'Obligatorio al agregar; al retirar (activo = false) se toma el vigente',
        }),
        activo: vine
            .boolean()
            .optional()
            .meta({ description: 'false = la fecha deja de ser feriado (fila nueva; nada se borra)' }),
        motivo: motivo(),
    }),
)
