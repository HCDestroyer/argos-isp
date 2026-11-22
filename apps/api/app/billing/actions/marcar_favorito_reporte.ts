import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirDefinicion } from '#billing/reportes/catalogo'

export interface EntradaFavoritoReporte {
    /** el usuario de la sesión (nunca otro) */
    usuario_id: number
    reporte: string
}

/**
 * `reportes.marcar_favorito`: el propio usuario marca un reporte del catálogo como favorito.
 * Preferencia propia (como los accesos rápidos): sin permiso propio del ACL; la ruta pide
 * `reportes.ver`. Idempotente: marcarlo dos veces no emite dos eventos.
 */
export default class MarcarFavoritoReporte extends DomainAction<
    EntradaFavoritoReporte,
    { favorito: boolean }
> {
    readonly nombre = 'reportes.marcar_favorito'

    protected async handle(input: EntradaFavoritoReporte, t: Transaccion) {
        exigirDefinicion(input.reporte)
        t.fijarEntidad('usuario', input.usuario_id)
        t.fijarEmpresa(null)
        const insertado = (await t.trx
            .knexQuery()
            .table('billing.reportes_favoritos')
            .insert({ usuario_id: input.usuario_id, reporte: input.reporte })
            .onConflict(['usuario_id', 'reporte'])
            .ignore()
            .returning('reporte')) as unknown[]
        if (insertado.length > 0) {
            await t.emit('reportes.preferencias_cambiadas', {
                usuario_id: input.usuario_id,
                tipo: 'favorito',
                accion: 'agregado',
                reporte: input.reporte,
                vista_id: null,
            })
        }
        return { favorito: true }
    }
}
