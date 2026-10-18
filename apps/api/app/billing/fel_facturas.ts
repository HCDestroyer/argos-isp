import type { QueryClientContract, TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import type { Transaccion } from '#shared/domain_action'
import { CERO, aTexto, dec, type Dec } from '#ledger/dinero'
import { CUENTAS } from '#ledger/plan_cuentas'
import { periodoCerrado } from '#ledger/cierres'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import type { DteFila } from '#fiscal/fel/dte'

/**
 * Facturación y FEL: el ciclo de `2.1.11 IVA por certificar` (contrato de localización fiscal
 * §10.1). Un aviso de cobro (`billing.facturas.aviso_cobro`) registra su IVA en `2.1.11`; al
 * certificarse su DTE, una reclasificación `2.1.11 / 2.1.02` (origen `reclasificacion`, origen_id =
 * el DTE) lleva al débito fiscal lo que el aviso aún tenía por certificar.
 */

export const IVA_POR_CERTIFICAR = CUENTAS_GT.IVA_POR_CERTIFICAR

/** Cuenta del IVA de un documento nuevo: la de transición si es un aviso de cobro. */
export function cuentaIva(avisoCobro: boolean): string {
    return avisoCobro ? IVA_POR_CERTIFICAR : CUENTAS.IVA_DEBITO
}

/**
 * Saldo acreedor de `2.1.11` que corresponde a la factura (o mora): su asiento menos las notas
 * internas, menos las reclasificaciones de sus DTE, todo con sus reversos.
 */
export async function ivaPorCertificarDe(cliente: QueryClientContract, facturaId: number): Promise<Dec> {
    const { rows } = (await cliente.rawQuery(
        `SELECT coalesce(sum(m.haber - m.debe), 0)::text AS saldo
           FROM ledger.movimientos m
           JOIN ledger.cuentas c ON c.id = m.cuenta_id
           JOIN ledger.asientos a ON a.id = m.asiento_id
          WHERE c.codigo = ?
            AND ((a.origen_tipo IN ('factura', 'mora') AND a.origen_id = ?)
              OR (a.origen_tipo = 'nota_credito'
                  AND a.origen_id IN (SELECT n.id FROM billing.notas_credito n WHERE n.factura_id = ?))
              OR (a.origen_tipo = 'reclasificacion'
                  AND a.origen_id IN (SELECT d.id FROM fiscal.dte d
                                       WHERE d.documento_tipo IN ('factura', 'nota_debito') AND d.documento_id = ?)))`,
        [IVA_POR_CERTIFICAR, facturaId, facturaId, facturaId],
    )) as { rows: Array<{ saldo: string }> }
    return dec(rows[0]?.saldo ?? '0')
}

/**
 * Fecha contable de un asiento automático (reclasificación, confirmación de emisión): la del
 * hecho, o el primer día del primer mes abierto si su mes ya está cerrado (contrato §10.1: la
 * fecha real queda en el DTE).
 */
export async function fechaContableAbierta(
    cliente: TransactionClientContract,
    fecha: string,
    empresaId: number,
): Promise<string> {
    let actual = fecha
    for (let i = 0; i < 36 && (await periodoCerrado(cliente, actual, empresaId)); i++) {
        actual = DateTime.fromISO(actual, { zone: 'utc' }).plus({ months: 1 }).startOf('month').toISODate()!
    }
    return actual
}

/**
 * Al certificarse el DTE de un aviso: `2.1.11 / 2.1.02` por lo que el aviso tenía por certificar.
 * Idempotente por DTE (si ya hay una reclasificación viva de ese DTE no hace nada). Devuelve el
 * monto reclasificado.
 */
export async function reclasificarIva(
    t: Transaccion,
    factura: { id: number; empresa_id: number },
    dte: DteFila,
    fecha: string,
): Promise<Dec> {
    const previa = await t.trx
        .from('ledger.asientos as a')
        .where('a.origen_tipo', 'reclasificacion')
        .where('a.origen_id', dte.id)
        .whereNull('a.reversa_de')
        .first()
    if (previa) return CERO
    // H5: exactamente el IVA del DTE (el neto de las notas internas, que es lo que queda en 2.1.11)
    const monto = dec(dte.iva)
    if (monto.lte(0)) return CERO
    await new RegistrarAsiento().execute(
        {
            empresa_id: factura.empresa_id,
            fecha: await fechaContableAbierta(t.trx, fecha, factura.empresa_id),
            descripcion: `Reclasificación del IVA del aviso ${factura.id} al certificar el DTE ${dte.id} (${dte.serie ?? ''}-${dte.numero ?? ''})`,
            origen_tipo: 'reclasificacion',
            origen_id: dte.id,
            movimientos: [
                { cuenta: IVA_POR_CERTIFICAR, debe: aTexto(monto) },
                { cuenta: CUENTAS.IVA_DEBITO, haber: aTexto(monto) },
            ],
        },
        t.ctx,
        { trx: t.trx },
    )
    return monto
}
