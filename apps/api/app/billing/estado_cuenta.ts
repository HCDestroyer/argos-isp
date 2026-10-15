import db from '@adonisjs/lucid/services/db'
import { NoEncontrado } from '#shared/errores'
import { CERO, aTexto, dec } from '#ledger/dinero'
import { CUENTAS } from '#ledger/plan_cuentas'
import { saldoCliente } from '#ledger/consultas'
import { saldoAnticipos } from '#billing/cobros'
import { ESTADOS_PENDIENTES, columnasFactura, type FacturaFila } from '#billing/facturas'

/**
 * Estado de cuenta del cliente (`GET /clientes/:id/estado-cuenta`): el **auxiliar CxC** del libro.
 *
 * - `saldo`: suma de los movimientos del cliente en CxC (debe − haber). Positivo = debe.
 * - `saldo_a_favor`: anticipos del cliente (excedentes de pagos aún sin aplicar).
 * - `facturas_pendientes`: emitidas, parciales y vencidas, la más antigua primero.
 * - `movimientos`: un renglón por asiento que toca su CxC, en orden contable (fecha, asiento),
 *   con `cargo` (debe), `abono` (haber) y el saldo acumulado; el último saldo es `saldo`.
 *   Los reversos aparecen con el tipo de su origen (p. ej. un pago anulado como cargo `pago`).
 */

type TipoMovimiento = 'factura' | 'pago' | 'mora' | 'nota_credito' | 'ajuste'

export interface MovimientoEstadoCuenta {
    fecha: string
    tipo: TipoMovimiento
    referencia_id: number
    descripcion: string
    cargo: string
    abono: string
    saldo: string
}

export interface EstadoCuenta {
    cliente_id: number
    saldo: string
    saldo_a_favor: string
    facturas_pendientes: FacturaFila[]
    movimientos: MovimientoEstadoCuenta[]
}

const TIPOS: Record<string, TipoMovimiento> = {
    factura: 'factura',
    pago: 'pago',
    mora: 'mora',
    nota_credito: 'nota_credito',
}

export async function estadoCuenta(clienteId: number): Promise<EstadoCuenta> {
    const cliente = await db.from('core.clientes').where('id', clienteId).select('id').first()
    if (!cliente) throw new NoEncontrado(`El cliente ${clienteId} no existe`)

    const conexion = db.connection()
    const facturas = (await conexion
        .from('billing.facturas as f')
        .where('f.cliente_id', clienteId)
        .whereIn('f.estado', [...ESTADOS_PENDIENTES])
        .orderBy([
            { column: 'f.vence_en', order: 'asc' },
            { column: 'f.periodo', order: 'asc' },
            { column: 'f.id', order: 'asc' },
        ])
        .select(...columnasFactura(conexion))) as FacturaFila[]

    const filas = (await db
        .from('ledger.movimientos as m')
        .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
        .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
        .where('c.codigo', CUENTAS.CXC_CLIENTES)
        .where('m.cliente_id', clienteId)
        .groupBy('a.id', 'a.fecha', 'a.origen_tipo', 'a.origen_id', 'a.descripcion')
        .orderBy([
            { column: 'a.fecha', order: 'asc' },
            { column: 'a.id', order: 'asc' },
        ])
        .select(
            'a.id',
            db.raw(`to_char(a.fecha, 'YYYY-MM-DD') as fecha`),
            'a.origen_tipo',
            'a.origen_id',
            'a.descripcion',
            db.raw('sum(m.debe)::text as cargo'),
            db.raw('sum(m.haber)::text as abono'),
        )) as Array<{
        id: number
        fecha: string
        origen_tipo: string
        origen_id: number | null
        descripcion: string
        cargo: string
        abono: string
    }>

    let acumulado = CERO
    const movimientos = filas.map((fila) => {
        acumulado = acumulado.plus(dec(fila.cargo)).minus(dec(fila.abono))
        return {
            fecha: fila.fecha,
            tipo: TIPOS[fila.origen_tipo] ?? 'ajuste',
            referencia_id: fila.origen_id ?? fila.id,
            descripcion: fila.descripcion,
            cargo: aTexto(fila.cargo),
            abono: aTexto(fila.abono),
            saldo: aTexto(acumulado),
        }
    })

    return {
        cliente_id: clienteId,
        saldo: aTexto(await saldoCliente(clienteId)),
        saldo_a_favor: aTexto(await saldoAnticipos(conexion, clienteId)),
        facturas_pendientes: facturas,
        movimientos,
    }
}
