import type { QueryClientContract, TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import { CERO, dec, type Dec } from '#ledger/dinero'
import RevertirAsiento from '#ledger/actions/revertir_asiento'

/**
 * Diferencias de cobro como gasto (decisión del líder, B): `pagos.cerrar_diferencia` deja el saldo
 * pequeño de una factura en `5.3.05 Diferencias de cobro` con un asiento `diferencia_cobro`
 * (`5.3.05 / CxC`), sin tocar IVA ni DTE. Una diferencia está **vigente** mientras su asiento no tenga
 * reverso.
 *
 * - `pagado` sigue siendo solo dinero cobrado (decisión g): la factura está cubierta cuando
 *   `pagado + Σ diferencias vigentes ≥ total` (las notas ya están en `pagado`), y entonces `pagada`.
 * - Una factura con una diferencia vigente siempre está cubierta: anular **cualquier** pago aplicado a
 *   ella revierte antes sus diferencias (se justificaban con ese cobro completo). Así una factura
 *   pendiente nunca tiene diferencias vigentes y su saldo sigue siendo `total − pagado`.
 */

/** SQL: Σ de las diferencias vigentes de la factura `alias.id`. */
export function sqlDiferenciasVigentes(alias = 'f'): string {
    return `(SELECT coalesce(sum(dc.monto), 0) FROM billing.diferencias_cobro dc
               WHERE dc.factura_id = ${alias}.id
                 AND NOT EXISTS (SELECT 1 FROM ledger.asientos r WHERE r.reversa_de = dc.asiento_id))`
}

/** Σ de las diferencias vigentes de una factura. */
export async function diferenciasVigentes(cliente: QueryClientContract, facturaId: number): Promise<Dec> {
    const { rows } = (await cliente.rawQuery(
        `SELECT ${sqlDiferenciasVigentes('f')}::text AS monto FROM billing.facturas f WHERE f.id = ?`,
        [facturaId],
    )) as { rows: Array<{ monto: string }> }
    return rows[0] ? dec(rows[0].monto) : CERO
}

export interface DiferenciaVigente {
    id: number
    pago_id: number
    factura_id: number
    monto: string
    asiento_id: number
}

/** Diferencias vigentes de estas facturas (de cualquier pago). */
export async function diferenciasVigentesDe(
    trx: TransactionClientContract,
    facturas: number[],
): Promise<DiferenciaVigente[]> {
    if (facturas.length === 0) return []
    return (await trx
        .from('billing.diferencias_cobro as d')
        .whereIn('d.factura_id', facturas)
        .whereNotExists((q) => q.from('ledger.asientos as r').whereRaw('r.reversa_de = d.asiento_id'))
        .orderBy('d.id')
        .select('d.id', 'd.pago_id', 'd.factura_id', 'd.monto', 'd.asiento_id')) as DiferenciaVigente[]
}

/**
 * Revierte (asiento espejo) las diferencias vigentes de estas facturas: dejan de estar vigentes y la
 * factura vuelve a deber esos centavos. El estado lo recalcula quien llama (`sumarAPagado`).
 */
export async function revertirDiferencias(
    t: Transaccion,
    facturas: number[],
    motivo: string,
): Promise<DiferenciaVigente[]> {
    const vigentes = await diferenciasVigentesDe(t.trx, facturas)
    for (const d of vigentes) {
        await new RevertirAsiento().execute(
            { asiento_id: Number(d.asiento_id), motivo, por_anulacion: true },
            t.ctx,
            { trx: t.trx },
        )
    }
    return vigentes
}
