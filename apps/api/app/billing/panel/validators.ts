import vine from '@vinejs/vine'
import { empresasConsulta, fechaIso, idEntidad, versionEsperada } from '#shared/validadores'

/** Validadores del panel financiero, el inicio por rol y los reportes programados (`contratos/reportes.md`). */

const mes = () =>
    vine
        .string()
        .trim()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
        .meta({
            description: 'Mes YYYY-MM (por defecto el mes en curso de Guatemala; un mes futuro = el actual)',
        })

const formato = vine
    .enum(['json', 'csv', 'xlsx', 'pdf'] as const)
    .optional()
    .meta({ description: 'json (por defecto), csv, xlsx o pdf (descarga con Content-Disposition)' })

export const panelValidator = vine.compile(
    vine.object({ empresas: empresasConsulta(), mes: mes().optional() }),
)

export const alertasValidator = vine.compile(vine.object({ empresas: empresasConsulta() }))

export const reporteBajasValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        formato,
        desde: fechaIso()
            .optional()
            .meta({ description: 'Mes inicial (cualquier día); por defecto hace 11 meses' }),
        hasta: fechaIso().optional().meta({ description: 'Mes final; por defecto hoy' }),
    }),
)

export const reporteIndicadoresValidator = vine.compile(
    vine.object({ empresas: empresasConsulta(), formato, mes: mes().optional() }),
)

export const ajustesPanelValidator = vine.compile(
    vine.object({
        dias_baja: vine.number().withoutDecimals().range([1, 365]).optional().meta({
            description:
                'Días de suspensión tras los que un servicio cuenta como baja (60 de fábrica). Ausente = sin cambio',
        }),
        aviso_pc_activo: vine.boolean().optional().meta({
            description:
                'Aviso de pequeño contribuyente en el panel del dueño (decisión 12, encendido de fábrica). Ausente = sin cambio',
        }),
        aviso_pc_umbrales: vine
            .array(
                vine
                    .string()
                    .trim()
                    .regex(/^\d{1,3}(\.\d{1,2})?$/)
                    .meta({ description: 'Porcentaje del límite anual, p. ej. "80.00"' }),
            )
            .minLength(1)
            .maxLength(5)
            .optional()
            .meta({
                description:
                    'Umbrales del aviso (80 y 95 % de fábrica, más 100 %). Se guardan como valor nuevo del parámetro fiscal pc_alertas de la empresa, vigente desde hoy: exige además fiscal.editar_parametros si cambian (403). Ausente = sin cambio',
            }),
        motivo: vine
            .string()
            .trim()
            .minLength(3)
            .maxLength(500)
            .optional()
            .meta({ description: 'Motivo del cambio de umbrales en el historial del parámetro' }),
        version: versionEsperada(),
    }),
)

export const INICIOS = ['panel_financiero', 'dia_a_dia'] as const
export type Inicio = (typeof INICIOS)[number]

export const elegirInicioValidator = vine.compile(
    vine.object({
        inicio: vine
            .enum(INICIOS)
            .nullable()
            .meta({ description: 'null = quitar la elección (vuelve a la de su rol o la de fábrica)' }),
        version: versionEsperada().optional(),
    }),
)

/*
|--------------------------------------------------------------------------
| Catálogo, favoritos y vistas
|--------------------------------------------------------------------------
*/

const codigoReporte = () =>
    vine
        .string()
        .trim()
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
        .maxLength(60)

export const guardarVistaValidator = vine.compile(
    vine.object({
        reporte: codigoReporte(),
        nombre: vine.string().trim().minLength(1).maxLength(80),
        filtros: vine
            .record(vine.any())
            .meta({ description: 'Filtros del reporte (se validan con los del reporte)' }),
        columnas: vine.array(vine.string().trim().maxLength(60)).maxLength(60).nullable().optional(),
        version: versionEsperada().optional(),
    }),
)

/*
|--------------------------------------------------------------------------
| Correos externos y envíos programados
|--------------------------------------------------------------------------
*/

export const aprobarCorreoValidator = vine.compile(
    vine.object({
        correo: vine.string().trim().toLowerCase().email().maxLength(254),
        nombre: vine.string().trim().minLength(1).maxLength(120),
    }),
)

const destinatarios = () =>
    vine
        .object({
            usuarios: vine.array(idEntidad()).maxLength(50).distinct().optional(),
            correos_externos: vine
                .array(idEntidad())
                .maxLength(50)
                .distinct()
                .optional()
                .meta({ description: 'Ids de la lista aprobada (GET /reportes/correos-externos)' }),
        })
        .meta({ description: 'Al menos un usuario o un correo de la lista aprobada' })

const camposEnvio = {
    nombre: vine.string().trim().minLength(1).maxLength(120),
    filtros: vine.record(vine.any()).optional(),
    formato: vine.enum(['pdf', 'xlsx', 'csv'] as const),
    frecuencia: vine.enum(['diaria', 'semanal', 'mensual'] as const),
    dia: vine
        .number()
        .withoutDecimals()
        .range([1, 28])
        .nullable()
        .optional()
        .meta({ description: 'semanal: 1 (lunes) a 7 (domingo); mensual: 1 a 28; diaria: null' }),
    hora: vine.number().withoutDecimals().range([0, 23]).meta({ description: 'Hora de Guatemala' }),
    destinatarios: destinatarios(),
}

export const crearEnvioValidator = vine.compile(
    vine.object({
        reporte: codigoReporte(),
        consolidado: vine.boolean().optional().meta({
            description: 'true = todas las empresas (solo con alcance global); si no, la empresa activa',
        }),
        ...camposEnvio,
    }),
)

export const editarEnvioValidator = vine.compile(
    vine.object({
        ...camposEnvio,
        activo: vine.boolean().optional(),
        version: versionEsperada(),
    }),
)

export const listarEnviosValidator = vine.compile(
    vine.object({ activo: vine.boolean().optional(), reporte: codigoReporte().optional() }),
)

export const corridasValidator = vine.compile(
    vine.object({ limit: vine.number().withoutDecimals().range([1, 100]).optional() }),
)
