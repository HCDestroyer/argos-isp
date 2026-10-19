import type { Transaccion } from '#shared/domain_action'
import { aTexto, dec } from '#ledger/dinero'
import { CUENTAS } from '#ledger/plan_cuentas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import { lineaConIva } from '#billing/facturas'
import { hoyGuatemala } from '#ledger/fechas'

/**
 * H18 (decisión del líder): anular el pago que cerró una diferencia de cobro cuando la factura ya
 * tiene DTE (la diferencia quedó en su neto o salió como NCRE) no toca el documento fiscal: el cliente
 * vuelve a deber esos centavos con un **cargo interno no fiscal** — una factura `tipo = 'cargo'` sin
 * IVA ligada a la factura (`factura_origen_id`), asiento `CxC / 5.3.05 Diferencias de cobro` — y una
 * fila en `billing.diferencias_cobro_cargos` que la liga a la diferencia y al pago anulado. Nunca va a
 * la cola FEL ni cuenta para limitar o cortar (solo las facturas `servicio`).
 */
export async function crearCargoDiferencia(
    t: Transaccion,
    diferencia: { id: number; pago_id: number; factura_id: number; monto: string },
): Promise<number> {
    const origen = (await t.trx
        .from('billing.facturas')
        .where('id', diferencia.factura_id)
        .select('id', 'empresa_id', 'cliente_id', 'servicio_id', 'periodo')
        .firstOrFail()) as {
        id: number
        empresa_id: number
        cliente_id: number
        servicio_id: number | null
        periodo: string
    }
    const monto = dec(diferencia.monto)
    const concepto = `Diferencia de cobro devuelta: pago ${diferencia.pago_id} anulado (factura ${origen.id})`
    const linea = lineaConIva({ concepto, tipo: 'otro', cantidad: '1', gravable: false, total: monto })
    const [fila] = (await t.trx
        .insertQuery()
        .table('billing.facturas')
        .insert({
            empresa_id: origen.empresa_id,
            cliente_id: origen.cliente_id,
            servicio_id: origen.servicio_id,
            tipo: 'cargo',
            factura_origen_id: origen.id,
            periodo: origen.periodo,
            clave_unica: `cargo-diferencia-${diferencia.id}`,
            vence_en: hoyGuatemala(),
            estado: 'emitida',
            subtotal: aTexto(monto),
            iva: '0.00',
            total: aTexto(monto),
            aviso_cobro: false,
            certificar_al: 'nunca',
            reglas_snapshot: JSON.stringify({
                mora_tipo: 'ninguna',
                diferencia_id: diferencia.id,
                pago_id: diferencia.pago_id,
            }),
        })
        .returning('id')) as Array<{ id: number }>
    const cargoId = Number(fila!.id)
    await t.trx
        .insertQuery()
        .table('billing.facturas_lineas')
        .insert({ ...linea, factura_id: cargoId })
    await new RegistrarAsiento().execute(
        {
            empresa_id: Number(origen.empresa_id),
            descripcion: `${concepto} (cargo ${cargoId})`,
            origen_tipo: 'factura',
            origen_id: cargoId,
            movimientos: [
                { cuenta: CUENTAS.CXC_CLIENTES, debe: aTexto(monto), cliente_id: origen.cliente_id },
                { cuenta: CUENTAS_GT.DIFERENCIAS_COBRO, haber: aTexto(monto) },
            ],
        },
        t.ctx,
        { trx: t.trx },
    )
    await t.trx.insertQuery().table('billing.diferencias_cobro_cargos').insert({
        empresa_id: origen.empresa_id,
        diferencia_id: diferencia.id,
        pago_id: diferencia.pago_id,
        factura_id: cargoId,
    })
    return cargoId
}
