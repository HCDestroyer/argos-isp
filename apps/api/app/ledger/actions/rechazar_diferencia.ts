import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { ValidacionFallida } from '#shared/errores'
import { verDiferencia, type DiferenciaConciliacionVista } from '#ledger/diferencias_conciliacion'
import { bloquearDiferenciaPendiente } from '#ledger/actions/aprobar_diferencia'

/**
 * `bancos.rechazar_diferencia` (`POST /bancos/diferencias/:id/rechazar`, permiso
 * `bancos.aprobar_diferencia`; plan de contabilidad §5.8, B3): la diferencia no entra al libro y la
 * línea vuelve a quedar libre para conciliarse de otra forma. Motivo obligatorio. Quien la pidió sí
 * puede rechazarla (equivale a retirarla). 409 `diferencia_decidida` si ya se decidió. Evento
 * `banco.diferencia_rechazada`.
 */
export default class RechazarDiferencia extends DomainAction<
    { diferencia_id: number; motivo: string },
    DiferenciaConciliacionVista
> {
    readonly nombre = 'bancos.rechazar_diferencia'

    protected async handle(
        input: { diferencia_id: number; motivo: string },
        t: Transaccion,
    ): Promise<DiferenciaConciliacionVista> {
        const motivo = input.motivo?.trim() ?? ''
        if (motivo.length < 3) {
            throw new ValidacionFallida([
                { field: 'motivo', message: 'El motivo es obligatorio', rule: 'required' },
            ])
        }
        const diferencia = await bloquearDiferenciaPendiente(t, input.diferencia_id)
        const usuario = usuarioDelActor(t.ctx.actor)
        await t.trx.insertQuery().table('billing.diferencias_conciliacion_decisiones').insert({
            diferencia_id: diferencia.id,
            decision: 'rechazada',
            motivo,
            decidido_por: usuario,
        })
        await t.emit('banco.diferencia_rechazada', {
            diferencia_id: diferencia.id,
            empresa_id: diferencia.empresa_id,
            cuenta_id: diferencia.cuenta_id,
            linea_id: diferencia.linea_id,
            monto: diferencia.monto,
            solicitado_por: diferencia.solicitado_por,
            rechazado_por: usuario,
            motivo,
        })
        return verDiferencia(diferencia.id, t.trx)
    }
}
