import type { Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import { facturas, pagos } from '../facturacion/datos'

type Cuenta = Schema<'Cuenta'>
type Asiento = Schema<'Asiento'>
type Movimiento = Schema<'Movimiento'>

const CREADA = '2026-08-01T12:00:00.000Z'

/**
 * Subcuentas de una empresa (`ledger.cuentas.empresa_id`, A3): las de cajas y cuentas bancarias.
 * El resto del catálogo es común (`null`).
 */
const EMPRESA_DE_CUENTA: Record<number, number> = { 3: 1, 4: 1, 5: 1, 16: 1, 17: 1, 18: 1, 19: 2 }

function cuenta(id: number, codigo: string, nombre: string, tipo: Cuenta['tipo'], padre: number | null, imputable: boolean, auxiliar = false): Cuenta {
    return {
        id,
        codigo,
        nombre,
        tipo,
        padre_id: padre,
        imputable,
        auxiliar_cliente: auxiliar,
        empresa_id: EMPRESA_DE_CUENTA[id] ?? null,
        activa: true,
        version: 1,
        created_at: CREADA,
        updated_at: CREADA,
    }
}

/**
 * Plan de cuentas con los mismos códigos que `apps/api/app/ledger/plan_cuentas.ts`. Los ids 3, 4
 * y 5 son las cuentas de las cajas de `facturacion/datos.ts` (`Caja.cuenta_id`).
 */
export const cuentas: Cuenta[] = [
    cuenta(1, '1', 'Activo', 'activo', null, false),
    cuenta(2, '1.1.01', 'Cajas', 'activo', 1, false),
    cuenta(3, '1.1.01.01', 'Caja principal', 'activo', 2, true),
    cuenta(4, '1.1.01.02', 'Caja Oficina', 'activo', 2, true),
    cuenta(5, '1.1.01.03', 'Caja Mixco', 'activo', 2, true),
    cuenta(6, '1.1.02.01', 'Banco principal', 'activo', 1, true),
    cuenta(7, '1.1.03', 'Cuentas por cobrar clientes', 'activo', 1, true, true),
    cuenta(8, '2', 'Pasivo', 'pasivo', null, false),
    cuenta(9, '2.1.01', 'Anticipos de clientes', 'pasivo', 8, true, true),
    cuenta(10, '2.1.02', 'IVA débito fiscal', 'pasivo', 8, true),
    cuenta(11, '4', 'Ingresos', 'ingreso', null, false),
    cuenta(12, '4.1.01', 'Ingresos por servicio de internet', 'ingreso', 11, true),
    cuenta(13, '4.1.02', 'Recargos por mora', 'ingreso', 11, true),
    cuenta(14, '5', 'Gastos', 'gasto', null, false),
    cuenta(15, '5.1.02', 'Comisiones de pasarelas', 'gasto', 14, true),
    // Decisión B (A3): el saldo pequeño de un pago se cierra como gasto.
    cuenta(20, '5.3.05', 'Diferencias de cobro', 'gasto', 14, true),
    // Decisión del PM (A3): lo regalado sin cobrar (bonificaciones) va a gasto contra el ingreso.
    cuenta(21, '5.1.01', 'Descuentos y bonificaciones', 'gasto', 14, true),
    // Subcuentas de las cuentas bancarias propias (`bancos/datos.ts`), como las crea A3.
    cuenta(16, '1.1.02.02', 'Banco Industrial · Monetaria (****3456)', 'activo', 1, true),
    cuenta(17, '1.1.02.03', 'Banco Industrial · Dólares (****7651)', 'activo', 1, true),
    cuenta(18, '1.1.02.04', 'Banco G&T Continental · Cuenta anterior (****5678)', 'activo', 1, true),
    // Caja de Fibra del Sur (empresa 2).
    cuenta(19, '1.1.01.04', 'Caja Sur', 'activo', 2, true),
    // Inventario de premios de sorteo: la contrapartida `cuenta` de un bien (lista blanca, H25).
    cuenta(22, '1.1.14', 'Inventario de premios', 'activo', 1, true),
]

export const CUENTA_CXC = 7
export const CUENTA_IVA = 10
export const CUENTA_INGRESOS = 12
export const CUENTA_BANCO = 6
export const CUENTA_BONIFICACIONES = 21

/** Cuenta de cada caja (`Caja.cuenta_id`). */
const CUENTA_DE_CAJA: Record<number, number> = { 1: 3, 2: 4, 3: 5, 4: 19 }

let siguienteMovimiento = 1

/** Movimiento de un asiento; `debe` o `haber` en cero, como `ledger.movimientos`. */
export function movimiento(cuentaId: number, lado: 'debe' | 'haber', monto: string, clienteId: number | null = null): Movimiento {
    const datos = cuentas.find(c => c.id === cuentaId)
    return {
        id: siguienteMovimiento++,
        cuenta_id: cuentaId,
        cuenta_codigo: datos?.codigo ?? '',
        cuenta_nombre: datos?.nombre ?? '',
        debe: lado === 'debe' ? monto : '0.00',
        haber: lado === 'haber' ? monto : '0.00',
        cliente_id: clienteId,
    }
}

/** Fecha contable (día en Guatemala) de un instante UTC. */
export function fechaGuatemala(instante: string): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guatemala' }).format(new Date(instante))
}

/** Cuenta de destino de un pago según su método, como `registrarPago`. */
export function cuentaDePago(pago: Schema<'Pago'>): number {
    if (pago.metodo === 'caja') {
        return CUENTA_DE_CAJA[pago.caja_id ?? 1] ?? 3
    }
    return CUENTA_BANCO
}

/** Asiento de una factura: CxC al debe; ingreso e IVA al haber. */
export function asientoFactura(id: number, factura: Schema<'Factura'>): Asiento {
    return {
        id,
        empresa_id: factura.empresa_id,
        fecha: fechaGuatemala(factura.emitida_en),
        descripcion: `Factura ${factura.id} · servicio ${factura.servicio_id ?? '—'} · periodo ${factura.periodo}`,
        origen_tipo: 'factura',
        origen_id: factura.id,
        reversa_de: null,
        created_by: null,
        created_at: factura.emitida_en,
        movimientos: [
            movimiento(CUENTA_CXC, 'debe', factura.total, factura.cliente_id),
            movimiento(CUENTA_INGRESOS, 'haber', factura.subtotal),
            movimiento(CUENTA_IVA, 'haber', factura.iva),
        ],
    }
}

/** Asiento de un pago: caja o banco al debe; CxC del cliente al haber. */
export function asientoPago(id: number, pago: Schema<'Pago'>): Asiento {
    return {
        id,
        empresa_id: pago.empresa_id,
        fecha: fechaGuatemala(pago.created_at),
        descripcion: `Pago ${pago.id} · ${pago.metodo}${pago.referencia ? ` · ref. ${pago.referencia}` : ''} · facturas ${pago.aplicaciones.map(a => a.factura_id).join(', ')}`,
        origen_tipo: 'pago',
        origen_id: pago.id,
        reversa_de: null,
        created_by: pago.registrado_por,
        created_at: pago.created_at,
        movimientos: [
            movimiento(cuentaDePago(pago), 'debe', pago.monto),
            movimiento(CUENTA_CXC, 'haber', pago.monto, pago.cliente_id),
        ],
    }
}

/** Reverso de un asiento: mismos movimientos con debe y haber intercambiados (`revertirAsiento`). */
export function asientoReverso(id: number, original: Asiento, descripcion: string, instante: string, usuario: number | null): Asiento {
    return {
        id,
        // Un reverso va al libro del original.
        empresa_id: original.empresa_id,
        fecha: fechaGuatemala(instante),
        descripcion,
        origen_tipo: original.origen_tipo,
        origen_id: original.origen_id,
        reversa_de: original.id,
        created_by: usuario,
        created_at: instante,
        movimientos: original.movimientos.map(m => ({
            ...movimiento(m.cuenta_id, 'debe', m.haber, m.cliente_id),
            haber: m.debe,
        })),
    }
}

/** Libro diario de los fixtures: un asiento por factura y por pago, en orden de creación. */
export const asientos: Asiento[] = [
    ...facturas.map(f => ({ tipo: 'factura' as const, momento: f.emitida_en, factura: f })),
    ...pagos.map(p => ({ tipo: 'pago' as const, momento: p.created_at, pago: p })),
]
    .sort((a, b) => a.momento.localeCompare(b.momento))
    .map((origen, indice) => origen.tipo === 'factura'
        ? asientoFactura(indice + 1, origen.factura)
        : asientoPago(indice + 1, origen.pago))

/** Debe = Haber en cada asiento (la restricción de la base). Se usa en las pruebas. */
export function cuadra(asiento: Asiento): boolean {
    const debe = asiento.movimientos.reduce((suma, m) => suma.plus(m.debe), new Decimal(0))
    const haber = asiento.movimientos.reduce((suma, m) => suma.plus(m.haber), new Decimal(0))
    return debe.equals(haber)
}

/**
 * `GET /libro/bancos` (A3): cuentas bancarias contables de `ledger.bancos`. El principal es la
 * cuenta 1.1.02.01 (la de los egresos con `banco` sin `banco_id`); el número va enmascarado.
 */
export const bancosLibro: Schema<'BancoLibro'>[] = [
    { id: 1, empresa_id: 1, nombre: 'Banco principal', banco_id: null, banco: null, numero_enmascarado: null, cuenta_id: 6, cuenta_codigo: '1.1.02.01', cuenta_nombre: 'Banco principal' },
    { id: 2, empresa_id: 1, nombre: 'Banco Industrial · Monetaria', banco_id: 2, banco: 'Banco Industrial', numero_enmascarado: '******3456', cuenta_id: 16, cuenta_codigo: '1.1.02.02', cuenta_nombre: 'Banco Industrial · Monetaria (****3456)' },
]
