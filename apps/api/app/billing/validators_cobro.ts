import vine from '@vinejs/vine'
import { reglasPaginacion } from '#shared/paginacion'
import { dinero, empresasConsulta, fechaIso, idEntidad, motivo, versionEsperada } from '#shared/validadores'
import { FORMATOS_IMPRESION } from '#ledger/cajas'
import { PAUSA_TOPE_MAXIMO } from '#billing/ajustes_cobro'
import { ESTADOS_BORRADOR } from '#ledger/borradores'
import {
    NOTA_GESTION_MAXIMO,
    ORIGENES_GESTION,
    RESULTADOS_GESTION,
    TIPOS_GESTION,
} from '#billing/gestiones_cobro'

/*
|--------------------------------------------------------------------------
| Decisiones del PM del 21 nov (operación de cobro, A3)
|--------------------------------------------------------------------------
*/

/** `POST /clientes/:id/gestiones-cobro` (contrato Iris 0.13.0). */
export const registrarGestionCobroValidator = vine.compile(
    vine.object({
        tipo: vine.enum(TIPOS_GESTION).meta({ description: 'carta solo desde el panel de Argos' }),
        resultado: vine.enum(RESULTADOS_GESTION),
        ocurrido_en: vine.date({ formats: ['iso8601'] }).meta({
            type: 'string',
            format: 'date-time',
            description:
                'Cuándo ocurrió: entre ahora − 7 días y ahora + 5 minutos (si no, 422 fuera_de_ventana)',
        }),
        origen_tipo: vine.enum(ORIGENES_GESTION).optional().meta({
            description: 'panel solo desde Argos (por defecto); Iris: conversacion, orden o llamada',
        }),
        origen_id: vine
            .string()
            .trim()
            .minLength(1)
            .maxLength(128)
            .nullable()
            .optional()
            .meta({ description: 'Id de la conversación, orden o llamada en Iris (obligatorio desde Iris)' }),
        servicio_id: idEntidad().nullable().optional(),
        nota: vine
            .string()
            .trim()
            .maxLength(NOTA_GESTION_MAXIMO)
            .nullable()
            .optional()
            .meta({ description: 'Nota corta, solo desde el panel (Iris no manda texto libre)' }),
    }),
)

export const listarGestionesValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        servicio_id: idEntidad().optional(),
        tipo: vine.enum(TIPOS_GESTION).optional(),
    }),
)

/** `PUT /ajustes-cobro` (decisiones 10 y 16). */
export const editarAjustesCobroValidator = vine.compile(
    vine.object({
        version: vine
            .number()
            .withoutDecimals()
            .min(0)
            .meta({ description: 'version leída (0 si nunca se guardó); si cambió responde 409' }),
        asientos_requieren_aprobacion: vine.boolean().optional().meta({
            description:
                'Un asiento manual queda como borrador hasta que otro usuario lo aprueba (false de fábrica)',
        }),
        pausa_tope_dias: vine
            .number()
            .withoutDecimals()
            .range([1, PAUSA_TOPE_MAXIMO])
            .optional()
            .meta({ description: 'Días máximos de una pausa sin cobro (90 de fábrica)' }),
    }),
)

/** `POST /libro/asientos` (decisión 10). */
export const asientoManualValidator = vine.compile(
    vine.object({
        fecha: fechaIso()
            .optional()
            .meta({ description: 'Fecha contable (por defecto hoy, al registrar o aprobar)' }),
        descripcion: vine.string().trim().minLength(3).maxLength(500),
        movimientos: vine
            .array(
                vine.object({
                    cuenta: vine.string().trim().minLength(1).maxLength(30).meta({
                        description: 'Código del plan de cuentas (imputable y activa)',
                    }),
                    debe: dinero().nullable().optional(),
                    haber: dinero().nullable().optional(),
                    cliente_id: idEntidad().nullable().optional().meta({
                        description: 'Obligatorio en cuentas con auxiliar de cliente (CxC, anticipos)',
                    }),
                    proveedor_id: idEntidad().nullable().optional().meta({
                        description: 'Obligatorio en 2.1.03 Proveedores',
                    }),
                }),
            )
            .minLength(2)
            .maxLength(200),
    }),
)

export const listarBorradoresValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        estado: vine.enum(ESTADOS_BORRADOR).optional(),
        empresas: empresasConsulta(),
    }),
)

export const rechazarBorradorValidator = vine.compile(vine.object({ motivo: motivo() }))

/** `POST /servicios/:id/pausar-sin-cobro` (decisión 16). */
export const pausarSinCobroValidator = vine.compile(
    vine.object({
        motivo: motivo(),
        dias: vine.number().withoutDecimals().range([1, PAUSA_TOPE_MAXIMO]).meta({
            description: 'Días de pausa desde hoy; hasta pausa_tope_dias de la empresa (90 de fábrica)',
        }),
    }),
)

export const terminarPausaValidator = vine.compile(
    vine.object({ motivo: vine.string().trim().maxLength(500).nullable().optional() }),
)

/** `PUT /cajas/:id/impresion` (decisión 20). */
export const impresionCajaValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        formato_recibo: vine
            .enum(FORMATOS_IMPRESION)
            .optional()
            .meta({ description: 'pos_80 (ticket de 80 mm, de fábrica) o carta' }),
        formato_factura: vine
            .enum(FORMATOS_IMPRESION)
            .optional()
            .meta({ description: 'carta (de fábrica) o pos_80' }),
    }),
)

/** Catálogo de bancos de origen (decisión 23). */
export const crearBancoOrigenValidator = vine.compile(
    vine.object({
        nombre: vine.string().trim().minLength(2).maxLength(100),
        orden: vine.number().withoutDecimals().range([0, 100000]).optional().meta({
            description: 'Posición en las listas (por defecto, después de los demás y antes de «Otro»)',
        }),
    }),
)

export const editarBancoOrigenValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        nombre: vine.string().trim().minLength(2).maxLength(100).optional(),
        orden: vine.number().withoutDecimals().range([0, 100000]).optional(),
        activo: vine
            .boolean()
            .optional()
            .meta({ description: 'false: sale de las listas de todas las empresas' }),
    }),
)
