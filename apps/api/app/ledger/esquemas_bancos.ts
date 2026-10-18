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
