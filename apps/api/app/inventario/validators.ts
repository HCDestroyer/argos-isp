import vine from '@vinejs/vine'
import { reglasPaginacion } from '#shared/paginacion'
import { dinero, empresasConsulta, fechaIso, idEntidad, motivo, versionEsperada } from '#shared/validadores'
import { CLAVES_CLASE_ACTIVO } from '#ledger/compras'
import { SEGUIMIENTOS, TIPOS_PRODUCTO } from '#inventario/productos'
import { TIPOS_BODEGA } from '#inventario/bodegas'
import { CAUSAS_BAJA, TIPOS_MOVIMIENTO } from '#inventario/kardex'

/**
 * Validadores del inventario (`contratos/inventario.md` §6, fase A). Las cantidades viajan como
 * texto con hasta 3 decimales (`"12.5"`), como el dinero.
 */

const texto = (max: number) => vine.string().trim().maxLength(max)

const cantidad = () =>
    vine
        .string()
        .trim()
        .regex(/^\d{1,11}(\.\d{1,3})?$/)
        .meta({ description: 'Cantidad mayor que 0 con hasta 3 decimales, como string', examples: ['12.5'] })

const cantidadConSigno = () =>
    vine
        .string()
        .trim()
        .regex(/^-?\d{1,11}(\.\d{1,3})?$/)
        .meta({
            description: 'Cantidad con signo (+ sobrante, − faltante), distinta de 0, hasta 3 decimales',
            examples: ['-2'],
        })

const costoUnitario = () =>
    vine
        .string()
        .trim()
        .regex(/^\d{1,12}(\.\d{1,6})?$/)
        .meta({ description: 'Costo unitario con hasta 6 decimales, como string', examples: ['5.25'] })

const cuenta = () =>
    vine
        .string()
        .trim()
        .regex(/^\d+(\.\d+)*$/)
        .maxLength(30)

/*
| Productos
*/

const datosProducto = {
    unidad: texto(30).nullable().optional().meta({ description: 'unidad (por defecto), metro, caja…' }),
    clase_activo: vine.enum(CLAVES_CLASE_ACTIVO).nullable().optional().meta({
        description:
            'Solo seguimiento serie: clase de activo al prestarlo en comodato (por defecto equipo_red)',
    }),
    concepto_cargo_id: idEntidad().nullable().optional().meta({
        description: 'Concepto de cargo único con que se vende (fase C)',
    }),
    cuenta_costo: cuenta().nullable().optional().meta({
        description: 'Cuenta de costo de ventas (gasto); por defecto 5.6.01',
    }),
    cuenta_consumo: cuenta().nullable().optional().meta({
        description: 'Cuenta del consumo interno (gasto); por defecto 5.2.07',
    }),
    existencia_minima: vine
        .string()
        .trim()
        .regex(/^\d{1,11}(\.\d{1,3})?$/)
        .nullable()
        .optional()
        .meta({ description: 'Existencia total bajo la cual se avisa (inventario.existencia_minima)' }),
}

export const crearProductoValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad().nullable().optional().meta({ description: 'Por defecto la empresa activa' }),
        sku: vine.string().trim().minLength(1).maxLength(60),
        nombre: vine.string().trim().minLength(2).maxLength(200),
        tipo: vine.enum(TIPOS_PRODUCTO),
        seguimiento: vine.enum(SEGUIMIENTOS).meta({
            description: 'cantidad (cable, conectores) o serie (router, ONU: unidades en la fase B)',
        }),
        ...datosProducto,
    }),
)

export const editarProductoValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        sku: vine.string().trim().minLength(1).maxLength(60).nullable().optional(),
        nombre: vine.string().trim().minLength(2).maxLength(200).nullable().optional(),
        tipo: vine.enum(TIPOS_PRODUCTO).nullable().optional(),
        seguimiento: vine.enum(SEGUIMIENTOS).nullable().optional().meta({
            description: 'No cambia si el producto tiene movimientos (409 producto_con_movimientos)',
        }),
        ...datosProducto,
    }),
)

export const desactivarValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        motivo: texto(500).nullable().optional(),
    }),
)

export const listarProductosValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        q: texto(100).optional().meta({ description: 'Nombre (contiene) o SKU exacto' }),
        tipo: vine.enum(TIPOS_PRODUCTO).optional(),
        seguimiento: vine.enum(SEGUIMIENTOS).optional(),
        activo: vine.boolean().optional(),
    }),
)

/*
| Bodegas
*/

const datosBodega = {
    usuario_id: idEntidad().nullable().optional().meta({ description: 'Técnico dueño (solo tipo tecnico)' }),
    zona_id: idEntidad().nullable().optional().meta({ description: 'Zona para el alcance ACL' }),
    router_id: idEntidad().nullable().optional().meta({ description: 'Router para el alcance ACL' }),
}

export const crearBodegaValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad().nullable().optional().meta({ description: 'Por defecto la empresa activa' }),
        nombre: vine.string().trim().minLength(2).maxLength(120),
        tipo: vine.enum(TIPOS_BODEGA),
        ...datosBodega,
    }),
)

export const editarBodegaValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        nombre: vine.string().trim().minLength(2).maxLength(120).nullable().optional(),
        ...datosBodega,
    }),
)

export const listarBodegasValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        tipo: vine.enum(TIPOS_BODEGA).optional(),
        activo: vine.boolean().optional(),
        usuario_id: idEntidad().optional(),
    }),
)

/*
| Existencias y kardex
*/

export const existenciasValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        producto_id: idEntidad().optional(),
        bodega_id: idEntidad().optional(),
        bajo_minimo: vine.boolean().optional().meta({
            description: 'Solo productos cuya existencia total está bajo su existencia mínima',
        }),
    }),
)

export const kardexValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        producto_id: idEntidad().optional(),
        bodega_id: idEntidad().optional(),
        desde: fechaIso().optional(),
        hasta: fechaIso().optional(),
        tipo: vine.enum(TIPOS_MOVIMIENTO).optional(),
    }),
)

/*
| Operaciones
*/

export const consumoValidator = vine.compile(
    vine.object({
        producto_id: idEntidad(),
        bodega_id: idEntidad(),
        cantidad: cantidad(),
        servicio_id: idEntidad().nullable().optional().meta({
            description: 'Instalación o reparación en la que se usó (misma empresa)',
        }),
        motivo: texto(500).nullable().optional(),
    }),
)

export const trasladoValidator = vine.compile(
    vine.object({
        producto_id: idEntidad(),
        bodega_origen_id: idEntidad(),
        bodega_destino_id: idEntidad(),
        cantidad: cantidad(),
        motivo: texto(500).nullable().optional(),
    }),
)

export const ajusteValidator = vine.compile(
    vine.object({
        producto_id: idEntidad(),
        bodega_id: idEntidad(),
        cantidad: cantidadConSigno(),
        motivo: motivo(),
        costo_unitario: costoUnitario().nullable().optional().meta({
            description: 'Sobrante sin costo conocido: el costo unitario con que entra',
        }),
    }),
)

export const bajaValidator = vine.compile(
    vine.object({
        producto_id: idEntidad(),
        bodega_id: idEntidad(),
        cantidad: cantidad(),
        causa: vine.enum(CAUSAS_BAJA),
        motivo: motivo(),
    }),
)

export const saldoInicialValidator = vine.compile(
    vine.object({
        producto_id: idEntidad(),
        bodega_id: idEntidad(),
        cantidad: cantidad(),
        costo_unitario: costoUnitario().nullable().optional().meta({
            description: 'Costo unitario (o costo_total; uno de los dos)',
        }),
        costo_total: dinero().nullable().optional().meta({ description: 'Costo total (o costo_unitario)' }),
        fecha: fechaIso().nullable().optional().meta({ description: 'Fecha del saldo (por defecto hoy)' }),
        motivo: texto(500).nullable().optional(),
    }),
)
