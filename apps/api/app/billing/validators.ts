import vine from '@vinejs/vine'
import { reglasPaginacion } from '#shared/paginacion'
import { dinero, fechaIso, idEntidad, instanteIso, motivo, versionEsperada } from '#shared/validadores'
import { reglasPromesaSchema } from '#billing/reglas_promesa'
import { METODOS_PAGO } from '#shared/eventos'
import { CLAVES_CATEGORIA_EGRESO } from '#ledger/plan_cuentas'

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
    certificar_al: vine.enum(['emitir', 'pagar', 'nunca'] as const).optional(),
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
        ...reglasPaginacion,
        cliente_id: idEntidad().optional(),
        servicio_id: idEntidad().optional(),
        estado: vine.enum(['emitida', 'parcial', 'pagada', 'vencida', 'anulada'] as const).optional(),
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

/*
|--------------------------------------------------------------------------
| Pagos
|--------------------------------------------------------------------------
*/

export const listarPagosValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        cliente_id: idEntidad().optional(),
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

export const crearCuentaBancariaValidator = vine.compile(vine.object(camposCuentaBancaria))

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
        formato,
        ...dimensiones,
        corte: fechaIso()
            .optional()
            .meta({ description: 'Día de referencia de la antigüedad (hoy por defecto)' }),
        agrupar: vine.enum(['cliente', 'zona', 'router', 'plan'] as const).optional(),
    }),
)

export const reporteIngresosValidator = vine.compile(
    vine.object({
        formato,
        ...rango,
        cliente_id: idEntidad().optional(),
        zona_id: idEntidad().optional(),
        metodo: vine.enum(METODOS_PAGO).optional(),
        agrupar: vine.enum(['mes', 'dia'] as const).optional(),
    }),
)

export const reporteFacturadoValidator = vine.compile(
    vine.object({
        formato,
        ...rango,
        ...dimensiones,
        tipo: vine.enum(['servicio', 'mora'] as const).optional(),
    }),
)

export const reporteCobranzaValidator = vine.compile(
    vine.object({
        formato,
        desde: fechaIso().optional().meta({ description: 'Por defecto: el día 1 del mes de hasta' }),
        hasta: fechaIso().optional(),
        caja_id: idEntidad().optional(),
        metodo: vine.enum(METODOS_PAGO).optional(),
    }),
)

export const reporteIvaValidator = vine.compile(vine.object({ formato, ...rango }))

export const reportePromesasValidator = vine.compile(
    vine.object({
        formato,
        ...rango,
        ...dimensiones,
        canal: vine.enum(['portal', 'ia', 'operador', 'supervisor'] as const).optional(),
    }),
)

export const reporteAltasValidator = vine.compile(
    vine.object({
        formato,
        ...rango,
        zona_id: idEntidad().optional(),
        router_id: idEntidad().optional(),
        plan_id: idEntidad().optional(),
    }),
)

export const reporteEgresosValidator = vine.compile(
    vine.object({
        formato,
        ...rango,
        categoria: vine.enum(CLAVES_CATEGORIA_EGRESO).optional(),
        metodo: vine.enum(['caja', 'banco', 'cuenta_bancaria'] as const).optional(),
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
    }),
)

export const listarCobrosPasarelaValidator = vine.compile(
    vine.object({
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
