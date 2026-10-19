import vine from '@vinejs/vine'
import { reglasPaginacion } from '#shared/paginacion'
import { dinero, empresasConsulta, fechaIso, idEntidad, motivo, versionEsperada } from '#shared/validadores'
import { METODOS_EGRESO } from '#ledger/egresos'
import { CLAVES_CATEGORIA_EGRESO } from '#ledger/plan_cuentas'
import { CLAVES_CLASE_ACTIVO, TIPOS_DOCUMENTO_COMPRA, TIPOS_LINEA_COMPRA } from '#ledger/compras'
import { REGIMENES_PROVEEDOR, TIPOS_DOCUMENTO_PROVEEDOR, TIPOS_PROVEEDOR } from '#ledger/proveedores'

/**
 * Validadores de proveedores, compras, pagos a proveedores, constancias, activos y diferidos
 * (contrato de localización fiscal §3.4 y §10.10, fase 5).
 */

const texto = (max: number) => vine.string().trim().maxLength(max)

/*
| Proveedores
*/

const datosProveedor = {
    nombre: vine.string().trim().minLength(2).maxLength(150),
    tipo: vine.enum(TIPOS_PROVEEDOR).nullable().optional().meta({
        description:
            'general (por defecto), pequeno_contribuyente (FPEQ/FCAP), no_residente (id_extranjero) o sin_documento (factura especial)',
    }),
    regimen_isr: vine
        .enum(REGIMENES_PROVEEDOR)
        .nullable()
        .optional()
        .meta({ description: 'opcional_simplificado: la empresa le retiene ISR (RET_ISR_OPC_C)' }),
    agente_retencion_iva: vine
        .boolean()
        .nullable()
        .optional()
        .meta({ description: 'El proveedor también es agente de retención de IVA (no se le retiene)' }),
    direccion: texto(300).nullable().optional(),
    correo: texto(150).nullable().optional(),
    telefono: texto(40).nullable().optional(),
    dias_credito: vine
        .number()
        .withoutDecimals()
        .range([0, 365])
        .nullable()
        .optional()
        .meta({ description: 'Plazo de pago por defecto de sus compras al crédito' }),
}

export const crearProveedorValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad().nullable().optional().meta({ description: 'Por defecto la empresa activa' }),
        tipo_documento: vine.enum(TIPOS_DOCUMENTO_PROVEEDOR).nullable().optional().meta({
            description: 'nit (por defecto; dígito verificador), cui o id_extranjero (no residentes)',
        }),
        nit: vine.string().trim().minLength(1).maxLength(30).meta({ description: 'Documento del proveedor' }),
        pais: vine
            .string()
            .trim()
            .fixedLength(2)
            .nullable()
            .optional()
            .meta({ description: 'Por defecto GT' }),
        ...datosProveedor,
    }),
)

export const editarProveedorValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        ...datosProveedor,
        nombre: vine.string().trim().minLength(2).maxLength(150).nullable().optional(),
        activo: vine.boolean().nullable().optional(),
        nit: texto(30).nullable().optional().meta({ description: 'No se edita (422 campo_solo_lectura)' }),
        tipo_documento: vine.enum(TIPOS_DOCUMENTO_PROVEEDOR).nullable().optional(),
        pais: vine.string().trim().fixedLength(2).nullable().optional(),
    }),
)

export const listarProveedoresValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        buscar: texto(100).optional().meta({ description: 'Nombre (contiene) o documento exacto' }),
        tipo: vine.enum(TIPOS_PROVEEDOR).optional(),
        activo: vine.boolean().optional(),
    }),
)

export const estadoCuentaProveedorValidator = vine.compile(
    vine.object({
        desde: fechaIso().optional(),
        hasta: fechaIso().optional(),
    }),
)

/*
| Compras
*/

const lineaCompra = vine.object({
    descripcion: vine.string().trim().minLength(1).maxLength(300),
    tipo: vine.enum(TIPOS_LINEA_COMPRA).nullable().optional().meta({ description: 'Por defecto servicio' }),
    cuenta: texto(30)
        .nullable()
        .optional()
        .meta({ description: 'Código de la cuenta de gasto o de activo (5.2.01)' }),
    categoria: vine
        .enum(CLAVES_CATEGORIA_EGRESO)
        .nullable()
        .optional()
        .meta({ description: 'O la categoría de egreso (su cuenta de gasto)' }),
    clase_activo: vine.enum(CLAVES_CLASE_ACTIVO).nullable().optional().meta({
        description: 'Obligatoria en activo_fijo: la línea va a 1.2.01.NN y da de alta el activo',
    }),
    // total de la línea con el IVA incluido
    total: dinero(),
    cantidad: vine.number().withoutDecimals().range([1, 100000]).nullable().optional().meta({
        description:
            'Unidades de la línea (1 por defecto); un bien para premios de sorteo se entrega por unidad',
    }),
    iva: dinero().nullable().optional().meta({
        description: 'IVA del documento si difiere del calculado (hasta Q0.05 de redondeo)',
    }),
    exento: vine.boolean().nullable().optional(),
    diferir_meses: vine.number().withoutDecimals().range([2, 120]).nullable().optional().meta({
        description: 'Gasto pagado por anticipado: va a 1.1.13 y se amortiza en N meses (§10.10)',
    }),
    diferir_desde: fechaIso().nullable().optional().meta({
        description: 'Mes en que empieza la amortización (por defecto el mes de la compra)',
    }),
    activo_descripcion: texto(300).nullable().optional(),
    activo_serie: texto(100).nullable().optional(),
    activo_ubicacion: texto(200).nullable().optional(),
    activo_tasa_anual: vine
        .string()
        .trim()
        .regex(/^\d{1,3}(\.\d{1,2})?$/)
        .nullable()
        .optional()
        .meta({
            description:
                'Tasa anual de depreciación; por defecto el máximo legal de la clase (parámetro depreciacion)',
        }),
    activo_valor_residual: dinero().nullable().optional(),
})

const retencion = vine.object({
    codigo: vine.string().trim().minLength(3).maxLength(40).meta({
        description:
            'Impuesto de retención emitida (RET_IVA_ESP_C, RET_IVA_PEQ_C, RET_ISR_OPC_C, RET_ISR_NR_*…)',
    }),
    monto: dinero().nullable().optional().meta({ description: 'Sin él se calcula con la tasa vigente' }),
})

const documentoCompra = {
    empresa_id: idEntidad().nullable().optional(),
    proveedor_id: idEntidad(),
    tipo_documento: vine.enum(TIPOS_DOCUMENTO_COMPRA),
    serie: texto(30).nullable().optional(),
    numero: vine.string().trim().minLength(1).maxLength(40),
    autorizacion: vine
        .string()
        .trim()
        .regex(/^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/)
        .nullable()
        .optional()
        .meta({ description: 'UUID de autorización del DTE del proveedor' }),
    fecha_documento: fechaIso(),
    periodo_iva: fechaIso().nullable().optional().meta({
        description:
            'Mes en que se toma el crédito (cualquier día del mes). Por defecto el del documento; hasta credito_fiscal_ventana_meses después',
    }),
    credito_fiscal: vine.boolean().nullable().optional().meta({
        description: 'Por defecto, si el documento desglosa IVA. false = gasto sin crédito (IVA al costo)',
    }),
    compra_referencia_id: idEntidad().nullable().optional().meta({
        description: 'NCRE (obligatoria) o NDEB: la compra que corrige',
    }),
    descripcion: texto(500).nullable().optional(),
    lineas: vine.array(lineaCompra).minLength(1).maxLength(200),
    retenciones: vine.array(retencion).maxLength(10).nullable().optional().meta({
        description:
            'Retenciones emitidas. Sin el campo, las sugeridas (agente de retención, pequeño contribuyente, régimen opcional); [] = ninguna',
    }),
}

export const registrarCompraValidator = vine.compile(
    vine.object({
        ...documentoCompra,
        condicion: vine.enum(['contado', 'credito'] as const),
        vence_en: fechaIso().nullable().optional().meta({
            description: 'Crédito: por defecto la fecha del documento + días de crédito del proveedor',
        }),
        metodo: vine.enum(METODOS_EGRESO).nullable().optional().meta({
            description: 'Contado: de dónde sale el pago (crea el egreso que la paga)',
        }),
        caja_id: idEntidad().nullable().optional(),
        banco_id: idEntidad().nullable().optional(),
        cuenta_bancaria_id: idEntidad().nullable().optional(),
    }),
)

export const compraDesdeEgresoValidator = vine.compile(vine.object(documentoCompra))

export const anularCompraValidator = vine.compile(vine.object({ motivo: motivo() }))

export const listarComprasValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        proveedor_id: idEntidad().optional(),
        periodo_iva: fechaIso().optional().meta({ description: 'Mes del libro de compras (cualquier día)' }),
        desde: fechaIso().optional().meta({ description: 'Fecha del documento desde' }),
        hasta: fechaIso().optional(),
        tipo_documento: vine.enum(TIPOS_DOCUMENTO_COMPRA).optional(),
        estado: vine.enum(['vigente', 'anulada'] as const).optional(),
        condicion: vine.enum(['contado', 'credito'] as const).optional(),
        pendientes: vine.boolean().optional().meta({ description: 'Solo compras al crédito con saldo' }),
    }),
)

const formato = vine.enum(['json', 'csv', 'xlsx'] as const).optional()

export const libroComprasValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad().optional().meta({ description: 'Por defecto la empresa activa' }),
        desde: fechaIso()
            .optional()
            .meta({ description: 'Mes inicial (cualquier día); por defecto el actual' }),
        hasta: fechaIso().optional().meta({ description: 'Mes final; por defecto el de desde' }),
        formato,
    }),
)

export const cuadreComprasValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad().optional(),
        desde: fechaIso().optional(),
        hasta: fechaIso().optional(),
    }),
)

/*
| Constancias de retención
*/

export const constanciaEmitidaValidator = vine.compile(
    vine.object({
        impuesto_codigo: vine.string().trim().minLength(3).maxLength(40).meta({
            description: 'Retención de la compra que ampara (RET_IVA_ESP_C, RET_ISR_OPC_C…)',
        }),
        numero: vine.string().trim().minLength(1).maxLength(60),
        fecha: fechaIso().nullable().optional().meta({ description: 'Por defecto hoy' }),
    }),
)

export const listarConstanciasValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        direccion: vine.enum(['recibida', 'emitida'] as const).optional(),
        impuesto: vine.enum(['iva', 'isr'] as const).optional(),
        desde: fechaIso().optional(),
        hasta: fechaIso().optional(),
        vigente: vine.boolean().optional(),
    }),
)

/*
| Pagos a proveedores y antigüedad
*/

export const registrarPagoProveedorValidator = vine.compile(
    vine.object({
        proveedor_id: idEntidad(),
        monto: dinero(),
        metodo: vine
            .enum(METODOS_EGRESO)
            .meta({ description: 'caja, banco (del libro) o cuenta_bancaria propia' }),
        caja_id: idEntidad().nullable().optional(),
        banco_id: idEntidad().nullable().optional(),
        cuenta_bancaria_id: idEntidad().nullable().optional(),
        fecha: fechaIso().nullable().optional().meta({ description: 'Por defecto hoy; no futura' }),
        referencia: texto(100).nullable().optional().meta({ description: 'Cheque, transferencia…' }),
        descripcion: texto(500).nullable().optional(),
        compras: vine.array(idEntidad()).maxLength(200).nullable().optional().meta({
            description: 'Compras a pagar primero (en ese orden); luego la más antigua por vencimiento',
        }),
    }),
)

export const anularPagoProveedorValidator = vine.compile(vine.object({ motivo: motivo() }))

export const listarPagosProveedoresValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        proveedor_id: idEntidad().optional(),
        desde: fechaIso().optional(),
        hasta: fechaIso().optional(),
        estado: vine.enum(['registrado', 'anulado'] as const).optional(),
    }),
)

export const cuentasPorPagarValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        formato,
        corte: fechaIso()
            .optional()
            .meta({ description: 'Día de referencia de la antigüedad (hoy por defecto)' }),
        proveedor_id: idEntidad().optional(),
    }),
)

export { dinero, fechaIso, idEntidad, motivo, formato, texto }
