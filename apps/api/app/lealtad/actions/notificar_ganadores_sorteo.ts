import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { detalleSorteo, exigirEstado, ganadoresDe, verSorteo } from '#lealtad/sorteos'
import { notificarGanador } from '#lealtad/sorteos_entrega'

/**
 * `sorteos.notificar_ganadores` (`POST /lealtad/sorteos/:id/notificar-ganadores`, permiso
 * `sorteos.entregar`; §7.4): cada ganador con premio que sigue `por_notificar` pasa a `notificado`, con
 * su plazo de reclamo (`bases.plazo_reclamo_dias` desde ahora), y sale un `sorteo.ganador_notificado`
 * por ganador: notify (A6) avisa al cliente. Idempotente: los ya notificados no se vuelven a avisar.
 * Los suplentes en espera no se notifican (lo hace `sorteos.marcar_no_reclamado` cuando toman un
 * premio). Los resultados ya son públicos en el portal desde que se ejecuta.
 */

export default class NotificarGanadoresSorteo extends DomainAction<
    { id: number },
    Awaited<ReturnType<typeof detalleSorteo>>
> {
    readonly nombre = 'sorteos.notificar_ganadores'

    protected async handle(input: { id: number }, t: Transaccion) {
        t.fijarEntidad('sorteo', input.id)
        const sorteo = await verSorteo(input.id, t.trx, true)
        exigirAccesoEmpresa(t.ctx, sorteo.empresa_id)
        t.fijarEmpresa(sorteo.empresa_id)
        exigirEstado(sorteo, ['ejecutado', 'acta_cerrada'], 'notificar a los ganadores')
        const ganadores = await ganadoresDe(sorteo.id, t.trx)
        for (const g of ganadores.filter((x) => x.premio !== null && x.estado === 'por_notificar')) {
            await notificarGanador(t, sorteo, g)
        }
        return detalleSorteo(sorteo.id, t.trx)
    }
}
