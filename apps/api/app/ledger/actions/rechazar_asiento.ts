import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { ValidacionFallida } from '#shared/errores'
import { bloquearBorrador, verBorrador, type BorradorAsientoVista } from '#ledger/borradores'

/**
 * `libro.rechazar_asiento` (`POST /libro/borradores/:id/rechazar`, decisión del PM 10): rechaza con
 * motivo un borrador de asiento manual pendiente; no toca el libro. Quien lo creó también puede
 * rechazarlo (retirarlo). 409 `borrador_decidido` si ya se decidió. Evento `libro.asiento_rechazado`.
 */
export default class RechazarAsiento extends DomainAction<
    { borrador_id: number; motivo: string },
    BorradorAsientoVista
> {
    readonly nombre = 'libro.rechazar_asiento'

    protected async handle(
        input: { borrador_id: number; motivo: string },
        t: Transaccion,
    ): Promise<BorradorAsientoVista> {
        const motivo = input.motivo?.trim() ?? ''
        if (motivo.length < 3) {
            throw new ValidacionFallida([{ field: 'motivo', message: 'Indica el motivo', rule: 'minLength' }])
        }
        const borrador = await bloquearBorrador(t, input.borrador_id)
        const usuario = usuarioDelActor(t.ctx.actor)
        await t.trx.insertQuery().table('billing.asientos_borradores_decisiones').insert({
            borrador_id: borrador.id,
            decision: 'rechazado',
            motivo,
            decidido_por: usuario,
        })
        await t.emit('libro.asiento_rechazado', {
            borrador_id: borrador.id,
            empresa_id: borrador.empresa_id,
            creado_por: borrador.creado_por,
            decidido_por: usuario,
            motivo,
        })
        return verBorrador(borrador.id, t.trx)
    }
}
