import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import {
    REQUISITOS_PARA_ABRIR,
    detalleSorteo,
    exigirEstado,
    exigirRequisitos,
    verSorteo,
} from '#lealtad/sorteos'

/**
 * `sorteos.abrir` (`POST /lealtad/sorteos/:id/abrir`, permiso `sorteos.publicar`):
 * `bases_publicadas → participacion_abierta`. Exige `bases_diaco` (bases publicadas en un medio
 * idóneo, §8) marcado; si no, 422 `requisito_pendiente`. Desde aquí se pueden canjear boletos.
 */

export default class AbrirSorteo extends DomainAction<
    { id: number },
    Awaited<ReturnType<typeof detalleSorteo>>
> {
    readonly nombre = 'sorteos.abrir'

    protected async handle(input: { id: number }, t: Transaccion) {
        t.fijarEntidad('sorteo', input.id)
        const sorteo = await verSorteo(input.id, t.trx, true)
        exigirAccesoEmpresa(t.ctx, sorteo.empresa_id)
        t.fijarEmpresa(sorteo.empresa_id)
        exigirEstado(sorteo, ['bases_publicadas'], 'abrir la participación')
        await exigirRequisitos(t.trx, sorteo.id, REQUISITOS_PARA_ABRIR, 'abrir la participación')
        await t.trx
            .from('lealtad.sorteos')
            .where('id', sorteo.id)
            .update({
                estado: 'participacion_abierta',
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios(
            { tipo: 'sorteo', id: sorteo.id },
            { estado: sorteo.estado },
            { estado: 'participacion_abierta' },
        )
        return detalleSorteo(sorteo.id, t.trx)
    }
}
