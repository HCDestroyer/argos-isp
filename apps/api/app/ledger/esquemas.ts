import {
    Dinero,
    auditable,
    booleano,
    definirEsquema,
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
 * Schemas de respuesta del módulo ledger (libro, cajas).
 */

export const Cuenta = definirEsquema(
    'Cuenta',
    objeto({
        id,
        codigo: texto,
        nombre: texto,
        tipo: enumerado(['activo', 'pasivo', 'ingreso', 'gasto']),
        padre_id: nulable(id),
        activa: booleano,
        ...auditable,
    }),
)

export const Movimiento = definirEsquema(
    'Movimiento',
    objeto({
        id,
        cuenta_id: id,
        cuenta_codigo: texto,
        cuenta_nombre: texto,
        debe: Dinero,
        haber: Dinero,
        cliente_id: nulable(id),
    }),
)

export const Asiento = definirEsquema(
    'Asiento',
    objeto({
        id,
        fecha,
        descripcion: texto,
        origen_tipo: enumerado([
            'factura',
            'pago',
            'mora',
            'nota_credito',
            'egreso',
            'cierre_caja',
            'ajuste',
        ]),
        origen_id: nulable(id),
        created_by: nulable(id),
        created_at: instante,
        movimientos: lista(Movimiento),
    }),
)

export const LineaMayor = definirEsquema(
    'LineaMayor',
    objeto({
        movimiento_id: id,
        asiento_id: id,
        fecha,
        descripcion: texto,
        debe: Dinero,
        haber: Dinero,
        saldo: Dinero,
        cliente_id: nulable(id),
    }),
)

export const Mayor = definirEsquema(
    'Mayor',
    objeto({
        cuenta: Cuenta,
        saldo_inicial: Dinero,
        saldo_final: Dinero,
        data: lista(LineaMayor),
        nextCursor: { type: ['string', 'null'] },
    }),
)

export const Caja = definirEsquema(
    'Caja',
    objeto({
        id,
        nombre: texto,
        cajero_id: nulable(id),
        cuenta_id: id,
        activa: booleano,
        turno_abierto_id: nulable(id),
        ...auditable,
    }),
)

export const CajaTurno = definirEsquema(
    'CajaTurno',
    objeto({
        id,
        caja_id: id,
        abierto_en: instante,
        fondo_inicial: Dinero,
        cerrado_en: nulable(instante),
        esperado: nulable(Dinero),
        contado: nulable(Dinero),
        diferencia: nulable(Dinero),
        motivo: nulable(texto),
        ...auditable,
    }),
)
