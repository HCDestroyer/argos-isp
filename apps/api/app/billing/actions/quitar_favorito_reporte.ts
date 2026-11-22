import { DomainAction, type Transaccion } from '#shared/domain_action'
import type { EntradaFavoritoReporte } from '#billing/actions/marcar_favorito_reporte'

/** `reportes.quitar_favorito`: el propio usuario quita un favorito (preferencia propia, sin permiso propio). */
export default class QuitarFavoritoReporte extends DomainAction<
    EntradaFavoritoReporte,
    { favorito: boolean }
> {
    readonly nombre = 'reportes.quitar_favorito'

    protected async handle(input: EntradaFavoritoReporte, t: Transaccion) {
        t.fijarEntidad('usuario', input.usuario_id)
        t.fijarEmpresa(null)
        const borrados = await t.trx
            .from('billing.reportes_favoritos')
            .where({ usuario_id: input.usuario_id, reporte: input.reporte })
            .delete()
        if (Number(borrados) > 0) {
            await t.emit('reportes.preferencias_cambiadas', {
                usuario_id: input.usuario_id,
                tipo: 'favorito',
                accion: 'quitado',
                reporte: input.reporte,
                vista_id: null,
            })
        }
        return { favorito: false }
    }
}
