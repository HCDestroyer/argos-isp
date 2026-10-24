/**
 * Fase 4 · cobros y bancos (A3, contrato de localización fiscal §10.3, §10.9 y §18). Datos
 * tipados con `Schema<'X'>` y con la forma de las respuestas capturadas de la API real
 * (`pnpm demo:datos` + pasarela falsa, liquidación, depósito, traslado, extracto y castigo el
 * 2026-10-18), con los ids del mundo de los fixtures:
 *
 * - Proveedores: la pasarela `falsa` (puente 1.1.10.01, liquida en Banco Industrial · Monetaria,
 *   subcuenta 16) y un agente (1.1.10.02, liquida en el banco principal, subcuenta 6).
 * - Pagos con proveedor (anticipos de los clientes 22 a 26, para no tocar facturas de otras
 *   pruebas): dos de la pasarela sin liquidar (uno con 12 días: anomalía sobre 7), uno liquidado,
 *   uno liquidado y luego anulado (contracargo pendiente) y uno del agente.
 * - Liquidación 1 de la pasarela (pagos 7003 y 7004), un depósito de caja y un traslado en
 *   tránsito, un extracto de Banco Industrial con una línea conciliada y cinco por conciliar, y dos
 *   reglas (comisiones y transferencias de clientes).
 */
import type { Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'

type Pago = Schema<'Pago'>
type Cuenta = Schema<'Cuenta'>
type Asiento = Schema<'Asiento'>
type Movimiento = Schema<'Movimiento'>

/** Movimiento del libro en una cuenta bancaria (lo que lee `GET /bancos/movimientos-sin-conciliar`). */
export interface MovimientoBancoFixture extends Schema<'MovimientoSinConciliar'> {
    cuenta_id: number
    empresa_id: number
}

/** Cuentas nuevas de la fase 4 en el plan de cuentas de los fixtures. */
export const CUENTA_PUENTE_PASARELA = 30
export const CUENTA_PUENTE_AGENTE = 31
export const CUENTA_TRANSITO = 32
export const CUENTA_ESTIMACION = 33
export const CUENTA_INCOBRABLES = 34
export const CUENTA_COMISIONES_BANCO = 35
export const CUENTA_OTROS_INGRESOS = 36
/** Subcuentas bancarias que ya existen en `libro/datos.ts`. */
export const CUENTA_BANCO_PRINCIPAL = 6
export const CUENTA_BANCO_INDUSTRIAL = 16
const CUENTA_CXC = 7
const CUENTA_COMISIONES_PASARELA = 15

const CREADA = '2026-10-01T15:00:00.000Z'

function cuenta(id: number, codigo: string, nombre: string, tipo: Cuenta['tipo']): Cuenta {
    return { id, codigo, nombre, tipo, padre_id: null, imputable: true, auxiliar_cliente: false, empresa_id: 1, activa: true, version: 1, created_at: CREADA, updated_at: CREADA }
}

export const cuentasFase4: Cuenta[] = [
    cuenta(CUENTA_PUENTE_PASARELA, '1.1.10.01', 'Cobros por liquidar · Pasarela en línea', 'activo'),
    cuenta(CUENTA_PUENTE_AGENTE, '1.1.10.02', 'Cobros por liquidar · Agentes BAM', 'activo'),
    cuenta(CUENTA_TRANSITO, '1.1.11', 'Fondos en tránsito', 'activo'),
    cuenta(CUENTA_ESTIMACION, '1.1.12', 'Estimación para cuentas incobrables', 'activo'),
    cuenta(CUENTA_INCOBRABLES, '5.3.02', 'Cuentas incobrables', 'gasto'),
    cuenta(CUENTA_COMISIONES_BANCO, '5.3.07', 'Gastos y comisiones bancarias', 'gasto'),
    cuenta(CUENTA_OTROS_INGRESOS, '4.1.03', 'Otros ingresos', 'ingreso'),
]

export const proveedoresCobro: Schema<'ProveedorCobro'>[] = [
    {
        id: 1,
        empresa_id: 1,
        metodo: 'pasarela',
        codigo: 'falsa',
        nombre: 'Pasarela en línea',
        cuenta_id: CUENTA_PUENTE_PASARELA,
        cuenta_codigo: '1.1.10.01',
        cuenta_liquidacion_id: CUENTA_BANCO_INDUSTRIAL,
        cuenta_liquidacion_codigo: '1.1.02.02',
        cuenta_liquidacion_nombre: 'Banco Industrial · Monetaria (****3456)',
        desde: '2026-10-01',
        activo: true,
        version: 1,
        created_at: CREADA,
        updated_at: CREADA,
    },
    {
        id: 2,
        empresa_id: 1,
        metodo: 'agente',
        codigo: 'agente',
        nombre: 'Agentes BAM',
        cuenta_id: CUENTA_PUENTE_AGENTE,
        cuenta_codigo: '1.1.10.02',
        cuenta_liquidacion_id: CUENTA_BANCO_PRINCIPAL,
        cuenta_liquidacion_codigo: '1.1.02.01',
        cuenta_liquidacion_nombre: 'Banco principal',
        desde: '2026-10-05',
        activo: true,
        version: 1,
        created_at: '2026-10-05T15:00:00.000Z',
        updated_at: '2026-10-05T15:00:00.000Z',
    },
]

interface SemillaPago {
    id: number
    clienteId: number
    clienteNombre: string
    metodo: 'pasarela' | 'agente'
    proveedor: number
    monto: string
    momento: string
    referencia: string
    liquidacion?: number
    anulado?: { en: string, motivo: string }
}

function pagoProveedor(semilla: SemillaPago): Pago {
    const actualizado = semilla.anulado?.en ?? semilla.momento
    return {
        id: semilla.id,
        empresa_id: 1,
        cobro_id: null,
        cliente_id: semilla.clienteId,
        cliente_nombre: semilla.clienteNombre,
        metodo: semilla.metodo,
        monto: semilla.monto,
        // Un pago con proveedor va al puente por el bruto: la comisión sale de la liquidación.
        comision: '0.00',
        referencia: semilla.referencia,
        caja_id: null,
        pasarela: semilla.metodo === 'pasarela' ? 'falsa' : null,
        estado: semilla.anulado ? 'anulado' : 'registrado',
        nota: semilla.metodo === 'pasarela' ? `Pago en línea (cobro ${semilla.id})` : null,
        registrado_por: null,
        aplicaciones: [],
        anulado_en: semilla.anulado?.en ?? null,
        motivo_anulacion: semilla.anulado?.motivo ?? null,
        banco_origen_id: null,
        banco_origen_nombre: null,
        cuenta_bancaria_id: null,
        cuenta_bancaria_nombre: null,
        proveedor_cobro_id: semilla.proveedor,
        proveedor_cobro_nombre: semilla.proveedor === 2 ? 'Agentes BAM' : 'Pasarela en línea',
        liquidacion_id: semilla.liquidacion ?? null,
        historico: false,
        origen: null,
        id_externo: null,
        version: semilla.anulado ? 2 : 1,
        created_at: semilla.momento,
        updated_at: actualizado,
    }
}

export const pagosProveedor: Pago[] = [
    pagoProveedor({ id: 7001, clienteId: 22, clienteNombre: 'Byron Estuardo Sical', metodo: 'pasarela', proveedor: 1, monto: '175.00', momento: '2026-10-14T16:05:00.000Z', referencia: 'falsa_7d4df19c2ddf43e48b8284df103f2b85' }),
    pagoProveedor({ id: 7002, clienteId: 23, clienteNombre: 'Karla Beatriz Fuentes', metodo: 'pasarela', proveedor: 1, monto: '93.33', momento: '2026-10-03T21:40:00.000Z', referencia: 'falsa_ce79d11617334aea9c302034a964c120' }),
    pagoProveedor({ id: 7003, clienteId: 24, clienteNombre: 'Óscar Rolando Pineda', metodo: 'pasarela', proveedor: 1, monto: '268.33', momento: '2026-10-08T15:12:00.000Z', referencia: 'falsa_aec086fd00e5447e99f51b0e8050f057', liquidacion: 1 }),
    pagoProveedor({ id: 7004, clienteId: 25, clienteNombre: 'Dulce María Toj', metodo: 'pasarela', proveedor: 1, monto: '50.00', momento: '2026-10-08T17:30:00.000Z', referencia: 'falsa_1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e', liquidacion: 1, anulado: { en: '2026-10-12T14:00:00.000Z', motivo: 'Contracargo del emisor de la tarjeta' } }),
    pagoProveedor({ id: 7005, clienteId: 26, clienteNombre: 'Taller Mecánico Hermanos Ruiz', metodo: 'agente', proveedor: 2, monto: '150.00', momento: '2026-10-12T19:20:00.000Z', referencia: 'AG-88120' }),
]

export const liquidaciones: Schema<'LiquidacionCobro'>[] = [
    {
        id: 1,
        empresa_id: 1,
        proveedor_cobro_id: 1,
        proveedor_codigo: 'falsa',
        proveedor_nombre: 'Pasarela en línea',
        fecha: '2026-10-10',
        referencia: 'LIQ-2026-10-10',
        bruto: '318.33',
        comision: '9.55',
        neto: '308.78',
        cuenta_id: CUENTA_BANCO_INDUSTRIAL,
        cuenta_codigo: '1.1.02.02',
        asiento_id: 9003,
        archivo: 'liquidacion-10oct.csv',
        sha256: '9f2c4e1b7a3d5f60818e2b4c6d7a9e0f1b2c3d4e5f60718293a4b5c6d7e8f901',
        nota: null,
        registrado_por: 1,
        created_at: '2026-10-10T18:00:00.000Z',
        pagos: [
            { pago_id: 7003, tipo: 'cobro', monto: '268.33' },
            { pago_id: 7004, tipo: 'cobro', monto: '50.00' },
        ],
    },
]

export const depositos: Schema<'Deposito'>[] = [
    {
        id: 1,
        empresa_id: 1,
        caja_id: 1,
        caja_nombre: 'Caja Central',
        turno_id: 40,
        cuenta_id: CUENTA_BANCO_INDUSTRIAL,
        cuenta_codigo: '1.1.02.02',
        cuenta_nombre: 'Banco Industrial · Monetaria (****3456)',
        cuenta_bancaria_id: 2,
        banco_id: null,
        monto: '900.00',
        boleta: 'B-4471',
        fecha: '2026-10-14',
        estado: 'en_transito',
        acreditado_en: null,
        registrado_por: 2,
        created_at: '2026-10-14T22:10:00.000Z',
    },
]

export const traslados: Schema<'Traslado'>[] = [
    {
        id: 1,
        empresa_id: 1,
        cuenta_origen_id: CUENTA_BANCO_PRINCIPAL,
        cuenta_origen_codigo: '1.1.02.01',
        cuenta_destino_id: CUENTA_BANCO_INDUSTRIAL,
        cuenta_destino_codigo: '1.1.02.02',
        monto: '2000.00',
        fecha: '2026-10-14',
        referencia: 'TR-0042',
        estado: 'en_transito',
        acreditado_en: null,
        registrado_por: 1,
        created_at: '2026-10-14T20:00:00.000Z',
    },
]

/**
 * Movimientos del libro en las cuentas bancarias que el extracto puede conciliar: el saldo de
 * apertura, la llegada de la liquidación, una transferencia de cliente y un egreso de energía.
 */
export const movimientosBanco: MovimientoBancoFixture[] = [
    { movimiento_id: 9100, asiento_id: 9000, origen_tipo: 'ajuste', origen_id: null, fecha: '2026-09-30', descripcion: 'Saldo al 30/09/2026', monto: '5000.00', cuenta_id: CUENTA_BANCO_INDUSTRIAL, empresa_id: 1 },
    { movimiento_id: 9101, asiento_id: 9003, origen_tipo: 'liquidacion_cobro', origen_id: 1, fecha: '2026-10-10', descripcion: 'Liquidación 1 (LIQ-2026-10-10) de Pasarela en línea: 2 pago(s)', monto: '308.78', cuenta_id: CUENTA_BANCO_INDUSTRIAL, empresa_id: 1 },
    { movimiento_id: 9102, asiento_id: 9004, origen_tipo: 'pago', origen_id: 6102, fecha: '2026-10-12', descripcion: 'Pago 6102 · transferencia · ref. TRF-55120 · facturas —', monto: '450.00', cuenta_id: CUENTA_BANCO_INDUSTRIAL, empresa_id: 1 },
    { movimiento_id: 9103, asiento_id: 9005, origen_tipo: 'egreso', origen_id: 3, fecha: '2026-10-13', descripcion: 'Egreso 3 · energía · EEGSA', monto: '-1850.40', cuenta_id: CUENTA_BANCO_INDUSTRIAL, empresa_id: 1 },
]

function huellaDe(linea: { fecha: string, monto: string, referencia: string | null, descripcion: string }, vez: number): string {
    return `${linea.fecha}|${new Decimal(linea.monto).toFixed(2)}|${(linea.referencia ?? '').trim().toLowerCase()}|${linea.descripcion.trim().toLowerCase()}|${vez}`
}

export { huellaDe }

export const extractos: Schema<'Extracto'>[] = [
    {
        id: 1,
        empresa_id: 1,
        cuenta_id: CUENTA_BANCO_INDUSTRIAL,
        cuenta_codigo: '1.1.02.02',
        cuenta_nombre: 'Banco Industrial · Monetaria (****3456)',
        cuenta_bancaria_id: 2,
        desde: '2026-10-01',
        hasta: '2026-10-14',
        saldo_inicial: '5000.00',
        saldo_final: '4795.48',
        archivo: 'bi-monetaria-oct.csv',
        sha256: '3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b',
        motivo_no_encadena: null,
        lineas: 6,
        conciliadas: 1,
        importado_por: 1,
        created_at: '2026-10-15T14:00:00.000Z',
    },
]

/** Líneas guardadas (sin `conciliada`, `conciliacion_id` ni `movimientos`: se calculan de las conciliaciones). */
export interface LineaGuardada {
    id: number
    extracto_id: number
    empresa_id: number
    cuenta_id: number
    orden: number
    fecha: string
    descripcion: string
    referencia: string | null
    monto: string
    saldo: string | null
    huella: string
}

const LINEAS: [string, string, string | null, string, string][] = [
    ['2026-10-10', 'ABONO PASARELA LIQ', 'LIQ-2026-10-10', '308.78', '5308.78'],
    ['2026-10-12', 'CREDITO TRANSFERENCIA ACH', 'TRF-55120', '450.00', '5758.78'],
    ['2026-10-13', 'PAGO SERVICIO EEGSA', null, '-1850.40', '3908.38'],
    ['2026-10-14', 'DEPOSITO EN EFECTIVO', 'B-4471', '900.00', '4808.38'],
    ['2026-10-14', 'COMISION MANEJO DE CUENTA', null, '-15.00', '4793.38'],
    ['2026-10-14', 'INTERESES GANADOS', null, '2.10', '4795.48'],
]

export const lineasExtracto: LineaGuardada[] = LINEAS.map(([fecha, descripcion, referencia, monto, saldo], indice) => ({
    id: indice + 1,
    extracto_id: 1,
    empresa_id: 1,
    cuenta_id: CUENTA_BANCO_INDUSTRIAL,
    orden: indice + 1,
    fecha,
    descripcion,
    referencia,
    monto,
    saldo,
    huella: huellaDe({ fecha, monto, referencia, descripcion }, 1),
}))

export const conciliaciones: Schema<'Conciliacion'>[] = [
    {
        id: 1,
        grupo: '9936a131-ddd1-48cd-a401-8e81403dcf26',
        empresa_id: 1,
        cuenta_id: CUENTA_BANCO_INDUSTRIAL,
        linea_id: 1,
        monto: '308.78',
        regla_id: null,
        creado_por: 1,
        created_at: '2026-10-15T14:05:00.000Z',
        anulada: false,
        motivo_anulacion: null,
        movimientos: [{ conciliacion_id: 1, movimiento_id: 9101, asiento_id: 9003, origen_tipo: 'liquidacion_cobro', origen_id: 1, fecha: '2026-10-10', descripcion: 'Liquidación 1 (LIQ-2026-10-10) de Pasarela en línea: 2 pago(s)', monto: '308.78' }],
    },
]

export const reglasConciliacion: Schema<'ReglaConciliacion'>[] = [
    {
        id: 1,
        empresa_id: 1,
        nombre: 'Comisiones del banco',
        cuenta_id: null,
        tipo_condicion: 'contiene',
        patron: 'comision',
        monto_min: null,
        monto_max: '0.00',
        accion: 'contrapartida',
        contrapartida_cuenta_id: CUENTA_COMISIONES_BANCO,
        contrapartida: '5.3.07',
        prioridad: 10,
        activa: true,
        version: 1,
        created_at: '2026-10-15T13:50:00.000Z',
        updated_at: '2026-10-15T13:50:00.000Z',
    },
    {
        id: 2,
        empresa_id: 1,
        nombre: 'Transferencias de clientes',
        cuenta_id: CUENTA_BANCO_INDUSTRIAL,
        tipo_condicion: 'regex',
        patron: '^CREDITO TRANSF',
        monto_min: '0.01',
        monto_max: null,
        accion: 'cliente',
        contrapartida_cuenta_id: null,
        contrapartida: null,
        prioridad: 20,
        activa: true,
        version: 1,
        created_at: '2026-10-15T13:52:00.000Z',
        updated_at: '2026-10-15T13:52:00.000Z',
    },
]

/** Una estimación del año anterior (para que la lista no arranque vacía). */
export const provisiones: Schema<'ProvisionCartera'>[] = [
    {
        id: 1,
        empresa_id: 1,
        anio: 2025,
        fecha: '2025-12-31',
        base: '18450.00',
        porcentaje: '3.000000',
        tope: '553.50',
        saldo_anterior: '0.00',
        monto: '553.50',
        asiento_id: 9006,
        registrado_por: 1,
        created_at: '2026-01-05T15:00:00.000Z',
    },
]

function mov(id: number, cuentaId: number, codigo: string, nombre: string, lado: 'debe' | 'haber', monto: string, clienteId: number | null = null): Movimiento {
    return { id, cuenta_id: cuentaId, cuenta_codigo: codigo, cuenta_nombre: nombre, debe: lado === 'debe' ? monto : '0.00', haber: lado === 'haber' ? monto : '0.00', cliente_id: clienteId }
}

/** Asientos de la fase 4: pagos al puente, la liquidación y el reverso del pago anulado. */
export function asientosFase4(): Asiento[] {
    const lista: Asiento[] = pagosProveedor.map((pago, indice) => {
        const puente = pago.proveedor_cobro_id === 2 ? { id: CUENTA_PUENTE_AGENTE, codigo: '1.1.10.02', nombre: 'Cobros por liquidar · Agentes BAM' } : { id: CUENTA_PUENTE_PASARELA, codigo: '1.1.10.01', nombre: 'Cobros por liquidar · Pasarela en línea' }
        return {
            id: 9010 + indice,
            empresa_id: 1,
            fecha: pago.created_at.slice(0, 10),
            descripcion: `Pago ${pago.id} · ${pago.metodo}${pago.referencia ? ` · ref. ${pago.referencia}` : ''} · anticipo`,
            origen_tipo: 'pago',
            origen_id: pago.id,
            // al puente de cobros (sin caja ni banco): diario de cobros
            diario: 'COB',
            reversa_de: null,
            created_by: null,
            created_at: pago.created_at,
            movimientos: [
                mov(91000 + indice * 2, puente.id, puente.codigo, puente.nombre, 'debe', pago.monto),
                mov(91001 + indice * 2, CUENTA_CXC, '1.1.03', 'Cuentas por cobrar clientes', 'haber', pago.monto, pago.cliente_id),
            ],
        }
    })
    lista.push({
        id: 9003,
        empresa_id: 1,
        fecha: '2026-10-10',
        descripcion: 'Liquidación 1 (LIQ-2026-10-10) de Pasarela en línea: 2 pago(s)',
        origen_tipo: 'liquidacion_cobro',
        origen_id: 1,
        // toca la subcuenta de Banco Industrial (cuenta bancaria 2)
        diario: 'BAN-2',
        reversa_de: null,
        created_by: 1,
        created_at: '2026-10-10T18:00:00.000Z',
        movimientos: [
            mov(91100, CUENTA_BANCO_INDUSTRIAL, '1.1.02.02', 'Banco Industrial · Monetaria (****3456)', 'debe', '308.78'),
            mov(91101, CUENTA_COMISIONES_PASARELA, '5.1.02', 'Comisiones de pasarelas', 'debe', '9.55'),
            mov(91102, CUENTA_PUENTE_PASARELA, '1.1.10.01', 'Cobros por liquidar · Pasarela en línea', 'haber', '318.33'),
        ],
    })
    return lista
}
