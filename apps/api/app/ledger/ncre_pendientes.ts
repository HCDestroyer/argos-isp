import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { Problema, type ErrorCampo } from '#shared/errores'

/**
 * Ninguna NCRE (nota de crédito con DTE) del mes `periodo` o anterior sin certificar (condición del
 * líder a la NCRE inmediata, contrato §17); una rechazada en definitivo se anula antes
 * (`facturas.anular_nota_credito`). 409 `ncre_sin_certificar`. La exigen el cierre del mes y la
 * liquidación de una declaración de IVA o de pequeño contribuyente (fase 7 PR B, §20).
 */
export async function exigirNcreCertificadas(
    trx: QueryClientContract,
    empresaId: number,
    periodo: string,
    antes: string,
): Promise<void> {
    const { rows: ncre } = (await trx.rawQuery(
        `SELECT d.id AS dte_id, d.documento_id AS nota_id, n.factura_id, d.estado
               FROM fiscal.dte d JOIN billing.notas_credito n ON n.id = d.documento_id
              WHERE d.documento_tipo = 'nota_credito' AND d.empresa_id = ?
                AND n.fecha < (?::date + interval '1 month')
                AND NOT EXISTS (SELECT 1 FROM billing.notas_credito_anulaciones x WHERE x.nota_id = n.id)
                AND NOT EXISTS (SELECT 1 FROM fiscal.dte o WHERE o.documento_tipo = 'nota_credito'
                                  AND o.documento_id = n.id AND o.estado = 'certificado')
                AND d.id = (SELECT max(o.id) FROM fiscal.dte o
                             WHERE o.documento_tipo = 'nota_credito' AND o.documento_id = n.id)
              ORDER BY d.id`,
        [empresaId, periodo],
    )) as { rows: Array<{ dte_id: number; nota_id: number; factura_id: number; estado: string }> }
    if (ncre.length > 0) {
        // errors[]: una entrada por nota, field nota_id, message = estado del DTE, rule = dte_id
        // (además nota_id, factura_id, dte_id y estado como números y texto)
        const errores = ncre.map(
            (x): ErrorCampo & { nota_id: number; factura_id: number; dte_id: number; estado: string } => ({
                field: 'nota_id',
                message: x.estado,
                rule: String(x.dte_id),
                nota_id: Number(x.nota_id),
                factura_id: Number(x.factura_id),
                dte_id: Number(x.dte_id),
                estado: x.estado,
            }),
        )
        throw new Problema(
            409,
            'ncre_sin_certificar',
            'NCRE sin certificar',
            `Hay ${ncre.length} notas de crédito con su NCRE sin certificar (${ncre
                .slice(0, 20)
                .map((x) => `nota ${x.nota_id}: ${x.estado}`)
                .join(', ')}): certifícalas o anula las rechazadas ${antes}`,
            errores,
        )
    }
}
