import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { detalleSorteo, exigirEstado, verSorteo } from '#lealtad/sorteos'

/**
 * `sorteos.cancelar` (`POST /lealtad/sorteos/:id/cancelar`, permiso `sorteos.publicar`, con motivo):
 * desde cualquier estado antes de `ejecutado` (409 `estado_sorteo`). Los puntos canjeados por boletos
 * no se devuelven solos: se revierten los canjes a mano si las bases lo prevén. Evento
 * `sorteo.cancelado`.
 */

export default class CancelarSorteo extends DomainAction<
    { id: number; motivo: string },
    Awaited<ReturnType<typeof detalleSorteo>>
> {
    readonly nombre = 'sorteos.cancelar'

    protected async handle(input: { id: number; motivo: string }, t: Transaccion) {
        t.fijarEntidad('sorteo', input.id)
        const motivo = input.motivo?.trim() ?? ''
        if (motivo.length < 3) {
            throw new ValidacionFallida([
                { field: 'motivo', message: 'El motivo es obligatorio', rule: 'motivo' },
            ])
        }
        const sorteo = await verSorteo(input.id, t.trx, true)
        exigirAccesoEmpresa(t.ctx, sorteo.empresa_id)
        t.fijarEmpresa(sorteo.empresa_id)
        exigirEstado(
            sorteo,
            ['borrador', 'bases_publicadas', 'participacion_abierta', 'corte_cerrado'],
            'cancelación',
        )
        await t.trx
            .from('lealtad.sorteos')
            .where('id', sorteo.id)
            .update({
                estado: 'cancelado',
                motivo_cancelacion: motivo,
                cancelado_en: t.trx.knexRawQuery('now()'),
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios(
            { tipo: 'sorteo', id: sorteo.id },
            { estado: sorteo.estado },
            { estado: 'cancelado' },
        )
        await t.emit('sorteo.cancelado', { sorteo_id: sorteo.id, empresa_id: sorteo.empresa_id, motivo })
        return detalleSorteo(sorteo.id, t.trx)
    }
}
