import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { aTexto, dec } from '#ledger/dinero'

/**
 * A36 (contrato Iris 0.9.0 §2.3 y §5.1): `factura.emitida`, `factura.anulada`, `pago.registrado` y
 * `pago.anulado` llevan `origen_tipo` y `origen_id` cuando la factura es el cobro de una orden de Iris
 * (`origen_externo_tipo = iris_orden`, el cargo único de §3). El envío al webhook de Iris (solo esas
 * facturas, a conectores con contrato ≥ 0.9.0) lo hace el conector; aquí solo se garantiza el payload.
 *
 * - Factura: `numero` (el del DTE, o null si no está certificada), `origen_tipo`, `origen_id`, `estado`,
 *   `saldo` (total − pagado) y `moneda`.
 * - Pago: `factura_id`, `origen_tipo` y `origen_id` de la (primera) factura de Iris a la que se aplicó,
 *   `fecha` (YYYY-MM-DD del pago) y `facturas_iris[]` con cada una y lo aplicado.
 *
 * Sin factura de Iris, no agregan nada: el payload queda como siempre.
 */

export async function extrasIrisFactura(cliente: QueryClientContract, facturaId: number) {
    const f = (await cliente
        .from('billing.facturas as f')
        .where('f.id', facturaId)
        .select(
            'f.origen_externo_tipo',
            'f.origen_externo_id',
            'f.estado',
            'f.total',
            'f.pagado',
            cliente.raw(
                `(select d.numero from fiscal.dte d where d.documento_id = f.id and d.documento_tipo = 'factura'
                   and d.estado <> 'rechazado' order by d.id desc limit 1) as numero`,
            ),
        )
        .first()) as {
        origen_externo_tipo: string | null
        origen_externo_id: string | null
        estado: string
        total: string
        pagado: string
        numero: string | null
    } | null
    if (!f || f.origen_externo_tipo !== 'iris_orden') return {}
    const estado = f.estado
    return {
        numero: f.numero ?? null,
        origen_tipo: 'iris_orden' as const,
        origen_id: f.origen_externo_id!,
        estado,
        saldo: estado === 'anulada' ? '0.00' : aTexto(dec(f.total).minus(dec(f.pagado))),
        moneda: 'GTQ' as const,
    }
}

export async function extrasIrisPago(cliente: QueryClientContract, pagoId: number) {
    const filas = (await cliente
        .from('billing.pagos_aplicaciones as a')
        .join('billing.facturas as f', 'f.id', 'a.factura_id')
        .join('billing.pagos as p', 'p.id', 'a.pago_id')
        .where('a.pago_id', pagoId)
        .where('f.origen_externo_tipo', 'iris_orden')
        .groupBy('f.id', 'f.origen_externo_id', 'p.created_at')
        .orderBy('f.id')
        .select(
            'f.id',
            'f.origen_externo_id',
            cliente.raw('sum(a.monto)::text as monto'),
            cliente.raw(`to_char(p.created_at at time zone 'America/Guatemala', 'YYYY-MM-DD') as fecha`),
        )) as Array<{ id: number; origen_externo_id: string; monto: string; fecha: string }>
    if (filas.length === 0) return {}
    const primera = filas[0]!
    return {
        factura_id: Number(primera.id),
        origen_tipo: 'iris_orden' as const,
        origen_id: primera.origen_externo_id,
        fecha: primera.fecha,
        facturas_iris: filas.map((f) => ({
            factura_id: Number(f.id),
            origen_id: f.origen_externo_id,
            monto: aTexto(f.monto),
        })),
    }
}
