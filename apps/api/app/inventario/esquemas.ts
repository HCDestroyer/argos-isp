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
    jsonLibre,
    nulable,
    objeto,
    texto,
} from '#shared/openapi/esquemas'
import { SEGUIMIENTOS } from '#inventario/productos'
import { MODALIDADES } from '#inventario/tipos_producto'
import { TIPOS_BODEGA_DESTINO, TIPOS_BODEGA_VISTA } from '#inventario/bodegas'
import { CAUSAS_BAJA, TIPOS_MOVIMIENTO } from '#inventario/kardex'
import { CONDICIONES, ESTADOS_UNIDAD } from '#inventario/unidades'
import { ESTADOS_EQUIPO } from '#inventario/equipos'
import { ESTADOS_CONTEO } from '#inventario/conteos'
import { ORIGENES_EXTERNOS } from '#inventario/origen_externo'
import { ESTADOS_ORDEN_TRASLADO, METODOS_RECEPCION } from '#inventario/ordenes_traslado'
import { lista } from '#shared/openapi/esquemas'

/**
 * Schemas de respuesta del inventario (`contratos/inventario.md` §6, fase A).
 */

/** Enum que admite null (el `null` va también en `enum`, para que los tipos generados lo lleven). */
function enumNulable(valores: readonly string[]) {
    return { type: ['string', 'null'], enum: [...valores, null] }
}

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
        tipo: {
            ...texto,
            description: 'Código del tipo de producto (catálogo editable, GET /inventario/tipos-producto)',
        },
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
    objeto(
        {
            id,
            empresa_id: id,
            nombre: texto,
            tipo: {
                ...enumerado(TIPOS_BODEGA_VISTA),
                description:
                    'bodega, tecnico, cuadrilla (la compartida de una cuadrilla de Iris, 0.11.0 §3.9) o transito (la bodega virtual de las órdenes de traslado; solo sale con ?tipo=transito)',
            },
            usuario_id: nulable(id),
            usuario_nombre: nulable(texto),
            zona_id: nulable(id),
            router_id: nulable(id),
            activo: booleano,
            cuadrilla_id_iris: { ...nulable(texto), description: 'Cuadrilla de Iris (solo tipo cuadrilla)' },
            jefe_id: {
                ...nulable(id),
                description: 'Jefe actual de la cuadrilla (usuario de Argos); null sin jefe',
            },
            ...auditable,
        },
        ['cuadrilla_id_iris', 'jefe_id'],
    ),
)

export const MiembrosCuadrilla = definirEsquema(
    'MiembrosCuadrilla',
    objeto({
        bodega_id: id,
        cuadrilla_id_iris: nulable(texto),
        version: entero,
        jefe_id: nulable(id),
        miembros: lista(
            objeto({
                iris_usuario_id: texto,
                usuario_id: nulable(id),
                nombre: nulable(texto),
                aceptado: booleano,
                motivo: nulable(texto),
                desde: instante,
            }),
        ),
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
        bodega_tipo: {
            ...enumerado(TIPOS_BODEGA_VISTA),
            description: 'La bodega transito (fase D) solo sale con ?bodega_id= o ?incluir_transito=true',
        },
        cantidad: Cantidad,
        valor: Dinero,
        costo_promedio: {
            ...nulable(texto),
            description: 'valor / cantidad de la bodega, 6 decimales; null sin existencia',
        },
        existencia_total: Cantidad,
        existencia_minima: nulable(Cantidad),
        bajo_minimo: booleano,
        modalidad: {
            ...enumerado(MODALIDADES),
            description: 'Modalidad del producto (fase D, contrato Iris 0.5.0)',
        },
    }),
)

const camposMovimiento = {
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
        description: 'Sistema externo que originó el movimiento: iris_orden = orden de trabajo de Iris',
    },
    origen_externo_id: {
        ...nulable(texto),
        description: 'Id en el sistema externo (UUID de la orden de Iris; el panel enlaza a Iris con él)',
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
    actor_tecnico: {
        ...nulable(texto),
        description: 'Iris 0.11.0 §3.9: X-Iris-Actor del técnico que usó el material (nunca del cuerpo)',
    },
    actor_tecnico_id: { ...nulable(id), description: 'Usuario de Argos del técnico de la operación de Iris' },
    ocurrido_en: { ...nulable(instante), description: 'Hora del teléfono (fecha de Iris 0.12.0)' },
}

const OPCIONALES_MOVIMIENTO = [
    'origen_externo_tipo',
    'origen_externo_id',
    'factura_id',
    'actor_tecnico',
    'actor_tecnico_id',
    'ocurrido_en',
]

export const MovimientoInventario = definirEsquema(
    'MovimientoInventario',
    // siempre presentes (null sin orden); opcionales en el esquema hasta que los fixtures del panel los lleven
    objeto(camposMovimiento, OPCIONALES_MOVIMIENTO),
)

/** Respuesta de `POST /inventario/consumos` (fase D): el movimiento de la primera línea más el lote. */
export const ConsumoInventario = definirEsquema(
    'ConsumoInventario',
    objeto(
        {
            ...camposMovimiento,
            movimientos: {
                ...lista(MovimientoInventario),
                description: 'Un movimiento por línea (consumo o venta), en el orden de las líneas',
            },
            cargos: {
                ...lista(objeto({ id, producto_id: id, monto: Dinero })),
                description:
                    'Cargos al cliente de las líneas consumible_cobro (id = la factura del cargo único)',
            },
        },
        [...OPCIONALES_MOVIMIENTO, 'movimientos', 'cargos'],
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
    estado_equipo: {
        ...enumerado(ESTADOS_EQUIPO),
        description:
            'Estado del equipo (Iris 0.12.0 §3.10): como estado, salvo en_reparacion, que es revision o garantia (con una garantía abierta)',
    },
    ...auditable,
}

export const Unidad = definirEsquema('UnidadInventario', objeto(camposUnidad, ['estado_equipo']))

export const OrdenRetiroSolicitada = definirEsquema(
    'OrdenRetiroSolicitada',
    objeto({
        unidad_id: id,
        servicio_id: id,
        empresa_id: id,
        cliente_id: id,
        evento: {
            ...enumerado(['inventario.equipo_por_recuperar']),
            description:
                'Webhook que pide la orden a Iris (contratos/iris.md §2.3); Iris no crea otra si ya hay una abierta para la unidad',
        },
    }),
)

const HistorialKardexUnidad = lista(
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
)

export const UnidadConHistorial = definirEsquema(
    'UnidadInventarioHistorial',
    objeto(
        {
            ...camposUnidad,
            historial: HistorialKardexUnidad,
        },
        ['estado_equipo'],
    ),
)

export const EquipoServicio = definirEsquema(
    'EquipoServicio',
    objeto(
        {
            ...camposUnidad,
            valor_libros: { ...nulable(texto), description: 'Costo − depreciación acumulada del activo' },
            fecha_asignacion: nulable(fecha),
        },
        ['estado_equipo'],
    ),
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
    bodega_destino_tipo: enumerado(TIPOS_BODEGA_DESTINO),
    usuario_destino_id: {
        ...nulable(id),
        description: 'Técnico de la bodega destino; null si es una bodega',
    },
    usuario_destino_nombre: nulable(texto),
    motivo: nulable(texto),
    enviado_por: nulable(id),
    enviado_por_nombre: nulable(texto),
    enviado_en: instante,
    metodo_recepcion: enumNulable(METODOS_RECEPCION),
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
                modalidad: enumerado(MODALIDADES),
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
    objeto(
        {
            empresa_id: id,
            traslado_firma_obligatoria: booleano,
            recuperacion_tecnicos_minimos: {
                ...entero,
                description:
                    'Técnicos distintos con intentos para declarar un equipo no recuperado (2 de fábrica)',
            },
            iris_movimientos_diarios_alerta: {
                ...entero,
                description:
                    'Iris 0.14.0: movimientos al día de un técnico vinculado desde los que se avisa al admin (40 de fábrica)',
            },
            version: { ...entero, description: '0 = sin configurar (valores por defecto)' },
        },
        ['recuperacion_tecnicos_minimos', 'iris_movimientos_diarios_alerta'],
    ),
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

export const ProductosLote = definirEsquema(
    'ProductosLote',
    objeto({
        data: lista(Producto),
        movimientos: { ...lista(MovimientoInventario), description: 'Los saldos iniciales de las entradas' },
    }),
)

/*
| Factura de compra desde un archivo (fase D, `contratos/inventario.md` D.5)
*/

const MontoTexto = {
    type: 'string',
    pattern: '^-?\\d{1,12}(\\.\\d{1,2})?$',
    description: 'Monto con 2 decimales',
}

export const ExtraccionCompra = definirEsquema(
    'ExtraccionCompra',
    objeto({
        emisor: objeto({ nit: texto, nombre: texto }),
        receptor: objeto({ nit: nulable(texto), nombre: nulable(texto) }),
        tipo_documento: { ...texto, description: 'FACT, FCAM, FPEQ, FCAP, FESP, NCRE, NDEB o RECIBO' },
        serie: nulable(texto),
        numero: texto,
        autorizacion: { ...nulable(texto), description: 'UUID FEL de la SAT' },
        fecha: fecha,
        moneda: texto,
        lineas: lista(
            objeto({
                codigo: { ...nulable(texto), description: 'Código del producto del proveedor' },
                descripcion: texto,
                cantidad: { ...texto, description: 'Hasta 6 decimales' },
                unidad: nulable(texto),
                precio_unitario: MontoTexto,
                descuento: MontoTexto,
                total: { ...MontoTexto, description: 'Total de la línea con IVA' },
                iva: MontoTexto,
                bien_o_servicio: enumerado(['B', 'S']),
            }),
        ),
        totales: objeto({ total: MontoTexto, iva: MontoTexto }),
    }),
)

const DatosBorrador = {
    ...jsonLibre,
    description: 'Los datos corregidos: ExtraccionCompra (vacío {} en un borrador manual o si la IA falló)',
}

export const BorradorCompra = definirEsquema(
    'BorradorCompra',
    objeto({
        id,
        empresa_id: id,
        estado: enumerado(['borrador', 'confirmado', 'descartado']),
        fuente: enumerado(['xml_fel', 'ia', 'manual']),
        archivo_tipo: nulable(texto),
        archivo_tamano: nulable(entero),
        archivo_nombre: nulable(texto),
        archivo_sha256: nulable(texto),
        extraccion: {
            ...nulable(ExtraccionCompra),
            description: 'Lo que leyó el parser o la IA (no cambia)',
        },
        confianza: { ...nulable(jsonLibre), description: 'Confianza de la IA (0 a 1) por campo y por línea' },
        error_extraccion: {
            ...nulable(texto),
            description: 'ia_no_configurada: … o ia_fallo: …; el usuario captura a mano',
        },
        ia_proveedor: nulable(texto),
        ia_modelo: nulable(texto),
        datos: DatosBorrador,
        propuesta: objeto({
            proveedor: nulable(objeto({ id: nulable(id), nit: texto, nombre: texto, crear: booleano })),
            lineas: lista(
                objeto({
                    indice: entero,
                    coincidencia: {
                        ...enumNulable(['codigo_proveedor', 'sku', 'nombre']),
                        description: 'Cómo se encontró el producto; null sin coincidencia',
                    },
                    producto_id: nulable(id),
                    producto_sku: nulable(texto),
                    producto_nombre: nulable(texto),
                    crear: nulable(objeto({ sku: texto, nombre: texto, tipo: texto, unidad: texto })),
                    gasto: booleano,
                }),
            ),
        }),
        emisor_nit: nulable(texto),
        serie: nulable(texto),
        numero: nulable(texto),
        compra_id: nulable(id),
        motivo_descarte: nulable(texto),
        creado_por: nulable(id),
        confirmado_por: nulable(id),
        confirmado_en: nulable(instante),
        version: entero,
        created_at: instante,
        updated_at: instante,
    }),
)

export const ConfiguracionIa = definirEsquema(
    'ConfiguracionIa',
    objeto({
        id,
        empresa_id: { ...nulable(id), description: 'null = global' },
        proveedor: enumerado(['privada', 'anthropic', 'deepseek', 'openai']),
        modelo: texto,
        url_base: nulable(texto),
        activo: booleano,
        clave_configurada: { ...booleano, description: 'Hay clave guardada (nunca se devuelve)' },
        version: entero,
        created_at: instante,
        updated_at: instante,
    }),
)

export const MiBodega = definirEsquema(
    'MiBodegaInventario',
    objeto(
        {
            bodega: Bodega,
            existencias: { ...lista(Existencia), description: 'Completas' },
            unidades: {
                ...lista(Unidad),
                description: 'Unidades en la bodega (disponibles o en reparación), completas',
            },
            traslados_pendientes: {
                ...lista(OrdenTraslado),
                description: 'Órdenes en tránsito hacia la bodega, completas',
            },
            kardex: {
                ...lista(MovimientoInventario),
                description:
                    'Los últimos 50 movimientos (el más reciente primero); el resto con GET /inventario/movimientos?bodega_id=',
            },
            cuadrilla: { ...booleano, description: 'La bodega de arriba es de cuadrilla' },
            jefe: {
                ...nulable(objeto({ id_externo: texto, nombre: texto })),
                description: 'Jefe de la cuadrilla (null sin jefe o si no es de cuadrilla)',
            },
            bodegas: {
                ...lista(
                    objeto(
                        {
                            bodega: Bodega,
                            cuadrilla: booleano,
                            jefe: nulable(objeto({ id_externo: texto, nombre: texto })),
                            existencias: lista(Existencia),
                            unidades: lista(Unidad),
                            traslados_pendientes: lista(OrdenTraslado),
                            kardex: lista(MovimientoInventario),
                            id: id,
                            empresa_id: id,
                            nombre: texto,
                        },
                        ['bodega', 'existencias', 'unidades', 'traslados_pendientes', 'kardex'],
                    ),
                ),
                description:
                    'Con empresa (Iris 0.11.0 §3.9): primero las cuadrillas de las que es miembro y después la personal, cada una con su contenido. Sin empresa y con bodegas en varias empresas: una Bodega por empresa (con cuadrilla y jefe) y nada más',
            },
        },
        [
            'bodega',
            'existencias',
            'unidades',
            'traslados_pendientes',
            'kardex',
            'bodegas',
            'cuadrilla',
            'jefe',
        ],
    ),
)

export const Tecnico = definirEsquema(
    'TecnicoInventario',
    objeto({
        id_externo: {
            ...texto,
            description: 'Id del usuario de Argos (lo que Iris manda en tecnico.id_externo)',
        },
        correo: texto,
        nombre: texto,
        bodegas: lista(
            objeto({
                id,
                empresa_id: id,
                activa: booleano,
                nombre: { ...texto, description: 'Nombre de la bodega (contrato Iris 0.6.4, A22)' },
            }),
        ),
    }),
)

/*
|--------------------------------------------------------------------------
| A48 · equipos del cliente (contrato Iris 0.12.0 §3.10)
|--------------------------------------------------------------------------
*/

const EstadoHistorial = objeto(
    {
        fecha: instante,
        de: nulable(enumerado(ESTADOS_EQUIPO)),
        a: enumerado(ESTADOS_EQUIPO),
        motivo: nulable(texto),
        servicio_id: nulable(id),
        origen_externo_tipo: nulable(texto),
        origen_externo_id: nulable(texto),
    },
    ['origen_externo_tipo', 'origen_externo_id'],
)

const ESTADOS_VERIFICACION_IRIS = [
    'no_aplica',
    'pendiente',
    'verificado',
    'no_verificado',
    'anterior',
    'aceptado',
    'descartado',
] as const

/** Un intento de recuperación con su verificación con Iris (pantalla de declaración, 0.14.0 §3.10). */
export const IntentoConVerificacion = definirEsquema(
    'IntentoRecuperacionVerificado',
    objeto(
        {
            id,
            servicio_id: id,
            intento_n: entero,
            motivo: enumerado(['cliente_ausente', 'se_nego', 'equipo_perdido', 'otro']),
            foto_ref: {
                ...nulable(texto),
                description: 'Id opaco del adjunto de la orden en Iris (se abre por autologin)',
            },
            lat: texto,
            lng: texto,
            precision_m: texto,
            nota: nulable(texto),
            fecha: instante,
            dia: { ...fecha, description: 'Día de Guatemala de la fecha del intento (el del cupo)' },
            actor_tecnico: nulable(texto),
            actor_tecnico_id: nulable(id),
            actor_tecnico_nombre: nulable(texto),
            origen_externo_id: nulable(texto),
            created_at: instante,
            verificacion_id: nulable(id),
            verificacion: {
                ...enumerado(ESTADOS_VERIFICACION_IRIS),
                description:
                    'no_aplica (registrado en Argos), pendiente, verificado, no_verificado (con motivo), anterior (anterior a la verificación: lo decide una persona), aceptado o descartado',
            },
            verificacion_motivo: {
                ...nulable(texto),
                description:
                    'envio_en_curso, foto_pendiente, no_enviado_por_iris, no_coincide, foto_invalida, desconocido_en_iris, error_iris, timeout, sin_acceso, limitado, sin_conector o respuesta_invalida',
            },
            verificado_en: nulable(instante),
            verificacion_consultas: entero,
            verificacion_proxima_en: nulable(instante),
            decidido_por: nulable(id),
            decidido_en: nulable(instante),
            motivo_decision: nulable(texto),
            cuenta: { ...booleano, description: 'Cuenta para el mínimo de técnicos distintos' },
            afirmado_por_iris: {
                ...booleano,
                description: 'La ubicación y la autoría las afirma Iris (Argos no las revalida)',
            },
        },
        [
            'dia',
            'verificacion_id',
            'verificacion',
            'verificacion_motivo',
            'verificado_en',
            'verificacion_consultas',
            'verificacion_proxima_en',
            'decidido_por',
            'decidido_en',
            'motivo_decision',
            'cuenta',
            'afirmado_por_iris',
        ],
    ),
)

/** Intentos de una unidad para la pantalla de declaración (0.14.0). */
export const IntentosDeUnidad = definirEsquema(
    'IntentosRecuperacionDeUnidad',
    objeto({
        unidad_id: id,
        aviso: {
            ...texto,
            description: 'Texto fijo para la pantalla: la ubicación y la autoría las afirma Iris',
        },
        tecnicos_minimos: entero,
        tecnicos_que_cuentan: entero,
        contactos: { ...entero, description: 'Contactos registrados por una persona en el panel de Argos' },
        intentos: lista(IntentoConVerificacion),
    }),
)

export const DecisionIntento = definirEsquema(
    'DecisionIntentoRecuperacion',
    objeto({
        intento_id: id,
        verificacion: enumerado(['aceptado', 'descartado']),
        por_recuperar: booleano,
    }),
)

export const VinculoTecnicoIris = definirEsquema(
    'VinculoTecnicoIris',
    objeto({
        id,
        empresa_id: id,
        iris_usuario_id: texto,
        iris_tecnico_id: nulable(texto),
        id_externo: nulable(texto),
        usuario_id: nulable(id),
        usuario_nombre: nulable(texto),
        estado: {
            ...enumerado(['vinculado', 'rechazado', 'desvinculado']),
            description: 'rechazado = vinculo_rechazado (con su motivo)',
        },
        motivo: {
            ...nulable(texto),
            description:
                'Rechazo: usuario_inexistente, usuario_inactivo, no_es_tecnico, fuera_de_la_empresa, id_externo_en_uso; desvinculado: el de Iris (desactivado)',
        },
        version: entero,
        origen: enumerado(['webhook', 'conciliacion']),
        reevaluar_en: nulable(instante),
        updated_at: instante,
    }),
)

export const ConciliacionVinculo = definirEsquema(
    'ConciliacionVinculoTecnico',
    objeto({
        resultado: enumerado(['aplicado', 'no_encontrado', 'error']),
        estado: nulable(enumerado(['vinculado', 'rechazado', 'desvinculado'])),
        ignorado: nulable(texto),
        motivo: nulable(texto),
    }),
)

export const UnidadDetalle = definirEsquema(
    'UnidadInventarioDetalle',
    objeto({
        ...camposUnidad,
        historial: HistorialKardexUnidad,
        historial_estados: { ...lista(EstadoHistorial), description: 'Cada cambio del estado del equipo' },
        garantias: lista(
            objeto({
                id,
                proveedor_id: nulable(id),
                proveedor_nombre: nulable(texto),
                rma: nulable(texto),
                vence_en: nulable(fecha),
                enviada_en: nulable(instante),
                origen: enumerado(['cambio_equipo', 'panel']),
                abierta_en: instante,
                resultado: nulable(enumerado(['reparada', 'reemplazada', 'rechazada', 'baja'])),
                resuelta_en: nulable(instante),
                serie_anterior: nulable(texto),
                mac_anterior: nulable(texto),
                nota: nulable(texto),
            }),
        ),
        intentos: lista(IntentoConVerificacion),
        contactos: lista(
            objeto({
                id,
                servicio_id: nulable(id),
                medio: texto,
                nota: texto,
                registrado_por: nulable(id),
                registrado_por_nombre: nulable(texto),
                created_at: instante,
            }),
        ),
    }),
)

/** Lo que ve Iris de una unidad (M5): sin costos, proveedor ni RMA. */
export const UnidadEquipoIris = definirEsquema(
    'UnidadEquipoIris',
    objeto({
        id,
        empresa_id: id,
        producto_id: id,
        modelo: texto,
        serie: nulable(texto),
        mac: nulable(texto),
        estado: enumerado(ESTADOS_EQUIPO),
        servicio_id: nulable(id),
        historial: lista(
            objeto({
                fecha: instante,
                de: nulable(enumerado(ESTADOS_EQUIPO)),
                a: enumerado(ESTADOS_EQUIPO),
                motivo: nulable(texto),
                servicio_id: {
                    ...nulable(id),
                    description:
                        'Solo el servicio actual de la unidad o el de la orden en curso (?servicio_id=)',
                },
            }),
        ),
    }),
)

export const CambioEquipo = definirEsquema(
    'CambioEquipo',
    objeto(
        {
            cambio_id: id,
            sale: objeto({ unidad_id: id, estado: enumerado(ESTADOS_EQUIPO) }),
            entra: objeto({ unidad_id: id, estado: enumerado(ESTADOS_EQUIPO) }),
            cobro_propuesto_id: { ...nulable(id), description: 'El cobro propuesto en la cola (sin monto)' },
            cobro_verificacion: {
                ...nulable(enumerado(['pendiente', 'no_aplica'])),
                description:
                    '0.14.0: pendiente = el cobro propuesto espera la verificación de Iris y no está en la cola; null sin cobro',
            },
        },
        ['cobro_verificacion'],
    ),
)

export const IntentoRecuperacion = definirEsquema(
    'IntentoRecuperacion',
    objeto(
        {
            id,
            unidad_id: id,
            servicio_id: id,
            intento_n: entero,
            motivo: enumerado(['cliente_ausente', 'se_nego', 'equipo_perdido', 'otro']),
            estado: enumerado(ESTADOS_EQUIPO),
            fecha: instante,
            verificacion: {
                ...enumerado(['pendiente', 'anterior', 'no_aplica']),
                description:
                    '0.14.0: pendiente (se verifica con Iris; hasta entonces no cambia la unidad ni avisa), anterior (Iris < 0.14.0: lo decide una persona) o no_aplica (registrado en Argos)',
            },
        },
        ['verificacion'],
    ),
)

export const ContactoRecuperacion = definirEsquema(
    'ContactoRecuperacion',
    objeto({ id, unidad_id: id, servicio_id: nulable(id), medio: texto, created_at: instante }),
)

export const CobroEquipo = definirEsquema(
    'CobroEquipo',
    objeto({
        id,
        empresa_id: id,
        unidad_id: id,
        serie: nulable(texto),
        mac: nulable(texto),
        producto_nombre: texto,
        servicio_id: id,
        cliente_id: id,
        cliente_nombre: texto,
        origen: enumerado(['cambio_equipo', 'no_recuperado']),
        cambio_id: nulable(id),
        motivo: nulable(texto),
        nota: nulable(texto),
        estado: {
            ...enumerado(['propuesto', 'aprobado', 'rechazado', 'por_verificar', 'no_verificado']),
            description:
                'por_verificar y no_verificado (0.14.0): cobro propuesto de un cambio que espera la verificación de Iris o que Iris no confirmó; no están en la cola',
        },
        monto: nulable(Dinero),
        factura_id: nulable(id),
        decidido_por: nulable(id),
        decidido_en: nulable(instante),
        motivo_decision: nulable(texto),
        version: entero,
        created_at: instante,
    }),
)

export const PendienteNoRecuperado = definirEsquema(
    'PendienteNoRecuperado',
    objeto(
        {
            unidad_id: id,
            empresa_id: id,
            serie: nulable(texto),
            mac: nulable(texto),
            producto_nombre: texto,
            servicio_id: id,
            cliente_id: id,
            cliente_nombre: texto,
            intentos: entero,
            tecnicos_distintos: { ...entero, description: 'Técnicos distintos con intentos que cuentan' },
            por_verificar: { ...entero, description: 'Intentos pendientes de verificar con Iris (0.14.0)' },
            anteriores: {
                ...entero,
                description: 'Intentos anteriores a la verificación (los decide una persona)',
            },
            contactos: entero,
            ultimo_intento: instante,
        },
        ['por_verificar', 'anteriores'],
    ),
)

export const UnidadNoRecuperada = definirEsquema(
    'UnidadNoRecuperada',
    objeto({
        ...camposUnidad,
        cobro_id: { ...nulable(id), description: 'El cobro «Equipo no devuelto» (con monto)' },
        factura_id: { ...nulable(id), description: 'La factura del cargo único del cobro' },
    }),
)
