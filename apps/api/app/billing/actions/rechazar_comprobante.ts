import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { ValidacionFallida } from '#shared/errores'
import { CAUSAS_RECHAZO_COMPROBANTE, type CausaRechazoComprobante } from '#shared/eventos'
import { payloadComprobante, verComprobante, type ComprobanteVista } from '#billing/comprobantes'
import { bloquearComprobante } from '#billing/actions/aprobar_comprobante'
import CancelarReconexionTemporal from '#billing/actions/cancelar_reconexion_temporal'

/**
 * `comprobantes.rechazar` (`POST /comprobantes/:id/rechazar { motivo, causa? }`): el depósito no
 * aparece en el banco, el monto no coincide o la foto no se lee. Queda `rechazado` con
 * `motivo_rechazo` y `causa_rechazo` (`no_aparece`, `monto_distinto`, `ilegible`, `falta_dato`,
 * `duplicado`, `otro`; por defecto `otro`), sin pago ni asiento; la referencia queda libre para
 * subirlo de nuevo (con `falta_dato`, el cliente lo manda completo). Evento
 * `comprobante.rechazado` con `causa` y `servicio_estado` (notify avisa al cliente con el motivo,
 * salvo `canal = iris`). 409 `comprobante_revisado` si ya se revisó.
 *
 * Si el comprobante respaldaba una reconexión temporal activa (contrato Iris 0.6.0 §7.3), se
 * cancela en la misma transacción (`CancelarReconexionTemporal`: `promesa.cancelada` con
 * `motivo = comprobante_rechazado`) y el servicio se re-evalúa respetando la hora de corte.
 */

export interface EntradaRechazarComprobante {
    comprobante_id: number
    motivo: string
    causa?: CausaRechazoComprobante | null
}

export default class RechazarComprobante extends DomainAction<EntradaRechazarComprobante, ComprobanteVista> {
    readonly nombre = 'comprobantes.rechazar'

    protected async handle(input: EntradaRechazarComprobante, t: Transaccion): Promise<ComprobanteVista> {
        const motivo = input.motivo?.trim() ?? ''
        const causa = input.causa ?? 'otro'
        const errores = []
        if (motivo.length < 3) {
            errores.push({
                field: 'motivo',
                message: 'El motivo es obligatorio (mínimo 3 caracteres)',
                rule: 'required',
            })
        }
        if (!(CAUSAS_RECHAZO_COMPROBANTE as readonly string[]).includes(causa)) {
            errores.push({
                field: 'causa',
                message: `Se acepta ${CAUSAS_RECHAZO_COMPROBANTE.join(', ')}`,
                rule: 'enum',
            })
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)
        const comprobante = await bloquearComprobante(t, input.comprobante_id)
        await t.trx
            .from('billing.comprobantes')
            .where('id', comprobante.id)
            .update({
                estado: 'rechazado',
                motivo_rechazo: motivo,
                causa_rechazo: causa,
                verificado_por: usuarioDelActor(t.ctx.actor),
                verificado_en: t.trx.knexRawQuery('now()'),
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios(
            { tipo: 'comprobante', id: comprobante.id },
            { estado: comprobante.estado, motivo_rechazo: null, causa_rechazo: null, verificado_por: null },
            {
                estado: 'rechazado',
                motivo_rechazo: motivo,
                causa_rechazo: causa,
                verificado_por: usuarioDelActor(t.ctx.actor),
            },
        )

        const reconexion = (await t.trx
            .from('billing.promesas')
            .where('comprobante_id', comprobante.id)
            .where('estado', 'activa')
            .select('id')
            .first()) as { id: number } | null
        if (reconexion) {
            await new CancelarReconexionTemporal().execute({ promesa_id: reconexion.id }, t.ctx, {
                trx: t.trx,
            })
            t.fijarEntidad('comprobante', comprobante.id)
            t.fijarEmpresa(comprobante.empresa_id)
        }

        await t.emit('comprobante.rechazado', await payloadComprobante(t.trx, comprobante.id))
        return verComprobante(comprobante.id, t.trx)
    }
}
