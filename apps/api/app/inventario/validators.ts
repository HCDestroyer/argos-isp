import vine from '@vinejs/vine'
import { reglasPaginacion } from '#shared/paginacion'
import { dinero, empresasConsulta, fechaIso, idEntidad, motivo, versionEsperada } from '#shared/validadores'
import { CLAVES_CLASE_ACTIVO } from '#ledger/compras'
import { SEGUIMIENTOS } from '#inventario/productos'
import { MODALIDADES } from '#inventario/tipos_producto'
import { reglasExtraccion } from '#inventario/facturas_compra/extraccion'
import { PROVEEDORES_IA } from '#inventario/facturas_compra/ia'
import { TIPOS_BODEGA, TIPOS_BODEGA_VISTA } from '#inventario/bodegas'
import { CAUSAS_BAJA, TIPOS_MOVIMIENTO } from '#inventario/kardex'
import { CONDICIONES, ESTADOS_UNIDAD } from '#inventario/unidades'
import { ESTADOS_CONTEO } from '#inventario/conteos'
import { reglasOrigenExterno } from '#inventario/origen_externo'

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

/** Técnico de Argos identificado desde Iris (D.6): `id_externo` (su usuario de Argos) o `correo`. */
export const tecnicoExterno = () =>
    vine.object({
        id_externo: vine.string().trim().maxLength(30).nullable().optional().meta({
            description: 'Id del usuario de Argos del técnico (el id_externo del vínculo en Iris)',
        }),
        correo: vine.string().trim().maxLength(254).nullable().optional().meta({
            description: 'Correo del usuario de Argos del técnico (sin distinguir mayúsculas)',
        }),
    })

/** Unidad nueva de un producto de serie: serie o MAC (al menos una). */
const unidadNueva = () =>
    vine.object({
        serie: texto(100).nullable().optional(),
        mac: texto(30).nullable().optional().meta({ description: 'Con o sin separadores' }),
    })

/*
| Productos
*/

/** Código de un tipo del catálogo (fase D): `equipo`, `material`, `otro` o uno de la empresa. */
const codigoTipo = () =>
    vine
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9_]{2,40}$/)
        .meta({
            description: 'Código del tipo de producto (GET /inventario/tipos-producto)',
            examples: ['material'],
        })

const datosProducto = {
    modalidad: vine.enum(MODALIDADES).nullable().optional().meta({
        description:
            'comodato (serie), consumible_gasto (cantidad) o consumible_cobro (las dos: cargo único al cliente al consumirlo). Por defecto la del tipo',
    }),
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
    precio_venta: vine
        .string()
        .trim()
        .regex(/^\d{1,12}(\.\d{1,2})?$/)
        .nullable()
        .optional()
        .meta({
            description: 'Precio de venta sugerido para el cargo único, IVA incluido (null lo quita)',
            examples: ['450.00'],
        }),
}

export const crearProductoValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad().nullable().optional().meta({ description: 'Por defecto la empresa activa' }),
        sku: vine.string().trim().minLength(1).maxLength(60),
        nombre: vine.string().trim().minLength(2).maxLength(200),
        tipo: codigoTipo(),
        seguimiento: vine.enum(SEGUIMIENTOS).nullable().optional().meta({
            description: 'cantidad (cable, conectores) o serie (router, ONU); por defecto la del tipo',
        }),
        ...datosProducto,
    }),
)

/** Un producto del lote (fase D, D.4): lo de `POST /productos` más su saldo inicial opcional. */
const productoDelLote = () =>
    vine.object({
        sku: vine.string().trim().minLength(1).maxLength(60),
        nombre: vine.string().trim().minLength(2).maxLength(200),
        tipo: codigoTipo(),
        seguimiento: vine.enum(SEGUIMIENTOS).nullable().optional(),
        ...datosProducto,
        entrada: vine
            .object({
                bodega_id: idEntidad(),
                cantidad: cantidad().nullable().optional().meta({ description: 'Por cantidad' }),
                costo_unitario: costoUnitario().nullable().optional(),
                costo_total: dinero().nullable().optional(),
                unidades: vine
                    .array(
                        vine.object({
                            serie: texto(100).nullable().optional(),
                            mac: texto(30).nullable().optional(),
                            costo: dinero(),
                        }),
                    )
                    .maxLength(500)
                    .nullable()
                    .optional()
                    .meta({ description: 'Por serie: cada unidad con su costo' }),
                fecha: fechaIso()
                    .nullable()
                    .optional()
                    .meta({ description: 'Fecha del saldo (por defecto hoy)' }),
            })
            .nullable()
            .optional()
            .meta({
                description:
                    'Saldo inicial en una bodega (1.1.14 / 2.9.01). Exige además inventario.cargar_saldo_inicial',
            }),
    })

export const crearProductosLoteValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad().nullable().optional().meta({ description: 'Por defecto la empresa activa' }),
        productos: vine.array(productoDelLote()).minLength(1).maxLength(500),
    }),
)

export const editarProductoValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        sku: vine.string().trim().minLength(1).maxLength(60).nullable().optional(),
        nombre: vine.string().trim().minLength(2).maxLength(200).nullable().optional(),
        tipo: codigoTipo().nullable().optional(),
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
        tipo: codigoTipo().optional(),
        seguimiento: vine.enum(SEGUIMIENTOS).optional(),
        modalidad: vine.enum(MODALIDADES).optional(),
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
        tipo: vine.enum(TIPOS_BODEGA_VISTA).optional(),
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
        incluir_transito: vine.boolean().optional().meta({
            description:
                'Fase D: también lo que viaja en órdenes de traslado (bodega transito); sin bodega_id, no sale',
        }),
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
        origen_externo_id: vine.string().trim().minLength(1).maxLength(100).optional().meta({
            description: 'Solo los movimientos de esta orden de Iris (origen_externo_id)',
        }),
    }),
)

/*
| Operaciones
*/

/** Lo de cada línea de un consumo (fase D: la modalidad del producto decide). */
const lineaConsumo = {
    cantidad: cantidad().nullable().optional().meta({ description: 'Producto por cantidad' }),
    unidad_id: idEntidad().nullable().optional().meta({
        description: 'Equipo por serie (comodato o venta según la modalidad); o, en su lugar, `serie`',
    }),
    serie: texto(100)
        .nullable()
        .optional()
        .meta({ description: 'Serie de la unidad en la empresa del servicio' }),
    precio_unitario: dinero().nullable().optional().meta({
        description: 'consumible_cobro: precio con IVA incluido (por defecto el precio_venta del producto)',
    }),
    concepto_id: idEntidad().nullable().optional().meta({
        description:
            'consumible_cobro: concepto del cargo único (por defecto el concepto_cargo_id del producto)',
    }),
}

const datosConsumo = {
    bodega_id: idEntidad().nullable().optional().meta({
        description: 'Bodega de salida; sin ella, con `tecnico`, la del técnico de la orden',
    }),
    tecnico: tecnicoExterno().nullable().optional(),
    servicio_id: idEntidad().nullable().optional().meta({
        description:
            'Instalación o reparación en la que se usó (misma empresa); obligatorio para cobrar o prestar en comodato',
    }),
    motivo: texto(500).nullable().optional(),
    fecha: fechaIso().nullable().optional().meta({
        description:
            'Fecha del consumo a gasto (por defecto hoy): una pasada dentro de un periodo abierto, al promedio de hoy y sin dejar existencia negativa después. Cobros y comodatos van con la de hoy',
    }),
    ...reglasOrigenExterno(),
}

export const consumoValidator = vine.compile(
    vine.object({
        producto_id: idEntidad().nullable().optional().meta({ description: 'Una línea (o lineas[])' }),
        ...lineaConsumo,
        lineas: vine
            .array(vine.object({ producto_id: idEntidad().nullable().optional(), ...lineaConsumo }))
            .minLength(1)
            .maxLength(200)
            .nullable()
            .optional()
            .meta({
                description: 'Varias líneas, todo o nada (contrato Iris 0.5.0 §3.3); en lugar de producto_id',
            }),
        ...datosConsumo,
    }),
)

export const trasladoValidator = vine.compile(
    vine.object({
        producto_id: idEntidad(),
        bodega_origen_id: idEntidad(),
        bodega_destino_id: idEntidad(),
        cantidad: cantidad().nullable().optional().meta({ description: 'Producto por cantidad' }),
        unidad_ids: vine.array(idEntidad()).minLength(1).maxLength(500).nullable().optional().meta({
            description: 'Producto de serie: las unidades que se trasladan',
        }),
        motivo: texto(500).nullable().optional(),
    }),
)

export const ajusteValidator = vine.compile(
    vine.object({
        producto_id: idEntidad(),
        bodega_id: idEntidad(),
        cantidad: cantidadConSigno().nullable().optional(),
        unidad_id: idEntidad().nullable().optional().meta({ description: 'Serie: faltante de esta unidad' }),
        unidad: unidadNueva()
            .nullable()
            .optional()
            .meta({ description: 'Serie: sobrante de esta unidad nueva' }),
        motivo: motivo(),
        costo_unitario: costoUnitario().nullable().optional().meta({
            description:
                'Sobrante sin existencia en la bodega: el costo unitario con que entra (> 0); con existencia se ignora y entra al promedio',
        }),
        fecha: fechaIso().nullable().optional().meta({
            description:
                'Fecha del ajuste (por defecto hoy): una pasada dentro de un periodo abierto, al costo de hoy y sin dejar existencia negativa después',
        }),
    }),
)

export const bajaValidator = vine.compile(
    vine.object({
        producto_id: idEntidad(),
        bodega_id: idEntidad(),
        cantidad: cantidad().nullable().optional().meta({ description: 'Producto por cantidad' }),
        unidad_id: idEntidad().nullable().optional().meta({ description: 'Producto de serie: la unidad' }),
        causa: vine.enum(CAUSAS_BAJA),
        motivo: motivo(),
    }),
)

export const saldoInicialValidator = vine.compile(
    vine.object({
        producto_id: idEntidad(),
        bodega_id: idEntidad(),
        cantidad: cantidad()
            .nullable()
            .optional()
            .meta({ description: 'Producto por cantidad (en serie, 1)' }),
        unidad: unidadNueva().nullable().optional().meta({ description: 'Producto de serie: la unidad' }),
        costo_unitario: costoUnitario().nullable().optional().meta({
            description: 'Costo unitario (o costo_total; uno de los dos)',
        }),
        costo_total: dinero().nullable().optional().meta({ description: 'Costo total (o costo_unitario)' }),
        fecha: fechaIso().nullable().optional().meta({ description: 'Fecha del saldo (por defecto hoy)' }),
        motivo: texto(500).nullable().optional(),
    }),
)

/*
| Unidades y comodato
*/

export const listarUnidadesValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        estado: vine.enum(ESTADOS_UNIDAD).optional(),
        producto_id: idEntidad().optional(),
        bodega_id: idEntidad().optional(),
        servicio_id: idEntidad().optional(),
        q: texto(100).optional().meta({ description: 'Serie (contiene) o MAC (con o sin separadores)' }),
    }),
)

export const asignarComodatoValidator = vine.compile(
    vine.object({
        unidad_id: idEntidad().optional().meta({ description: 'La unidad; o, en su lugar, `serie`' }),
        serie: texto(100).optional().meta({
            description:
                'Serie de la unidad en la empresa del servicio, sin distinguir mayúsculas (contrato Iris §3); en lugar de `unidad_id`',
        }),
        fecha: fechaIso().nullable().optional().meta({
            description:
                'Fecha del préstamo (por defecto hoy; no anterior al último movimiento de la unidad)',
        }),
        bodega_id: idEntidad().nullable().optional().meta({
            description: 'Fase D: la bodega de la que debe salir (409 unidad_en_otra_bodega si está en otra)',
        }),
        tecnico: tecnicoExterno().nullable().optional().meta({
            description: 'Fase D: sin bodega_id, la unidad debe estar en la bodega de este técnico',
        }),
        ...reglasOrigenExterno(),
    }),
)

export const devolverComodatoValidator = vine.compile(
    vine.object({
        bodega_id: idEntidad()
            .nullable()
            .optional()
            .meta({ description: 'La bodega que recibe (o tecnico)' }),
        tecnico: tecnicoExterno().nullable().optional().meta({
            description: 'Contrato Iris 0.5.0: a la bodega activa del técnico en la empresa del servicio',
        }),
        condicion: vine.enum(CONDICIONES).nullable().optional().meta({ description: 'Por defecto usado' }),
        en_reparacion: vine.boolean().nullable().optional(),
        fecha: fechaIso().nullable().optional(),
        motivo: texto(500).nullable().optional(),
        ...reglasOrigenExterno(),
    }),
)

export const perdidaComodatoValidator = vine.compile(
    vine.object({
        motivo: motivo(),
        fecha: fechaIso().nullable().optional(),
        ...reglasOrigenExterno(),
    }),
)

export const porRecuperarValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        cliente_id: idEntidad().optional(),
        producto_id: idEntidad().optional(),
    }),
)

/*
| Conteos físicos (fase C)
*/

export const abrirConteoValidator = vine.compile(
    vine.object({
        bodega_id: idEntidad(),
        motivo: texto(500).nullable().optional(),
    }),
)

export const contarValidator = vine.compile(
    vine.object({
        producto_id: idEntidad(),
        contado: vine
            .string()
            .trim()
            .regex(/^\d{1,11}(\.\d{1,3})?$/)
            .nullable()
            .optional()
            .meta({ description: 'Producto por cantidad: lo contado (≥ 0, hasta 3 decimales)' }),
        series: vine.array(texto(100)).maxLength(5000).nullable().optional().meta({
            description: 'Producto de serie: serie o MAC de cada unidad encontrada',
        }),
        costo_unitario: costoUnitario().nullable().optional().meta({
            description: 'Costo de un sobrante si la bodega no tiene existencia del producto (> 0)',
        }),
    }),
)

export const cerrarConteoValidator = vine.compile(
    vine.object({
        version: versionEsperada().nullable().optional(),
    }),
)

export const cancelarConteoValidator = vine.compile(vine.object({ motivo: motivo() }))

export const listarConteosValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        bodega_id: idEntidad().optional(),
        estado: vine.enum(ESTADOS_CONTEO).optional(),
    }),
)

export const marcarReparadaValidator = vine.compile(vine.object({ motivo: motivo() }))

export const valorizadoValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        fecha: fechaIso().optional().meta({ description: 'Fecha de corte (por defecto hoy)' }),
        bodega_id: idEntidad().optional(),
        producto_id: idEntidad().optional(),
        con_ceros: vine.boolean().optional().meta({ description: 'Incluir filas sin existencia ni valor' }),
    }),
)

/*
| Órdenes de traslado (fase D, `contratos/inventario.md` D.1)
*/

export const enviarTrasladoValidator = vine.compile(
    vine.object({
        bodega_origen_id: idEntidad(),
        bodega_destino_id: idEntidad(),
        motivo: texto(500).nullable().optional(),
        lineas: vine
            .array(
                vine.object({
                    producto_id: idEntidad(),
                    cantidad: cantidad().nullable().optional().meta({ description: 'Producto por cantidad' }),
                    unidad_ids: vine
                        .array(idEntidad())
                        .minLength(1)
                        .maxLength(500)
                        .nullable()
                        .optional()
                        .meta({
                            description: 'Producto de serie: las unidades que se envían',
                        }),
                }),
            )
            .minLength(1)
            .maxLength(200),
    }),
)

export const recibirTrasladoValidator = vine.compile(
    vine.object({
        version: vine.number().withoutDecimals().min(1).nullable().optional(),
        metodo_recepcion: vine
            .enum(['firma_digital', 'firma_papel', 'aceptacion_sistema'] as const)
            .nullable()
            .optional()
            .meta({
                description:
                    'Por defecto firma_digital si llega firma y aceptacion_sistema si no (solo si la empresa no exige firma)',
            }),
        recibido_por: tecnicoExterno().nullable().optional(),
        observaciones: texto(1000).nullable().optional(),
        firma: vine
            .object({
                png_base64: vine.string().maxLength(300_000).meta({
                    description: 'PNG del trazo en base64 (con o sin data:image/png;base64,)',
                }),
                sha256: vine
                    .string()
                    .trim()
                    .toLowerCase()
                    .regex(/^[0-9a-f]{64}$/)
                    .meta({
                        description: 'SHA-256 del PNG decodificado',
                    }),
            })
            .nullable()
            .optional()
            .meta({
                description:
                    'Firma digital: PNG de hasta 200 KB decodificado y de 50×20 a 1000×400 px (422 firma_invalida). En multipart/form-data (panel) va como archivo `firma`, y `lineas` y `recibido_por` como texto JSON',
            }),
        recibido_en: vine.string().trim().maxLength(40).nullable().optional().meta({
            description:
                'RFC 3339, hora del teléfono: no anterior al envío ni futura (5 min de tolerancia). Por defecto ahora',
        }),
        lineas: vine
            .array(
                vine.object({
                    linea_id: idEntidad(),
                    cantidad_recibida: vine
                        .string()
                        .trim()
                        .regex(/^\d{1,11}(\.\d{1,3})?$/)
                        .nullable()
                        .optional()
                        .meta({
                            description: 'Por cantidad: lo recibido (0 a lo enviado); por defecto todo',
                        }),
                    series_faltantes: vine
                        .array(vine.string().trim().minLength(1).maxLength(100))
                        .maxLength(500)
                        .nullable()
                        .optional()
                        .meta({
                            description: 'Por serie: las series o MAC que no llegaron (contrato Iris 0.5.0)',
                        }),
                    unidad_ids_faltantes: vine.array(idEntidad()).maxLength(500).nullable().optional().meta({
                        description: 'Por serie (panel): las unidades que no llegaron',
                    }),
                }),
            )
            .maxLength(200)
            .nullable()
            .optional()
            .meta({ description: 'Solo las líneas con faltantes; las demás se reciben completas' }),
    }),
)

export const cancelarTrasladoValidator = vine.compile(
    vine.object({
        motivo: motivo(),
        version: vine.number().withoutDecimals().min(1).nullable().optional(),
    }),
)

export const listarOrdenesTrasladoValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        estado: vine
            .enum(['en_transito', 'recibida', 'recibida_con_diferencias', 'cancelada'] as const)
            .optional(),
        bodega_id: idEntidad().optional().meta({ description: 'Origen o destino' }),
        numero: vine.number().withoutDecimals().min(1).optional(),
    }),
)

export const configurarInventarioValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad().nullable().optional().meta({ description: 'Por defecto la empresa activa' }),
        traslado_firma_obligatoria: vine.boolean(),
        version: vine.number().withoutDecimals().min(0).meta({ description: '0 la primera vez' }),
    }),
)

export const verConfiguracionInventarioValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad().optional().meta({ description: 'Por defecto la empresa activa' }),
    }),
)

export const documentoTrasladoValidator = vine.compile(
    vine.object({
        nota: texto(500)
            .nullable()
            .optional()
            .meta({ description: 'Nota de quien adjunta (queda en la auditoría)' }),
    }),
)

/*
| Tipos de producto (fase D, `contratos/inventario.md` D.2)
*/

export const crearTipoProductoValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad().nullable().optional().meta({ description: 'Por defecto la empresa activa' }),
        global: vine.boolean().nullable().optional().meta({
            description: 'true = tipo global (solo con alcance global de empresas)',
        }),
        codigo: vine
            .string()
            .trim()
            .toLowerCase()
            .regex(/^[a-z0-9_]{2,40}$/)
            .meta({ description: 'Minúsculas, dígitos y _ (no cambia)', examples: ['fibra'] }),
        nombre: vine.string().trim().minLength(2).maxLength(80),
        seguimiento_defecto: vine.enum(SEGUIMIENTOS),
        modalidad_defecto: vine.enum(MODALIDADES),
    }),
)

export const editarTipoProductoValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        nombre: vine.string().trim().minLength(2).maxLength(80).nullable().optional(),
        seguimiento_defecto: vine.enum(SEGUIMIENTOS).nullable().optional(),
        modalidad_defecto: vine.enum(MODALIDADES).nullable().optional(),
    }),
)

export const desactivarTipoProductoValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        motivo: texto(500).nullable().optional(),
    }),
)

export const listarTiposProductoValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        activo: vine.boolean().optional(),
    }),
)

/*
| Factura de compra desde un archivo (fase D, `contratos/inventario.md` D.5)
*/

export const cargarBorradorValidator = vine.compile(
    vine.object({
        empresa_id: vine.number().withoutDecimals().min(1).nullable().optional().meta({
            description: 'Por defecto la empresa activa',
        }),
    }),
)

export const editarBorradorValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        datos: vine.object(reglasExtraccion),
    }),
)

const proveedorNuevo = () =>
    vine.object({
        nit: vine
            .string()
            .trim()
            .maxLength(30)
            .nullable()
            .optional()
            .meta({ description: 'Por defecto el del emisor' }),
        nombre: vine.string().trim().minLength(2).maxLength(200),
        tipo: vine
            .enum(['general', 'pequeno_contribuyente', 'sin_documento', 'no_residente'] as const)
            .nullable()
            .optional(),
        dias_credito: vine.number().withoutDecimals().min(0).max(365).nullable().optional(),
    })

export const confirmarBorradorValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        proveedor: vine.object({
            id: idEntidad().nullable().optional(),
            crear: proveedorNuevo().nullable().optional(),
        }),
        condicion: vine.enum(['contado', 'credito'] as const),
        vence_en: fechaIso().nullable().optional(),
        metodo: vine
            .enum(['caja', 'banco', 'cuenta_bancaria'] as const)
            .nullable()
            .optional(),
        caja_id: idEntidad().nullable().optional(),
        banco_id: idEntidad().nullable().optional(),
        cuenta_bancaria_id: idEntidad().nullable().optional(),
        periodo_iva: fechaIso().nullable().optional(),
        credito_fiscal: vine.boolean().nullable().optional(),
        forzar_receptor: vine.boolean().nullable().optional().meta({
            description: 'Confirmar aunque el NIT del receptor no sea el de la empresa',
        }),
        lineas: vine
            .array(
                vine.object({
                    indice: vine.number().withoutDecimals().min(0),
                    producto: vine
                        .object({
                            id: idEntidad().nullable().optional(),
                            crear: vine
                                .object({
                                    sku: vine.string().trim().minLength(1).maxLength(60),
                                    nombre: vine.string().trim().minLength(2).maxLength(200),
                                    tipo: codigoTipo(),
                                    seguimiento: vine.enum(SEGUIMIENTOS).nullable().optional(),
                                    ...datosProducto,
                                })
                                .nullable()
                                .optional(),
                        })
                        .nullable()
                        .optional(),
                    bodega_id: idEntidad().nullable().optional(),
                    unidades: vine.array(unidadNueva()).maxLength(500).nullable().optional(),
                    cuenta: cuenta().nullable().optional(),
                    categoria: texto(60).nullable().optional(),
                }),
            )
            .maxLength(500)
            .nullable()
            .optional()
            .meta({ description: 'Por línea de la factura (indice); las que no se indican van a gasto' }),
    }),
)

export const descartarBorradorValidator = vine.compile(
    vine.object({ version: versionEsperada(), motivo: motivo() }),
)

export const listarBorradoresValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        estado: vine.enum(['borrador', 'confirmado', 'descartado'] as const).optional(),
    }),
)

export const configurarIaValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad().nullable().optional().meta({ description: 'Por defecto la empresa activa' }),
        global: vine.boolean().nullable().optional().meta({
            description: 'true = configuración global (solo con alcance global de empresas)',
        }),
        proveedor: vine.enum(PROVEEDORES_IA),
        modelo: vine.string().trim().minLength(1).maxLength(100),
        url_base: vine.string().trim().url({ require_tld: false }).maxLength(300).nullable().optional().meta({
            description:
                'Obligatoria en privada (endpoint compatible con OpenAI, p. ej. http://ollama:11434/v1)',
        }),
        api_key: vine.string().trim().maxLength(500).nullable().optional().meta({
            description: 'Se escribe y nunca se lee (cifrada). Sin el campo se conserva; null la borra',
        }),
        activo: vine.boolean(),
        version: vine.number().withoutDecimals().min(0).meta({ description: '0 la primera vez' }),
    }),
)

export const verIaValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad().optional(),
        global: vine.boolean().optional(),
    }),
)

/*
| Bodega del técnico (fase D, `contratos/inventario.md` D.6)
*/

export const tecnicosValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
    }),
)

export const miBodegaValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        empresa_id: idEntidad()
            .optional()
            .meta({ description: 'Por defecto la empresa activa (X-Empresa-Id)' }),
        usuario_id: idEntidad().optional().meta({ description: 'Otro técnico (solo con alcance global)' }),
        id_externo: vine.string().trim().maxLength(30).optional().meta({
            description:
                'Otro técnico por su id de Argos (el id_externo del vínculo en Iris; solo con alcance global)',
        }),
        correo: vine.string().trim().maxLength(254).optional().meta({
            description: 'Otro técnico por su correo (solo con alcance global)',
        }),
    }),
)
