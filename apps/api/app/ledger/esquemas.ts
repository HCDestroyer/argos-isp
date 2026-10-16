import { CLAVES_CATEGORIA_EGRESO } from '#ledger/plan_cuentas'
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
        imputable: { ...booleano, description: 'Recibe movimientos (false = cuenta de agrupación)' },
        auxiliar_cliente: {
            ...booleano,
            description: 'Lleva auxiliar por cliente (CxC, anticipos): cada movimiento exige cliente_id',
        },
        activa: booleano,
        ...auditable,
    }),
)

export const Movimiento = definirEsquema(
    'Movimiento',
    objeto(
        {
            id,
            cuenta_id: id,
            cuenta_codigo: texto,
            cuenta_nombre: texto,
            debe: Dinero,
            haber: Dinero,
            cliente_id: nulable(id),
            cliente_nombre: { ...nulable(texto), description: 'Cliente del auxiliar (CxC, anticipos)' },
        },
        ['cliente_nombre'],
    ),
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
        reversa_de: { ...nulable(id), description: 'Asiento que este revierte (correcciones por reverso)' },
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
    objeto(
        {
            id,
            nombre: texto,
            cajero_id: nulable(id),
            cajero_nombre: { ...nulable(texto), description: 'Cajero asignado a la caja' },
            cuenta_id: id,
            activa: booleano,
            turno_abierto_id: nulable(id),
            turno_abierto_por: { ...nulable(id), description: 'Usuario que abrió el turno abierto' },
            turno_abierto_por_nombre: nulable(texto),
            ...auditable,
        },
        ['cajero_nombre', 'turno_abierto_por', 'turno_abierto_por_nombre'],
    ),
)

export const CajaTurno = definirEsquema(
    'CajaTurno',
    objeto(
        {
            id,
            caja_id: id,
            abierto_en: instante,
            fondo_inicial: Dinero,
            cerrado_en: nulable(instante),
            esperado: nulable(Dinero),
            contado: nulable(Dinero),
            diferencia: nulable(Dinero),
            motivo: nulable(texto),
            abierto_por: { ...nulable(id), description: 'Usuario que abrió el turno' },
            cerrado_por: { ...nulable(id), description: 'Usuario que cerró el turno' },
            abierto_por_nombre: nulable(texto),
            cerrado_por_nombre: nulable(texto),
            ...auditable,
        },
        ['abierto_por', 'cerrado_por', 'abierto_por_nombre', 'cerrado_por_nombre'],
    ),
)

export const CategoriaEgreso = definirEsquema(
    'CategoriaEgreso',
    objeto({
        id,
        clave: enumerado(CLAVES_CATEGORIA_EGRESO),
        nombre: texto,
        cuenta_id: id,
        cuenta_codigo: texto,
        cuenta_nombre: texto,
    }),
)

export const Egreso = definirEsquema(
    'Egreso',
    objeto({
        id,
        fecha,
        categoria: enumerado(CLAVES_CATEGORIA_EGRESO),
        categoria_nombre: texto,
        cuenta_codigo: { ...texto, description: 'Cuenta de gasto del plan' },
        proveedor: nulable(texto),
        descripcion: nulable(texto),
        comprobante: { ...nulable(texto), description: 'Número o serie del documento del proveedor' },
        monto: Dinero,
        metodo: enumerado(['caja', 'banco', 'cuenta_bancaria']),
        caja_id: nulable(id),
        caja_nombre: nulable(texto),
        turno_id: { ...nulable(id), description: 'Turno de caja abierto cuando salió el efectivo' },
        banco_id: nulable(id),
        banco_nombre: nulable(texto),
        cuenta_bancaria_id: nulable(id),
        cuenta_bancaria_nombre: nulable(texto),
        asiento_id: nulable(id),
        estado: enumerado(['registrado', 'anulado']),
        registrado_por: nulable(id),
        registrado_por_nombre: nulable(texto),
        anulado_en: nulable(instante),
        anulado_por: nulable(id),
        motivo_anulacion: nulable(texto),
        asiento_reverso_id: nulable(id),
        ...auditable,
    }),
)

export const CierrePeriodo = definirEsquema(
    'CierrePeriodo',
    objeto({
        id,
        periodo: { type: 'string', pattern: '^\\d{4}-\\d{2}$', description: 'YYYY-MM' },
        estado: enumerado(['cerrado', 'reabierto']),
        cerrado_en: instante,
        cerrado_por: nulable(id),
        cerrado_por_nombre: nulable(texto),
        resumen: {
            type: ['object', 'null'],
            additionalProperties: true,
            description:
                'Al cerrar: desde, hasta, asientos, debe, haber y cuentas[] (codigo, nombre, debe, haber) del mes',
        },
        reabierto_en: nulable(instante),
        reabierto_por: nulable(id),
        reabierto_por_nombre: nulable(texto),
        motivo_reapertura: nulable(texto),
    }),
)
