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
    lista,
    nulable,
    objeto,
    texto,
} from '#shared/openapi/esquemas'

/**
 * Schemas de respuesta de cobros y bancos (contrato de localización fiscal §10.3 y §10.9, fase 4).
 */

export const ProveedorCobro = definirEsquema(
    'ProveedorCobro',
    objeto({
        id,
        empresa_id: id,
        metodo: enumerado(['pasarela', 'agente', 'debito']),
        codigo: { ...texto, description: 'Nombre normalizado de la pasarela, o el método' },
        nombre: texto,
        cuenta_id: { ...id, description: 'Subcuenta 1.1.10.NN Cobros por liquidar del proveedor' },
        cuenta_codigo: texto,
        cuenta_liquidacion_id: { ...id, description: 'Banco donde deposita las liquidaciones' },
        cuenta_liquidacion_codigo: texto,
        cuenta_liquidacion_nombre: texto,
        desde: { ...fecha, description: 'Fecha de corte: sus pagos desde este día van a 1.1.10.NN' },
        activo: booleano,
        ...auditable,
    }),
)

const PagoPorLiquidar = definirEsquema(
    'PagoPorLiquidar',
    objeto({
        pago_id: id,
        tipo: {
            ...enumerado(['cobro', 'contracargo']),
            description: 'contracargo = pago liquidado y luego anulado (resta)',
        },
        cliente_id: id,
        monto: Dinero,
        referencia: nulable(texto),
        fecha,
        dias: { ...entero, description: 'Días desde el pago' },
    }),
)

export const ResumenCobrosPorLiquidar = definirEsquema(
    'ResumenCobrosPorLiquidar',
    objeto({
        proveedor_cobro_id: id,
        empresa_id: id,
        metodo: enumerado(['pasarela', 'agente', 'debito']),
        codigo: texto,
        nombre: texto,
        cuenta_codigo: texto,
        saldo_libro: { ...Dinero, description: 'Saldo de 1.1.10.NN en el libro de la empresa' },
        pendiente: { ...Dinero, description: 'Σ pagos sin liquidar − Σ contracargos pendientes' },
        diferencia: { ...Dinero, description: 'saldo_libro − pendiente (0 = el puente cuadra)' },
        cuadra: booleano,
        dias_limite: { ...entero, description: 'cobros_liquidar_dias de la empresa' },
        pagos: lista(PagoPorLiquidar),
        anomalias: {
            ...lista(PagoPorLiquidar),
            description: 'Pagos sin liquidar más antiguos que dias_limite',
        },
    }),
)

export const LiquidacionCobro = definirEsquema(
    'LiquidacionCobro',
    objeto({
        id,
        empresa_id: id,
        proveedor_cobro_id: id,
        proveedor_codigo: texto,
        proveedor_nombre: texto,
        fecha,
        referencia: texto,
        bruto: Dinero,
        comision: Dinero,
        neto: Dinero,
        cuenta_id: { ...id, description: 'Banco que recibió el neto' },
        cuenta_codigo: texto,
        asiento_id: id,
        archivo: nulable(texto),
        sha256: nulable(texto),
        nota: nulable(texto),
        registrado_por: nulable(id),
        created_at: instante,
        pagos: lista(objeto({ pago_id: id, tipo: enumerado(['cobro', 'contracargo']), monto: Dinero })),
    }),
)

const estadoTransito = {
    ...enumerado(['en_transito', 'acreditado']),
    description: 'en_transito = en 1.1.11; acreditado = conciliado con el extracto del banco de destino',
}

export const Deposito = definirEsquema(
    'Deposito',
    objeto({
        id,
        empresa_id: id,
        caja_id: id,
        caja_nombre: texto,
        turno_id: { ...id, description: 'Turno del que salió el efectivo (baja su esperado)' },
        cuenta_id: { ...id, description: 'Subcuenta 1.1.02.NN que recibe el depósito' },
        cuenta_codigo: texto,
        cuenta_nombre: texto,
        cuenta_bancaria_id: nulable(id),
        banco_id: nulable(id),
        monto: Dinero,
        boleta: texto,
        fecha,
        estado: estadoTransito,
        acreditado_en: { ...nulable(fecha), description: 'Fecha de la línea del extracto que lo concilió' },
        registrado_por: nulable(id),
        created_at: instante,
    }),
)

export const Traslado = definirEsquema(
    'Traslado',
    objeto({
        id,
        empresa_id: id,
        cuenta_origen_id: id,
        cuenta_origen_codigo: texto,
        cuenta_destino_id: id,
        cuenta_destino_codigo: texto,
        monto: Dinero,
        fecha,
        referencia: texto,
        estado: estadoTransito,
        acreditado_en: nulable(fecha),
        registrado_por: nulable(id),
        created_at: instante,
    }),
)

export const ResumenFondosEnTransito = definirEsquema(
    'ResumenFondosEnTransito',
    objeto({
        empresa_id: id,
        saldo_libro: { ...Dinero, description: 'Saldo de 1.1.11 en el libro de la empresa' },
        pendiente: { ...Dinero, description: 'Σ depósitos y traslados sin acreditar' },
        diferencia: Dinero,
        cuadra: booleano,
        depositos: { ...entero, description: 'Depósitos en tránsito' },
        traslados: { ...entero, description: 'Traslados en tránsito' },
    }),
)

export const Extracto = definirEsquema(
    'Extracto',
    objeto({
        id,
        empresa_id: id,
        cuenta_id: { ...id, description: 'Subcuenta 1.1.02.NN del extracto' },
        cuenta_codigo: texto,
        cuenta_nombre: texto,
        cuenta_bancaria_id: nulable(id),
        desde: fecha,
        hasta: fecha,
        saldo_inicial: Dinero,
        saldo_final: Dinero,
        archivo: nulable(texto),
        sha256: nulable(texto),
        motivo_no_encadena: {
            ...nulable(texto),
            description: 'Motivo con el que se forzó un saldo inicial distinto del final anterior',
        },
        lineas: entero,
        conciliadas: entero,
        importado_por: nulable(id),
        created_at: instante,
    }),
)

const MovimientoConciliado = definirEsquema(
    'MovimientoConciliado',
    objeto({
        conciliacion_id: { ...id, description: 'Fila de ledger.conciliaciones' },
        movimiento_id: id,
        asiento_id: id,
        origen_tipo: texto,
        origen_id: nulable(id),
        fecha,
        descripcion: texto,
        monto: { ...Dinero, description: 'Neto del movimiento en la cuenta (debe − haber)' },
    }),
)

export const LineaExtracto = definirEsquema(
    'LineaExtracto',
    objeto({
        id,
        extracto_id: id,
        empresa_id: id,
        cuenta_id: id,
        orden: entero,
        fecha,
        descripcion: texto,
        referencia: nulable(texto),
        monto: { ...Dinero, description: '+ entra a la cuenta, − sale' },
        saldo: nulable(Dinero),
        huella: { ...texto, description: 'Única por cuenta: detecta líneas ya importadas' },
        conciliada: booleano,
        conciliacion_id: {
            ...nulable(id),
            description: 'Para anularla: POST /bancos/conciliaciones/:id/anular',
        },
        movimientos: lista(MovimientoConciliado),
    }),
)

export const Conciliacion = definirEsquema(
    'Conciliacion',
    objeto({
        id: { ...id, description: 'Primera fila del grupo' },
        grupo: texto,
        empresa_id: id,
        cuenta_id: id,
        linea_id: id,
        monto: Dinero,
        regla_id: nulable(id),
        creado_por: nulable(id),
        created_at: instante,
        anulada: booleano,
        motivo_anulacion: nulable(texto),
        movimientos: lista(MovimientoConciliado),
    }),
)

export const MovimientoSinConciliar = definirEsquema(
    'MovimientoSinConciliar',
    objeto({
        movimiento_id: id,
        asiento_id: id,
        origen_tipo: texto,
        origen_id: nulable(id),
        fecha,
        descripcion: texto,
        monto: { ...Dinero, description: 'debe − haber en la cuenta' },
    }),
)

export const ReglaConciliacion = definirEsquema(
    'ReglaConciliacion',
    objeto({
        id,
        empresa_id: id,
        nombre: texto,
        cuenta_id: { ...nulable(id), description: 'Solo esta cuenta bancaria; null = todas' },
        tipo_condicion: enumerado(['contiene', 'regex']),
        patron: texto,
        monto_min: nulable(Dinero),
        monto_max: nulable(Dinero),
        accion: enumerado(['contrapartida', 'cliente']),
        contrapartida_cuenta_id: nulable(id),
        contrapartida: { ...nulable(texto), description: 'Código de la contrapartida' },
        prioridad: entero,
        activa: booleano,
        ...auditable,
    }),
)

export const ResultadoAplicarReglas = definirEsquema(
    'ResultadoAplicarReglas',
    objeto({
        extracto_id: id,
        conciliadas: lista(
            objeto({
                linea_id: id,
                regla_id: id,
                accion: enumerado(['contrapartida', 'cliente']),
                conciliacion_id: id,
            }),
        ),
        sin_pago: { ...lista(id), description: 'Líneas con regla cliente sin un pago único que coincida' },
        sin_regla: lista(id),
    }),
)

const PartidaEnTransito = definirEsquema(
    'PartidaEnTransito',
    objeto({ id, fecha, descripcion: texto, monto: Dinero }),
)

export const ResumenConciliacionBancaria = definirEsquema(
    'ResumenConciliacionBancaria',
    objeto({
        empresa_id: id,
        cuenta_id: id,
        cuenta_codigo: texto,
        cuenta_nombre: texto,
        fecha,
        saldo_libro: { ...Dinero, description: 'Saldo de la cuenta en el libro de la empresa al día' },
        saldo_extracto: {
            ...nulable(Dinero),
            description: 'Saldo inicial del primer extracto + Σ líneas al día',
        },
        desde: { ...nulable(fecha), description: 'Primer día cubierto por extractos' },
        diferencia_apertura: {
            ...Dinero,
            description: 'Saldo inicial del primer extracto − libro antes de esa fecha',
        },
        libro_en_transito: {
            ...lista(PartidaEnTransito),
            description: 'Movimientos del libro sin conciliar al día (id = movimiento)',
        },
        total_libro_en_transito: Dinero,
        extracto_en_transito: {
            ...lista(PartidaEnTransito),
            description: 'Líneas del extracto sin conciliar al día (id = línea)',
        },
        total_extracto_en_transito: Dinero,
        diferencia: {
            ...Dinero,
            description:
                'saldo_extracto − (saldo_libro − libro en tránsito + extracto en tránsito); 0 = cuadra',
        },
        cuadra: booleano,
    }),
)
