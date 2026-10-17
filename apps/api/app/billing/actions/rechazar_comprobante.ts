import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { ValidacionFallida } from '#shared/errores'
import { verComprobante, type ComprobanteVista } from '#billing/comprobantes'
import { bloquearComprobante } from '#billing/actions/aprobar_comprobante'

/**
 * `comprobantes.rechazar` (`POST /comprobantes/:id/rechazar { motivo }`): el depósito no aparece
 * en el banco, el monto no coincide o la foto no se lee. Queda `rechazado` con `motivo_rechazo`,
 * sin pago ni asiento; la referencia queda libre para subirlo de nuevo. Evento
 * `comprobante.rechazado` (notify avisa al cliente con el motivo). 409 `comprobante_revisado` si
 * ya se revisó.
 */

export interface EntradaRechazarComprobante {
    comprobante_id: number
    motivo: string
}

export default class RechazarComprobante extends DomainAction<EntradaRechazarComprobante, ComprobanteVista> {
    readonly nombre = 'comprobantes.rechazar'

    protected async handle(input: EntradaRechazarComprobante, t: Transaccion): Promise<ComprobanteVista> {
        const motivo = input.motivo?.trim() ?? ''
        if (motivo.length < 3) {
            throw new ValidacionFallida([
                {
                    field: 'motivo',
                    message: 'El motivo es obligatorio (mínimo 3 caracteres)',
                    rule: 'required',
                },
            ])
        }
        const comprobante = await bloquearComprobante(t, input.comprobante_id)
        await t.trx
            .from('billing.comprobantes')
            .where('id', comprobante.id)
            .update({
                estado: 'rechazado',
                motivo_rechazo: motivo,
                verificado_por: usuarioDelActor(t.ctx.actor),
                verificado_en: t.trx.knexRawQuery('now()'),
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios(
            { tipo: 'comprobante', id: comprobante.id },
            { estado: comprobante.estado, motivo_rechazo: null, verificado_por: null },
            { estado: 'rechazado', motivo_rechazo: motivo, verificado_por: usuarioDelActor(t.ctx.actor) },
        )
        await t.emit('comprobante.rechazado', {
            comprobante_id: comprobante.id,
            cliente_id: comprobante.cliente_id,
            pago_id: null,
            motivo,
        })
        return verComprobante(comprobante.id, t.trx)
    }
}
