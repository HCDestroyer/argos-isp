import {
    Dinero,
    auditable,
    booleano,
    definirEsquema,
    entero,
    enumerado,
    fecha,
    id,
    instante,
    nulable,
    objeto,
    texto,
} from '#shared/openapi/esquemas'
import { SEGUIMIENTOS } from '#inventario/productos'
import { MODALIDADES } from '#inventario/tipos_producto'
import { TIPOS_BODEGA_VISTA } from '#inventario/bodegas'
import { CAUSAS_BAJA, TIPOS_MOVIMIENTO } from '#inventario/kardex'
import { CONDICIONES, ESTADOS_UNIDAD } from '#inventario/unidades'
import { ESTADOS_CONTEO } from '#inventario/conteos'
import { ORIGENES_EXTERNOS } from '#inventario/origen_externo'
import { ESTADOS_ORDEN_TRASLADO, METODOS_RECEPCION } from '#inventario/ordenes_traslado'
import { lista } from '#shared/openapi/esquemas'

/**
 * Schemas de respuesta del inventario (`contratos/inventario.md` §6, fase A).
 */

const Cantidad = { type: 'string', pattern: '^-?\\d+\\.\\d{3}$', description: 'Cantidad con 3 decimales' }
const DineroConSigno = { ...Dinero, description: 'Monto con signo (+ entra, − sale)' }

export const Producto = definirEsquema(
    'Producto',
    objeto({
        id,
        empresa_id: id,
        sku: texto,
        nombre: texto,
        unidad: texto,
        tipo: { ...texto, description: 'Código del tipo de producto (catálogo editable, fase D)' },
        tipo_id: id,
        tipo_nombre: texto,
        seguimiento: enumerado(SEGUIMIENTOS),
        modalidad: {
            ...enumerado(MODALIDADES),
            description: 'Qué hace un consumo a un servicio: comodato, gasto o cargo al cliente (fase D)',
        },
        clase_activo: nulable(texto),
        concepto_cargo_id: nulable(id),
        cuenta_costo: { ...nulable(texto), description: 'null = 5.6.01' },
        cuenta_consumo: { ...nulable(texto), description: 'null = 5.2.07' },
        existencia_minima: nulable(Cantidad),
        precio_venta: {
            ...nulable(Dinero),
            description: 'Precio de venta sugerido para el cargo único (IVA incluido); null = sin precio',
        },
        activo: booleano,
        existencia: { ...Cantidad, description: 'Existencia total en todas las bodegas' },
        valor: { ...Dinero, description: 'Valor del kardex del producto' },
        ...auditable,
    }),
)

export const Bodega = definirEsquema(
    'Bodega',
    objeto({
        id,
        empresa_id: id,
        nombre: texto,
        tipo: enumerado(TIPOS_BODEGA_VISTA),
        usuario_id: nulable(id),
        usuario_nombre: nulable(texto),
        zona_id: nulable(id),
        router_id: nulable(id),
        activo: booleano,
        ...auditable,
    }),
)

export const Existencia = definirEsquema(
    'ExistenciaInventario',
    objeto({
        id,
        empresa_id: id,
        producto_id: id,
        producto_sku: texto,
        producto_nombre: texto,
        unidad: texto,
        bodega_id: id,
        bodega_nombre: texto,
        bodega_tipo: enumerado(TIPOS_BODEGA_VISTA),
        cantidad: Cantidad,
        valor: Dinero,
        costo_promedio: {
            ...nulable(texto),
            description: 'valor / cantidad de la bodega, 6 decimales; null sin existencia',
        },
        existencia_total: Cantidad,
        existencia_minima: nulable(Cantidad),
        bajo_minimo: booleano,
    }),
)

export const MovimientoInventario = definirEsquema(
    'MovimientoInventario',
    objeto(
        {
            id,
            empresa_id: id,
            tipo: enumerado(TIPOS_MOVIMIENTO),
            fecha,
            producto_id: id,
            producto_sku: texto,
            producto_nombre: texto,
            bodega_id: id,
            bodega_nombre: texto,
            cantidad: { ...Cantidad, description: 'Con signo: + entra, − sale' },
            costo_unitario: { ...texto, description: 'Costo unitario con 6 decimales' },
            costo_total: DineroConSigno,
            unidad_id: nulable(id),
            servicio_id: nulable(id),
            asiento_id: {
                ...nulable(id),
                description: 'Asiento del movimiento (o el de su compra); null sin efecto contable',
            },
            origen_tipo: {
                ...nulable(texto),
                description: 'Origen interno: compra, factura, conteo, nota_credito…',
            },
            origen_id: nulable(id),
            origen_externo_tipo: {
                ...nulable(enumerado(ORIGENES_EXTERNOS)),
                description:
                    'Sistema externo que originó el movimiento: iris_orden = orden de trabajo de Iris',
            },
            origen_externo_id: {
                ...nulable(texto),
                description:
                    'Id en el sistema externo (UUID de la orden de Iris; el panel enlaza a Iris con él)',
            },
            traslado_id: nulable(id),
            reverso_de: nulable(id),
            causa: nulable(enumerado(CAUSAS_BAJA)),
            motivo: nulable(texto),
            actor_tipo: texto,
            actor_id: nulable(id),
            created_at: instante,
            saldo_cantidad: { ...Cantidad, description: 'Saldo corrido después del movimiento' },
            saldo_valor: { ...Dinero, description: 'Valor corrido después del movimiento' },
            factura_id: {
                ...nulable(id),
                description:
                    'Solo en la respuesta de POST /inventario/consumos: la factura del cargo único (modalidad consumible_cobro)',
            },
        },
        // siempre presentes (null sin orden); opcionales en el esquema hasta que los fixtures del panel los lleven
        ['origen_externo_tipo', 'origen_externo_id', 'factura_id'],
    ),
)

export const TrasladoInventario = definirEsquema(
    'TrasladoInventario',
    objeto(
        {
            traslado_id: id,
            salida: { ...MovimientoInventario, description: 'Primer par: salida' },
            entrada: { ...MovimientoInventario, description: 'Primer par: entrada' },
            movimientos: {
                ...lista(MovimientoInventario),
                description: 'Todos los movimientos (un par por unidad de serie)',
            },
        },
        ['movimientos'],
    ),
)

const camposUnidad = {
    id,
    empresa_id: id,
    producto_id: id,
    producto_sku: texto,
    producto_nombre: texto,
    serie: nulable(texto),
    mac: { ...nulable(texto), description: 'AA:BB:CC:DD:EE:FF' },
    estado: enumerado(ESTADOS_UNIDAD),
    condicion: enumerado(CONDICIONES),
    bodega_id: nulable(id),
    bodega_nombre: nulable(texto),
    costo: { ...Dinero, description: 'Costo específico (al volver de comodato, su valor en libros)' },
    servicio_id: nulable(id),
    cliente_id: nulable(id),
    activo_id: { ...nulable(id), description: 'Activo fijo mientras está en comodato' },
    compra_id: nulable(id),
    ...auditable,
}

export const Unidad = definirEsquema('UnidadInventario', objeto(camposUnidad))

export const UnidadConHistorial = definirEsquema(
    'UnidadInventarioHistorial',
    objeto({
        ...camposUnidad,
        historial: lista(
            objeto(
                {
                    id,
                    tipo: enumerado(TIPOS_MOVIMIENTO),
                    fecha,
                    bodega_id: id,
                    bodega_nombre: texto,
                    cantidad: Cantidad,
                    costo_total: DineroConSigno,
                    servicio_id: nulable(id),
                    asiento_id: nulable(id),
                    origen_tipo: nulable(texto),
                    origen_id: nulable(id),
                    origen_externo_tipo: nulable(enumerado(ORIGENES_EXTERNOS)),
                    origen_externo_id: nulable(texto),
                    motivo: nulable(texto),
                    created_at: instante,
                },
                ['origen_externo_tipo', 'origen_externo_id'],
            ),
        ),
    }),
)

export const EquipoServicio = definirEsquema(
    'EquipoServicio',
    objeto({
        ...camposUnidad,
        valor_libros: { ...nulable(texto), description: 'Costo − depreciación acumulada del activo' },
        fecha_asignacion: nulable(fecha),
    }),
)

const CostoUnitario = { type: 'string', description: 'Costo unitario con 6 decimales' }

const camposConteo = {
    id,
    empresa_id: id,
    bodega_id: id,
    bodega_nombre: texto,
    estado: enumerado(ESTADOS_CONTEO),
    fecha_corte: fecha,
    motivo: nulable(texto),
    abierto_por: nulable(id),
    cerrado_por: nulable(id),
    cerrado_en: nulable(instante),
    faltante: { ...Dinero, description: 'Valor del faltante ajustado al cerrar' },
    sobrante: { ...Dinero, description: 'Valor del sobrante ajustado al cerrar' },
    version: id,
    created_at: instante,
}

export const ConteoInventario = definirEsquema('ConteoInventario', objeto(camposConteo))

export const ConteoInventarioDetalle = definirEsquema(
    'ConteoInventarioDetalle',
    objeto({
        ...camposConteo,
        lineas: lista(
            objeto({
                id,
                producto_id: id,
                producto_sku: texto,
                producto_nombre: texto,
                seguimiento: enumerado(SEGUIMIENTOS),
                contado: Cantidad,
                series: lista(texto),
                costo_unitario: nulable(CostoUnitario),
                esperado: { ...Cantidad, description: 'Lo que había al capturar la línea (H56)' },
                diferencia: { ...Cantidad, description: 'contado − esperado' },
                valor_diferencia: {
                    ...nulable(DineroConSigno),
                    description:
                        'Cerrado: lo ajustado; abierto: estimado al costo de hoy (null sin costo conocido)',
                },
                capturado_en: nulable(instante),
                esperado_captura: {
                    ...nulable(Cantidad),
                    description: 'Existencia de la bodega al capturar la línea (H56)',
                },
                valor_captura: { ...nulable(Dinero), description: 'Valor de la bodega al capturar la línea' },
                movimientos_desde_captura: {
                    type: 'integer',
                    minimum: 0,
                    description:
                        'Movimientos del producto en la bodega después de la captura (ya están en el kardex; no son diferencia)',
                },
            }),
        ),
    }),
)

export const InventarioValorizado = definirEsquema(
    'InventarioValorizado',
    objeto({
        fecha,
        data: lista(
            objeto({
                empresa_id: id,
                producto_id: id,
                producto_sku: texto,
                producto_nombre: texto,
                unidad: texto,
                seguimiento: enumerado(SEGUIMIENTOS),
                bodega_id: id,
                bodega_nombre: texto,
                cantidad: Cantidad,
                valor: Dinero,
                costo_promedio: nulable(CostoUnitario),
            }),
        ),
        total: { ...Dinero, description: 'Valor de las filas' },
        cuadre: lista(
            objeto({
                empresa_id: id,
                valor_kardex: { ...Dinero, description: 'Kardex completo de la empresa a la fecha' },
                saldo_libro: { ...Dinero, description: 'Saldo de 1.1.14 a la fecha' },
                diferencia: { ...Dinero, description: 'saldo_libro − valor_kardex (0 si cuadra)' },
            }),
        ),
    }),
)

/*
| Órdenes de traslado (fase D, `contratos/inventario.md` D.1)
*/

const camposOrdenTraslado = {
    id,
    empresa_id: id,
    numero: { ...entero, description: 'Correlativo por empresa' },
    estado: enumerado(ESTADOS_ORDEN_TRASLADO),
    bodega_origen_id: id,
    bodega_origen_nombre: texto,
    bodega_destino_id: id,
    bodega_destino_nombre: texto,
    bodega_destino_tipo: enumerado(TIPOS_BODEGA_VISTA),
    usuario_destino_id: {
        ...nulable(id),
        description: 'Técnico de la bodega destino; null si es una bodega',
    },
    usuario_destino_nombre: nulable(texto),
    motivo: nulable(texto),
    enviado_por: nulable(id),
    enviado_por_nombre: nulable(texto),
    enviado_en: instante,
    metodo_recepcion: nulable(enumerado(METODOS_RECEPCION)),
    recibido_por: { ...nulable(id), description: 'Quien recibió (el técnico de la bodega destino)' },
    recibido_por_nombre: nulable(texto),
    registrado_por: {
        ...nulable(id),
        description: 'Quien registró la recepción (el técnico, un encargado o Iris)',
    },
    registrado_por_nombre: nulable(texto),
    recibido_en: nulable(instante),
    observaciones: nulable(texto),
    firma_sha256: { ...nulable(texto), description: 'SHA-256 de la firma digital (GET …/firma la devuelve)' },
    firma_en: nulable(instante),
    documento_sha256: { ...nulable(texto), description: 'SHA-256 del papel firmado (GET …/documento)' },
    documento_tipo: nulable(texto),
    documento_en: nulable(instante),
    cancelado_por: nulable(id),
    cancelado_en: nulable(instante),
    motivo_cancelacion: nulable(texto),
    lineas_total: entero,
    costo_total: { ...Dinero, description: 'Costo de lo enviado' },
    version: entero,
    created_at: instante,
    updated_at: instante,
}

export const OrdenTraslado = definirEsquema('OrdenTraslado', objeto(camposOrdenTraslado))

export const OrdenTrasladoDetalle = definirEsquema(
    'OrdenTrasladoDetalle',
    objeto({
        ...camposOrdenTraslado,
        lineas: lista(
            objeto({
                id,
                producto_id: id,
                producto_sku: texto,
                producto_nombre: texto,
                unidad: texto,
                seguimiento: enumerado(SEGUIMIENTOS),
                cantidad: Cantidad,
                costo_total: Dinero,
                cantidad_recibida: nulable(Cantidad),
                costo_recibido: nulable(Dinero),
                faltante: {
                    ...nulable(Cantidad),
                    description: 'Enviado − recibido; null en tránsito o cancelada',
                },
                unidades: lista(
                    objeto({
                        unidad_id: id,
                        serie: nulable(texto),
                        mac: nulable(texto),
                        costo: Dinero,
                        recibida: { ...nulable(booleano), description: 'null en tránsito; false = faltó' },
                    }),
                ),
            }),
        ),
    }),
)

export const ConfiguracionInventario = definirEsquema(
    'ConfiguracionInventario',
    objeto({
        empresa_id: id,
        traslado_firma_obligatoria: booleano,
        version: { ...entero, description: '0 = sin configurar (valores por defecto)' },
    }),
)

export const TipoProducto = definirEsquema(
    'TipoProducto',
    objeto({
        id,
        empresa_id: { ...nulable(id), description: 'null = global' },
        codigo: texto,
        nombre: texto,
        seguimiento_defecto: enumerado(SEGUIMIENTOS),
        modalidad_defecto: enumerado(MODALIDADES),
        activo: booleano,
        ...auditable,
    }),
)

export const ConsumoLote = definirEsquema(
    'ConsumoInventarioLote',
    objeto({
        empresa_id: id,
        movimientos: {
            ...lista(MovimientoInventario),
            description: 'Un movimiento por línea: consumo, venta o asignación en comodato',
        },
        factura_id: {
            ...nulable(id),
            description: 'La factura del cargo único de los cobros; null si no hubo',
        },
        comodatos: { ...lista(Unidad), description: 'Las unidades prestadas en comodato' },
    }),
)

export const ProductosLote = definirEsquema(
    'ProductosLote',
    objeto({
        data: lista(Producto),
        movimientos: { ...lista(MovimientoInventario), description: 'Los saldos iniciales de las entradas' },
    }),
)
