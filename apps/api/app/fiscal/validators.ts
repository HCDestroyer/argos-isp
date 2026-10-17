import vine from '@vinejs/vine'
import { empresasConsulta, fechaIso, idEntidad, motivo, versionEsperada } from '#shared/validadores'

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
