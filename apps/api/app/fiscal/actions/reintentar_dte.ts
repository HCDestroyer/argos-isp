import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { aTexto, dec } from '#ledger/dinero'
import { hoyGuatemala } from '#ledger/fechas'
import { valorParametro } from '#fiscal/parametros'
import { configuracionFel } from '#fiscal/fel/configuracion'
import { DteEnProceso, ReceptorRequerido } from '#fiscal/fel/errores'
import { dteVigente, insertarDte, receptorDe, receptorFaltante, verDte, type DteFila } from '#fiscal/fel/dte'

/**
 * `fel.reintentar` (`POST /dte/:id/reintentar`, permiso `fel.certificar`; contrato §8.2):
 *
 * - `rechazado`: crea un DTE nuevo para el mismo documento con otro `identificador` y el receptor
 *   releído (ya corregido el NIT del cliente). 422 `receptor_requerido` si aún falta.
 * - `error_temporal` (también con los reintentos agotados): vuelve a la cola ya.
 * - Otro estado: 409 `dte_no_reintentable`; si el worker lo está enviando, 409 `dte_en_proceso`.
 */

export interface EntradaReintentarDte {
    dte_id: number
}

export default class ReintentarDte extends DomainAction<EntradaReintentarDte, DteFila> {
    readonly nombre = 'fel.reintentar'

    protected async handle(input: EntradaReintentarDte, t: Transaccion): Promise<DteFila> {
        t.fijarEntidad('dte', input.dte_id)
        try {
            await t.trx.rawQuery('SELECT id FROM fiscal.dte WHERE id = ? FOR UPDATE NOWAIT', [input.dte_id])
        } catch {
            throw new DteEnProceso(input.dte_id)
        }
        const dte = await verDte(input.dte_id, t.trx)
        exigirAccesoEmpresa(t.ctx, dte.empresa_id)
        t.fijarEmpresa(dte.empresa_id)

        if (dte.estado === 'error_temporal') {
            await t.trx
                .from('fiscal.dte')
                .where('id', dte.id)
                .update({
                    proximo_intento: t.trx.knexRawQuery('now()'),
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                } as Record<string, unknown>)
            return verDte(dte.id, t.trx)
        }
        if (dte.estado !== 'rechazado') {
            throw new Conflicto(
                `El DTE ${dte.id} está ${dte.estado}: solo se reintenta uno rechazado o con error temporal`,
                'dte_no_reintentable',
                'DTE no reintentable',
            )
        }
        const vigente = await dteVigente(t.trx, dte.documento_tipo, dte.documento_id)
        if (vigente) return vigente

        const documento = (await t.trx
            .from(dte.documento_tipo === 'nota_credito' ? 'billing.notas_credito' : 'billing.facturas')
            .where('id', dte.documento_id)
            .select(
                'cliente_id',
                dte.documento_tipo === 'nota_credito'
                    ? t.trx.raw('null as reglas_snapshot')
                    : 'reglas_snapshot',
            )
            .firstOrFail()) as { cliente_id: number; reglas_snapshot: { receptor?: unknown } | null }
        const receptor = await receptorDe(
            t.trx,
            documento.cliente_id,
            (documento.reglas_snapshot?.receptor ?? null) as Parameters<typeof receptorDe>[2],
        )
        const hoy = hoyGuatemala()
        if (await receptorFaltante(dte.empresa_id, receptor, dte.total, hoy, t.trx)) {
            const limite = await valorParametro<string>(dte.empresa_id, 'consumidor_final_limite', hoy, t.trx)
            throw new ReceptorRequerido(aTexto(dec(dte.total)), aTexto(dec(limite)))
        }
        const config = await configuracionFel(dte.empresa_id, t.trx)
        return insertarDte(t.trx, {
            empresa_id: dte.empresa_id,
            documento_tipo: dte.documento_tipo,
            documento_id: dte.documento_id,
            tipo_dte: dte.tipo_dte,
            proveedor: config.proveedor ?? dte.proveedor,
            ambiente: config.ambiente,
            receptor,
            referencia: dte.referencia,
            total: dte.total,
            iva: dte.iva,
            estado: config.contingencia_activa ? 'contingencia' : 'pendiente',
            contingencia: config.contingencia_activa,
            solicitud: 'manual',
        })
    }
}
