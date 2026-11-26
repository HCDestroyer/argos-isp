import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { ValidacionFallida } from '#shared/errores'
import { hoyGuatemala } from '#ledger/fechas'
import { verEntrega, type EntregaVista } from '#ledger/custodia'
import { entregaParaResponder } from '#ledger/actions/recibir_entrega'

/**
 * `cajas.rechazar_entrega` (`POST /cajas/entregas/:id/rechazar`): «No lo recibí». Solo la persona a
 * quien va la entrega, con motivo. Sin asiento: el efectivo sigue a nombre del cajero (cuenta de su
 * caja) y el turno puede entregarse otra vez (`cajas.entregar`). Evento `caja.entrega_rechazada`.
 */

export interface EntradaRechazarEntrega {
    entrega_id: number
    motivo: string
}

export default class RechazarEntrega extends DomainAction<EntradaRechazarEntrega, EntregaVista> {
    readonly nombre = 'cajas.rechazar_entrega'

    protected async handle(input: EntradaRechazarEntrega, t: Transaccion): Promise<EntregaVista> {
        t.fijarEntidad('entrega', input.entrega_id)
        const motivo = input.motivo?.trim() ?? ''
        if (motivo.length < 3) {
            throw new ValidacionFallida([
                { field: 'motivo', message: 'El motivo es obligatorio', rule: 'required' },
            ])
        }
        const entrega = await entregaParaResponder(t, input.entrega_id)
        const usuario = usuarioDelActor(t.ctx.actor)!
        await t.trx.insertQuery().table('ledger.entregas_recepciones').insert({
            entrega_id: entrega.id,
            empresa_id: entrega.empresa_id,
            resultado: 'rechazada',
            recibido_por: usuario,
            motivo,
            fecha: hoyGuatemala(),
        })
        await t.emit('caja.entrega_rechazada', {
            entrega_id: entrega.id,
            empresa_id: entrega.empresa_id,
            caja_id: entrega.caja_id,
            turno_id: entrega.turno_id,
            entregado_por: entrega.entregado_por,
            recibe_id: usuario,
            monto: entrega.monto,
            motivo,
        })
        return verEntrega(entrega.id, t.trx)
    }
}
