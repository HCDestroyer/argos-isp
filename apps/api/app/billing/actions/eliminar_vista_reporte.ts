import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'

/** `reportes.eliminar_vista`: el propio usuario borra una vista suya (preferencia propia). */
export default class EliminarVistaReporte extends DomainAction<
    { usuario_id: number; id: number },
    { eliminada: boolean }
> {
    readonly nombre = 'reportes.eliminar_vista'

    protected async handle(input: { usuario_id: number; id: number }, t: Transaccion) {
        t.fijarEntidad('vista_reporte', input.id)
        t.fijarEmpresa(null)
        const fila = (await t.trx
            .from('billing.reportes_vistas')
            .where({ id: input.id, usuario_id: input.usuario_id })
            .select('reporte')
            .first()) as { reporte: string } | null
        if (!fila) throw new NoEncontrado(`La vista ${input.id} no existe`)
        await t.trx.from('billing.reportes_vistas').where('id', input.id).delete()
        await t.emit('reportes.preferencias_cambiadas', {
            usuario_id: input.usuario_id,
            tipo: 'vista',
            accion: 'eliminada',
            reporte: fila.reporte,
            vista_id: input.id,
        })
        return { eliminada: true }
    }
}
