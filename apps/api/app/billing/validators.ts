import vine from '@vinejs/vine'
import { reglasPaginacion } from '#shared/paginacion'
import {
    dinero,
    empresasConsulta,
    fechaIso,
    idEntidad,
    instanteIso,
    motivo,
    versionEsperada,
} from '#shared/validadores'
import { reglasPromesaSchema } from '#billing/reglas_promesa'
import { ORIGENES_BONIFICACION } from '#billing/bonificaciones'
import { METODOS_PAGO } from '#shared/eventos'
import { CLAVES_CATEGORIA_EGRESO_CONSULTA } from '#ledger/plan_cuentas'

/*
|--------------------------------------------------------------------------
| Plantillas de facturación
|--------------------------------------------------------------------------
*/

const camposPlantilla = {
    nombre: vine.string().trim().minLength(2).maxLength(100),
    ciclo: vine.enum(['dia_fijo', 'aniversario'] as const),
    dia: vine.number().withoutDecimals().range([1, 28]).nullable().optional(),
    prorrateo: vine.boolean().optional(),
    dias_gracia: vine.number().withoutDecimals().range([0, 90]).optional(),
    facturas_para_limitar: vine.number().withoutDecimals().range([0, 24]).optional(),
    facturas_para_cortar: vine.number().withoutDecimals().range([1, 24]).optional(),
    mora_tipo: vine.enum(['ninguna', 'fija', 'porcentaje'] as const).optional(),
    mora_valor: dinero().optional(),
    mora_recurrente: vine.boolean().optional(),
    hora_corte: vine
        .string()
        .trim()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .optional()
        .meta({ description: 'HH:MM hora de Guatemala' }),
    certificar_al: vine
        .enum(['emitir', 'pagar', 'nunca'] as const)
        .optional()
        .meta({
            description:
                'Cuándo se certifica con FEL: pagar (por defecto: aviso de cobro), emitir o nunca (no con FEL obligatoria)',
        }),
    reglas_promesa: reglasPromesaSchema()
        .optional()
        .meta({ description: 'Reglas de promesas; las claves que falten toman su valor por defecto' }),
    por_defecto: vine.boolean().optional().meta({
        description:
            'Plantilla de los servicios creados sin plantilla_facturacion_id. Solo una: marcar esta desmarca la anterior',
    }),
}

export const crearPlantillaValidator = vine.compile(vine.object(camposPlantilla))

export const editarPlantillaValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        nombre: camposPlantilla.nombre.optional(),
        ciclo: vine.enum(['dia_fijo', 'aniversario'] as const).optional(),
        dia: vine.number().withoutDecimals().range([1, 28]).nullable().optional(),
        prorrateo: vine.boolean().optional(),
        dias_gracia: vine.number().withoutDecimals().range([0, 90]).optional(),
        facturas_para_limitar: vine.number().withoutDecimals().range([0, 24]).optional(),
        facturas_para_cortar: vine.number().withoutDecimals().range([1, 24]).optional(),
        mora_tipo: vine.enum(['ninguna', 'fija', 'porcentaje'] as const).optional(),
        mora_valor: dinero().optional(),
        mora_recurrente: vine.boolean().optional(),
        hora_corte: vine
            .string()
            .trim()
            .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
            .optional(),
        certificar_al: vine.enum(['emitir', 'pagar', 'nunca'] as const).optional(),
        reglas_promesa: reglasPromesaSchema().optional().meta({
            description:
                'Si se envía, reemplaza el objeto completo (lo que falte vuelve al valor por defecto)',
        }),
        por_defecto: vine.boolean().optional().meta({
            description: 'true la marca por defecto (desmarca la anterior); false le quita la marca',
        }),
    }),
)

/*
|--------------------------------------------------------------------------
| Facturas
|--------------------------------------------------------------------------
*/

export const listarFacturasValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        cliente_id: idEntidad().optional(),
        servicio_id: idEntidad().optional(),
        estado: vine
            .enum([
                'por_certificar',
                'emitida',
                'parcial',
                'pagada',
                'vencida',
                'anulada',
                'castigada',
                'acreditada',
            ] as const)
            .optional(),
        periodo: fechaIso().optional(),
        tipo: vine
            .enum(['servicio', 'mora'] as const)
            .optional()
            .meta({ description: 'servicio = factura del periodo; mora = recargo por vencimiento' }),
    }),
)

export const generarFacturasValidator = vine.compile(
    vine.object({
        servicio_id: idEntidad()
            .optional()
            .meta({ description: 'Solo este servicio; si falta, todos los pendientes' }),
        hasta: fechaIso()
            .optional()
            .meta({ description: 'Genera todo lo pendiente hasta esta fecha (por defecto hoy)' }),
    }),
)

export const corridasValidator = vine.compile(vine.object({ empresas: empresasConsulta() }))

export const vencerFacturasValidator = vine.compile(
    vine.object({
        servicio_id: idEntidad()
            .optional()
            .meta({ description: 'Solo las facturas de este servicio; si falta, todas' }),
        hasta: fechaIso().optional().meta({
            description:
                'Día de referencia: vence lo que venció antes de esta fecha (por defecto hoy). Una fecha futura fuerza el vencimiento en el laboratorio',
        }),
    }),
)

export const corteValidator = vine.compile(
    vine.object({
        servicio_id: idEntidad()
            .optional()
            .meta({ description: 'Solo este servicio; si falta, las horas de corte pendientes de hoy' }),
        ignorar_hora: vine
            .boolean()
            .optional()
            .meta({ description: 'Baja de estado aunque no haya llegado la hora de corte (laboratorio)' }),
    }),
)

export const anularFacturaValidator = vine.compile(vine.object({ motivo: motivo() }))

export const notaCreditoValidator = vine.compile(
    vine.object({
        monto: dinero()
            .optional()
            .meta({ description: 'Obligatorio sin lineas; con lineas, si viene debe ser su suma' }),
        motivo: motivo(),
        lineas: vine
            .array(vine.object({ linea_id: idEntidad(), monto: dinero() }))
            .minLength(1)
            .maxLength(100)
            .optional()
            .meta({ description: 'Nota por línea: acredita conceptos concretos de la factura con su IVA' }),
    }),
)

export const anularNotaCreditoValidator = vine.compile(vine.object({ motivo: motivo() }))

export const sustituirFacturaValidator = vine.compile(
    vine.object({
        motivo: motivo(),
        cliente_fiscal: vine
            .object({
                tipo_documento_fiscal: vine.enum(['nit', 'cui', 'pasaporte', 'cf'] as const),
                nit_cui: vine.string().trim().maxLength(20).nullable().optional(),
                nombre_fiscal: vine.string().trim().maxLength(200).nullable().optional(),
                direccion_fiscal: vine.string().trim().maxLength(300).nullable().optional(),
            })
            .nullable()
            .optional()
            .meta({
                description:
                    'Receptor corregido para la factura nueva (el del cliente se corrige aparte en PUT /clientes/:id)',
            }),
    }),
)

export const listarNotasCreditoValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        cliente_id: idEntidad().optional(),
        factura_id: idEntidad().optional(),
        desde: fechaIso().optional().meta({ description: 'Fecha contable desde (inclusive)' }),
        hasta: fechaIso().optional().meta({ description: 'Fecha contable hasta (inclusive)' }),
    }),
)

/*
|--------------------------------------------------------------------------
| Pagos
|--------------------------------------------------------------------------
*/

export const listarPagosValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        cliente_id: idEntidad().optional(),
        cobro_id: idEntidad().optional().meta({ description: 'Pagos de un cobro repartido por empresa' }),
        caja_id: idEntidad().optional(),
        cuenta_bancaria_id: idEntidad().optional(),
        metodo: vine.enum(METODOS_PAGO).optional(),
        estado: vine.enum(['registrado', 'pendiente_verificacion', 'anulado'] as const).optional(),
        desde: instanteIso().optional(),
        hasta: instanteIso().optional(),
        factura_id: idEntidad().optional().meta({ description: 'Solo los pagos aplicados a esta factura' }),
    }),
)

export const registrarPagoValidator = vine.compile(
    vine.object({
        cliente_id: idEntidad(),
        metodo: vine.enum(METODOS_PAGO),
        monto: dinero(),
        referencia: vine.string().trim().maxLength(100).nullable().optional().meta({
            description:
                'Boleta, número de transferencia/ACH o código de remesa (obligatoria con deposito, transferencia, ach y remesa). Única por método y cuenta bancaria',
        }),
        caja_id: idEntidad().nullable().optional().meta({
            description: 'Caja del efectivo; sin ella, la del turno abierto del cajero o la principal',
        }),
        cuenta_bancaria_id: idEntidad().nullable().optional().meta({
            description:
                'Cuenta bancaria propia de destino (GET /cuentas-bancarias). Obligatoria con deposito, transferencia, ach y remesa',
        }),
        banco_origen_id: idEntidad().nullable().optional().meta({
            description: 'Banco de origen (GET /bancos). Obligatorio con transferencia y ach',
        }),
        nota: vine.string().trim().maxLength(500).nullable().optional(),
        facturas: vine
            .array(idEntidad())
            .optional()
            .meta({ description: 'Facturas a las que aplicar; por defecto la más antigua primero' }),
        empresa_id: idEntidad().nullable().optional().meta({
            description:
                'Empresa del pago: aplica solo a sus facturas, sin dividir. Sin ella, la de la cuenta bancaria o la de las facturas; un cobro en caja de varias empresas se divide en un pago por empresa (cobro_id)',
        }),
        retenciones: vine
            .array(
                vine.object({
                    codigo: vine.string().trim().minLength(3).maxLength(40).meta({
                        description:
                            'Retención recibida (RET_IVA_ESP, RET_IVA_PUB, RET_IVA_EXP, RET_IVA_TAR, RET_IVA_TAR_COMB, RET_IVA_PEQ, RET_ISR_OPC)',
                    }),
                    numero: vine.string().trim().minLength(1).maxLength(60),
                    fecha: fechaIso().nullable().optional(),
                    monto: dinero(),
                }),
            )
            .maxLength(10)
            .nullable()
            .optional()
            .meta({
                description:
                    'Constancias de retención que entrega el cliente: el pago aplica monto + Σ constancias; a caja o banco entra monto (1.1.05/1.1.06 por cada constancia)',
            }),
    }),
)

export const anularPagoValidator = vine.compile(vine.object({ motivo: motivo() }))

/*
|--------------------------------------------------------------------------
| Promesas
|--------------------------------------------------------------------------
*/

export const listarPromesasValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        servicio_id: idEntidad().optional(),
        cliente_id: idEntidad().optional(),
        estado: vine
            .enum([
                'activa',
                'cumplida',
                'incumplida',
                'cancelada',
                'pendiente_aprobacion',
                'rechazada',
            ] as const)
            .optional(),
    }),
)

export const crearPromesaValidator = vine.compile(
    vine.object({
        servicio_id: idEntidad(),
        vence_en: instanteIso(),
        monto: dinero(),
        canal: vine.enum(['portal', 'ia', 'operador', 'supervisor'] as const).optional(),
    }),
)

export const aprobarPromesaValidator = vine.compile(
    vine.object({ nota: vine.string().trim().maxLength(500).nullable().optional() }),
)

/*
|--------------------------------------------------------------------------
| Cuentas bancarias propias
|--------------------------------------------------------------------------
*/

const camposCuentaBancaria = {
    banco_id: idEntidad().meta({ description: 'Banco (GET /bancos)' }),
    numero: vine.string().trim().minLength(3).maxLength(40),
    alias: vine.string().trim().minLength(2).maxLength(80),
    moneda: vine.enum(['GTQ', 'USD'] as const).optional(),
    activa: vine.boolean().optional(),
}

export const crearCuentaBancariaValidator = vine.compile(
    vine.object({
        ...camposCuentaBancaria,
        empresa_id: idEntidad().nullable().optional().meta({
            description: 'Empresa dueña de la cuenta; por defecto la activa (X-Empresa-Id)',
        }),
    }),
)

export const editarCuentaBancariaValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        banco_id: camposCuentaBancaria.banco_id.optional(),
        numero: vine.string().trim().minLength(3).maxLength(40).optional(),
        alias: vine.string().trim().minLength(2).maxLength(80).optional(),
        moneda: vine.enum(['GTQ', 'USD'] as const).optional(),
        activa: vine.boolean().optional(),
    }),
)

export const listarCuentasBancariasValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        activa: vine.boolean().optional().meta({ description: 'Solo activas (true) o inactivas' }),
    }),
)

/*
|--------------------------------------------------------------------------
| Comprobantes de depósito
|--------------------------------------------------------------------------
*/

export const listarComprobantesValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        estado: vine.enum(['pendiente', 'aprobado', 'rechazado'] as const).optional(),
        cliente_id: idEntidad().optional(),
        metodo: vine.enum(['deposito', 'transferencia', 'ach', 'remesa'] as const).optional(),
        cuenta_bancaria_id: idEntidad().optional().meta({ description: 'Cuenta bancaria propia de destino' }),
        desde: fechaIso().optional().meta({ description: 'Fecha de depósito desde (inclusive)' }),
        hasta: fechaIso().optional().meta({ description: 'Fecha de depósito hasta (inclusive)' }),
    }),
)

export const aprobarComprobanteValidator = vine.compile(
    vine.object({
        facturas: vine.array(idEntidad()).optional().meta({
            description:
                'Facturas a las que aplicar el pago; por defecto las del servicio del comprobante y luego la más antigua',
        }),
        nota: vine.string().trim().maxLength(400).nullable().optional(),
    }),
)

export const rechazarComprobanteValidator = vine.compile(vine.object({ motivo: motivo() }))

/*
|--------------------------------------------------------------------------
| Rechazar y cancelar promesas
|--------------------------------------------------------------------------
*/

export const rechazarPromesaValidator = vine.compile(vine.object({ motivo: motivo() }))
export const cancelarPromesaValidator = vine.compile(vine.object({ motivo: motivo() }))

/*
|--------------------------------------------------------------------------
| Reportes
|--------------------------------------------------------------------------
*/

const formato = vine
    .enum(['json', 'csv', 'xlsx'] as const)
    .optional()
    .meta({ description: 'json (por defecto), csv o xlsx (descarga con Content-Disposition)' })
const rango = {
    desde: fechaIso().optional().meta({ description: 'Por defecto: el día 1 del mes de hace 11 meses' }),
    hasta: fechaIso().optional().meta({ description: 'Por defecto: hoy (Guatemala)' }),
}
const dimensiones = {
    cliente_id: idEntidad().optional(),
    zona_id: idEntidad().optional(),
    router_id: idEntidad().optional(),
    plan_id: idEntidad().optional(),
}

export const reporteCarteraValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        formato,
        ...dimensiones,
        corte: fechaIso()
            .optional()
            .meta({ description: 'Día de referencia de la antigüedad (hoy por defecto)' }),
        agrupar: vine.enum(['cliente', 'zona', 'router', 'plan'] as const).optional(),
    }),
)

const origenReporte = vine
    .enum(['sistema', 'importado'] as const)
    .optional()
    .meta({
        description:
            'sistema = registrado en ArgosIsp; importado = carga histórica de otro sistema (en su mes de origen). Sin filtro: ambos',
    })

export const reporteIngresosValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        formato,
        ...rango,
        cliente_id: idEntidad().optional(),
        zona_id: idEntidad().optional(),
        metodo: vine.enum(METODOS_PAGO).optional(),
        agrupar: vine.enum(['mes', 'dia'] as const).optional(),
        origen: origenReporte,
    }),
)

export const reporteFacturadoValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        formato,
        ...rango,
        ...dimensiones,
        tipo: vine.enum(['servicio', 'mora'] as const).optional(),
        origen: origenReporte,
    }),
)

export const reporteCobranzaValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        formato,
        desde: fechaIso().optional().meta({ description: 'Por defecto: el día 1 del mes de hasta' }),
        hasta: fechaIso().optional(),
        caja_id: idEntidad().optional(),
        metodo: vine.enum(METODOS_PAGO).optional(),
    }),
)

export const reporteIvaValidator = vine.compile(
    vine.object({ formato, ...rango, empresas: empresasConsulta() }),
)

/** `GET /dashboard/resumen`: la empresa activa o el consolidado. */
export const dashboardValidator = vine.compile(vine.object({ empresas: empresasConsulta() }))

/** `GET /clientes/:id/estado-cuenta`: todas sus empresas del alcance, o una. */
export const estadoCuentaValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad().optional().meta({
            description: 'Solo la sección de esa empresa; sin ella, una sección por cada empresa del alcance',
        }),
    }),
)

export const reportePromesasValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        formato,
        ...rango,
        ...dimensiones,
        canal: vine.enum(['portal', 'ia', 'operador', 'supervisor'] as const).optional(),
    }),
)

export const reporteAltasValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        formato,
        ...rango,
        zona_id: idEntidad().optional(),
        router_id: idEntidad().optional(),
        plan_id: idEntidad().optional(),
    }),
)

export const reporteEgresosValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        formato,
        ...rango,
        categoria: vine.enum(CLAVES_CATEGORIA_EGRESO_CONSULTA).optional(),
        metodo: vine.enum(['caja', 'banco', 'cuenta_bancaria'] as const).optional(),
    }),
)

export const reporteBonificacionesValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        formato,
        ...rango,
        motivo_id: idEntidad().optional().meta({ description: 'Solo un motivo (GET /motivos-sin-costo)' }),
        cliente_id: idEntidad().optional(),
        origen: vine
            .enum(ORIGENES_BONIFICACION)
            .optional()
            .meta({ description: 'mes_gratis, descuento_100, cargo_sin_costo o canje' }),
    }),
)

export const listarBonificacionesValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        cliente_id: idEntidad().optional(),
        servicio_id: idEntidad().optional(),
        origen: vine.enum(ORIGENES_BONIFICACION).optional(),
        desde: fechaIso().optional().meta({ description: 'Periodo desde (YYYY-MM-DD)' }),
        hasta: fechaIso().optional().meta({ description: 'Periodo hasta (YYYY-MM-DD)' }),
    }),
)

/*
|--------------------------------------------------------------------------
| Pasarela en línea
|--------------------------------------------------------------------------
*/

export const crearCobroPasarelaValidator = vine.compile(
    vine.object({
        cliente_id: idEntidad(),
        monto: dinero().nullable().optional().meta({
            description: 'Por defecto lo pendiente de las facturas pedidas o de todo el cliente',
        }),
        facturas: vine.array(idEntidad()).optional().meta({ description: 'Facturas a pagar (primero)' }),
        servicio_id: idEntidad().nullable().optional(),
        url_retorno: vine.string().trim().maxLength(2000).nullable().optional().meta({
            description:
                'Adonde el proveedor devuelve al cliente al terminar. Solo orígenes de PASARELA_RETORNO_ORIGENES (422); {cobro_id} se reemplaza por el id del cobro',
        }),
    }),
)

export const listarCobrosPasarelaValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        ...reglasPaginacion,
        cliente_id: idEntidad().optional(),
        estado: vine.enum(['pendiente', 'pagado', 'fallido', 'expirado'] as const).optional(),
    }),
)

export const conciliarPasarelaValidator = vine.compile(
    vine.object({
        fecha: fechaIso().optional().meta({ description: 'Día (Guatemala) a conciliar; por defecto ayer' }),
    }),
)

export const listarConciliacionesValidator = vine.compile(
    vine.object({ ...reglasPaginacion, fecha: fechaIso().optional() }),
)

export const simularPagoFalsaValidator = vine.compile(
    vine.object({
        estado: vine.enum(['pagado', 'fallido'] as const).optional(),
        monto: dinero().optional().meta({ description: 'Simular un pago por otro monto' }),
        notificar: vine.boolean().optional().meta({ description: 'false simula un webhook perdido' }),
    }),
)

export const simularPromesaValidator = vine.compile(
    vine.object({
        servicio_id: idEntidad(),
        canal: vine
            .enum(['portal', 'ia', 'operador', 'supervisor'] as const)
            .optional()
            .meta({ description: 'Por defecto el de la petición (portal/ia por X-Canal) u operador' }),
        vence_en: instanteIso().optional().meta({ description: 'Por defecto: el fin de mañana (Guatemala)' }),
        monto: dinero().optional().meta({ description: 'Por defecto: la deuda pendiente del servicio' }),
        evaluar_en: instanteIso()
            .optional()
            .meta({ description: 'Simular como si fuera este instante (por defecto ahora)' }),
    }),
)

/*
|--------------------------------------------------------------------------
| Cargo único manual y sus catálogos
|--------------------------------------------------------------------------
*/

export const cargoUnicoValidator = vine.compile(
    vine.object({
        servicio_id: idEntidad().nullable().optional().meta({
            description:
                'Servicio del cargo (su empresa, cliente, días de gracia y modo FEL); vencido cuenta para el corte',
        }),
        cliente_id: idEntidad().nullable().optional().meta({
            description:
                'Cliente del cargo: obligatorio sin servicio; con servicio, si viene, debe ser su dueño',
        }),
        empresa_id: idEntidad().nullable().optional().meta({
            description: 'Empresa del cargo sin servicio; por defecto la activa (X-Empresa-Id)',
        }),
        vence_en: fechaIso().nullable().optional().meta({
            description: 'Hoy o después; por defecto hoy + días de gracia del servicio (sin servicio: hoy)',
        }),
        lineas: vine
            .array(
                vine.object({
                    concepto_id: idEntidad().meta({
                        description: 'Concepto del catálogo (GET /conceptos-cargo)',
                    }),
                    descripcion: vine.string().trim().maxLength(200).nullable().optional(),
                    cantidad: vine
                        .string()
                        .trim()
                        .regex(/^\d{1,6}(\.\d{1,4})?$/)
                        .optional()
                        .meta({ description: 'Por defecto 1' }),
                    precio_unitario: vine
                        .string()
                        .trim()
                        .regex(/^\d{1,12}(\.\d{1,2})?$/)
                        .meta({
                            description:
                                'Precio bruto con IVA incluido (> 0), hasta 2 decimales; lo regalado va como descuento',
                            examples: ['150.00'],
                        }),
                    producto_id: idEntidad().nullable().optional().meta({
                        description: 'Inventario: vende este producto (sale del kardex con su costo de ventas)',
                    }),
                    bodega_id: idEntidad().nullable().optional().meta({
                        description: 'Inventario: bodega de la que sale (obligatoria con producto_id)',
                    }),
                    unidad_id: idEntidad().nullable().optional().meta({
                        description: 'Inventario: la unidad vendida de un producto de serie (cantidad 1)',
                    }),
                    descuentos: vine
                        .array(
                            vine.object({
                                concepto: vine.string().trim().minLength(2).maxLength(200),
                                monto: dinero(),
                            }),
                        )
                        .maxLength(10)
                        .optional()
                        .meta({
                            description: 'Descuentos de la línea (IVA incluido; juntos, hasta su bruto)',
                        }),
                }),
            )
            .minLength(1)
            .maxLength(50),
        motivo_sin_costo_id: idEntidad().nullable().optional().meta({
            description:
                'Solo con total Q0 (obligatorio entonces) y el permiso facturas.cargo_sin_costo (GET /motivos-sin-costo)',
        }),
        motivo_sin_costo_texto: vine.string().trim().maxLength(500).nullable().optional().meta({
            description: 'Explicación del Q0 (obligatoria con motivo_sin_costo_id)',
        }),
    }),
)

export const crearConceptoCargoValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad().nullable().optional().meta({
            description: 'Empresa del catálogo; por defecto la activa (X-Empresa-Id)',
        }),
        nombre: vine.string().trim().minLength(2).maxLength(100),
        tipo: vine
            .enum(['producto', 'otro'] as const)
            .optional()
            .meta({ description: 'producto = bien, otro = servicio (DTE); por defecto otro' }),
        cuenta_codigo: vine.string().trim().maxLength(20).meta({
            description: 'Cuenta de ingreso imputable del plan (p. ej. 4.1.03)',
        }),
        gravable: vine.boolean().optional().meta({ description: 'Lleva IVA (por defecto sí)' }),
        activo: vine.boolean().optional(),
    }),
)

export const editarConceptoCargoValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        nombre: vine.string().trim().minLength(2).maxLength(100).optional(),
        tipo: vine.enum(['producto', 'otro'] as const).optional(),
        cuenta_codigo: vine.string().trim().maxLength(20).optional(),
        gravable: vine.boolean().optional(),
        activo: vine.boolean().optional(),
    }),
)

export const crearMotivoSinCostoValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad().nullable().optional().meta({
            description: 'Empresa del catálogo; por defecto la activa (X-Empresa-Id)',
        }),
        nombre: vine.string().trim().minLength(2).maxLength(100),
        activo: vine.boolean().optional(),
    }),
)

export const editarMotivoSinCostoValidator = vine.compile(
    vine.object({
        version: versionEsperada(),
        nombre: vine.string().trim().minLength(2).maxLength(100).optional(),
        activo: vine.boolean().optional(),
    }),
)

export const listarCatalogoCargoValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        activo: vine.boolean().optional().meta({ description: 'Solo activos (true) o inactivos' }),
    }),
)
