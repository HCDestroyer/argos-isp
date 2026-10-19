import vine from '@vinejs/vine'
import { reglasPaginacion } from '#shared/paginacion'
import { dinero, empresasConsulta, fechaIso, idEntidad, motivo } from '#shared/validadores'
import { CLAVES_CLASE_ACTIVO } from '#ledger/compras'

/**
 * Validadores de activos fijos y diferidos (contrato de localización fiscal §10.10, fase 5).
 */

const texto = (max: number) => vine.string().trim().maxLength(max)

export const registrarActivoValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad().nullable().optional(),
        clase: vine.enum(CLAVES_CLASE_ACTIVO),
        descripcion: vine.string().trim().minLength(2).maxLength(300),
        serie: texto(100).nullable().optional(),
        ubicacion: texto(200)
            .nullable()
            .optional()
            .meta({ description: 'Sitio, nodo o cliente (CPE en comodato)' }),
        fecha_alta: fechaIso().nullable().optional(),
        costo: dinero(),
        valor_residual: dinero().nullable().optional(),
        depreciacion_inicial: dinero().nullable().optional().meta({
            description: 'Depreciación acumulada al darlo de alta (inventario inicial)',
        }),
        tasa_anual: vine
            .string()
            .trim()
            .regex(/^\d{1,3}(\.\d{1,2})?$/)
            .nullable()
            .optional()
            .meta({
                description: 'Por defecto el tope legal de la clase (parámetro depreciacion)',
            }),
        contrapartida: vine
            .enum(['2.9.01', '3.1.01', '3.3.01'] as const)
            .nullable()
            .optional()
            .meta({
                description: 'Saldos de apertura (por defecto), capital social o utilidades acumuladas',
            }),
    }),
)

export const bajaActivoValidator = vine.compile(
    vine.object({
        tipo: vine.enum(['venta', 'retiro'] as const),
        motivo: motivo(),
        fecha: fechaIso().nullable().optional(),
        precio_venta: dinero().nullable().optional().meta({ description: 'Venta: precio sin IVA' }),
        cuenta_bancaria_id: idEntidad()
            .nullable()
            .optional()
            .meta({ description: 'Venta: cuenta que recibe el precio' }),
        banco_id: idEntidad().nullable().optional(),
        cuenta_id: idEntidad().nullable().optional(),
    }),
)

export const listarActivosValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        clase: vine.enum(CLAVES_CLASE_ACTIVO).optional(),
        estado: vine.enum(['vigente', 'dado_de_baja'] as const).optional(),
        compra_id: idEntidad().optional(),
    }),
)

export const registrarDiferimientoValidator = vine.compile(
    vine.object({
        origen: vine.enum(['factura', 'compra'] as const),
        factura_linea_id: idEntidad().nullable().optional(),
        compra_linea_id: idEntidad().nullable().optional(),
        meses: vine.number().withoutDecimals().range([2, 120]),
        inicio: fechaIso()
            .nullable()
            .optional()
            .meta({ description: 'Mes de la primera cuota (por defecto el del documento)' }),
        descripcion: texto(300).nullable().optional(),
    }),
)

export const listarDiferimientosValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        origen: vine.enum(['factura', 'compra'] as const).optional(),
        factura_id: idEntidad().optional(),
        compra_id: idEntidad().optional(),
    }),
)

export const cuotasMesValidator = vine.compile(
    vine.object({
        hasta: fechaIso().nullable().optional().meta({
            description: 'Último mes a registrar (cualquier día); por defecto el mes anterior al actual',
        }),
    }),
)
