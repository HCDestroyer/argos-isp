import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ConflictoVersion } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { detalleSorteo, exigirEstado, verSorteo } from '#lealtad/sorteos'

/**
 * `sorteos.cambiar_aviso_portal` (`PUT /lealtad/sorteos/:id/aviso-portal`, permiso `sorteos.gestionar`,
 * con `version`): si el sorteo se anuncia en el portal del cliente (pedido del PM; `false` por defecto).
 * Se puede cambiar hasta antes de ejecutar (después, el trigger lo congela); queda en `audit.cambios`.
 */

export interface EntradaAvisoPortal {
    id: number
    version: number
    aviso_portal: boolean
}

export default class CambiarAvisoPortalSorteo extends DomainAction<
    EntradaAvisoPortal,
    Awaited<ReturnType<typeof detalleSorteo>>
> {
    readonly nombre = 'sorteos.cambiar_aviso_portal'

    protected async handle(input: EntradaAvisoPortal, t: Transaccion) {
        t.fijarEntidad('sorteo', input.id)
        const sorteo = await verSorteo(input.id, t.trx, true)
        exigirAccesoEmpresa(t.ctx, sorteo.empresa_id)
        t.fijarEmpresa(sorteo.empresa_id)
        if (sorteo.version !== input.version) throw new ConflictoVersion('El sorteo', sorteo.id)
        exigirEstado(
            sorteo,
            ['borrador', 'bases_publicadas', 'participacion_abierta', 'corte_cerrado'],
            'cambiar el aviso en el portal',
        )
        if (sorteo.aviso_portal !== input.aviso_portal) {
            await t.trx
                .from('lealtad.sorteos')
                .where('id', sorteo.id)
                .update({
                    aviso_portal: input.aviso_portal,
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                } as Record<string, unknown>)
            await t.registrarCambios(
                { tipo: 'sorteo', id: sorteo.id },
                { aviso_portal: sorteo.aviso_portal },
                { aviso_portal: input.aviso_portal },
            )
        }
        return detalleSorteo(sorteo.id, t.trx)
    }
}
