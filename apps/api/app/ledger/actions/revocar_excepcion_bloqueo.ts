import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { motivoObligatorio, verExcepcion, type ExcepcionVista } from '#ledger/bloqueos'

/**
 * Revocar una excepción de bloqueo (`POST /libro/bloqueos/excepciones/:id/revocar`, permiso
 * `libro.excepcion_bloqueo`): fila en `ledger.bloqueos_excepciones_revocaciones` con motivo. Desde
 * ese momento no cubre asientos nuevos; los que ya entraron por ella quedan como están. 409
 * `excepcion_revocada` si ya lo estaba.
 */

export interface EntradaRevocarExcepcion {
    excepcion_id: number
    motivo: string
}

export default class RevocarExcepcionBloqueo extends DomainAction<EntradaRevocarExcepcion, ExcepcionVista> {
    readonly nombre = 'libro.excepcion_bloqueo'

    protected async handle(input: EntradaRevocarExcepcion, t: Transaccion): Promise<ExcepcionVista> {
        const motivo = motivoObligatorio(input.motivo)
        const excepcion = await verExcepcion(input.excepcion_id, t.trx)
        if (!excepcion) throw new NoEncontrado(`La excepción ${input.excepcion_id} no existe`)
        exigirAccesoEmpresa(t.ctx, excepcion.empresa_id)
        t.fijarEmpresa(excepcion.empresa_id)
        t.fijarEntidad('excepcion_bloqueo', excepcion.id)
        if (excepcion.estado === 'revocada') {
            throw new Conflicto(
                `La excepción ${excepcion.id} ya está revocada`,
                'excepcion_revocada',
                'Excepción revocada',
            )
        }
        await t.trx
            .insertQuery()
            .table('ledger.bloqueos_excepciones_revocaciones')
            .insert({ excepcion_id: excepcion.id, motivo, revocada_por: usuarioDelActor(t.ctx.actor) })
            .knexQuery.onConflict('excepcion_id')
            .ignore()
        return (await verExcepcion(excepcion.id, t.trx))!
    }
}
