import { DomainAction, type Transaccion } from '#shared/domain_action'
import {
    bloquearPlanTemporal,
    cambiarPlanPorTemporal,
    filaAuditable,
    verPlanTemporal,
    type PlanTemporalVista,
} from '#core/planes_temporales'

export interface EntradaTerminarPlanTemporal {
    id: number
    /** reloj de la corrida (cron); por defecto, ahora */
    ahora?: Date
}

/**
 * Termina un plan temporal `activo` cuyo `fin` ya llegó (`servicios.terminar_plan_temporal`,
 * acción del sistema que llama el cron). El servicio vuelve solo a su plan base
 * (`plan_original_id`): IPs, prefijos y lo demás no se tocan. Emite `servicio.config_cambiada`
 * (`campos: ['plan']`, `motivo: 'plan_temporal'`) y reescribe `aaa:user:*`.
 * Idempotente: si ya no está `activo` o su `fin` no llegó, no hace nada.
 */
export default class TerminarPlanTemporal extends DomainAction<
    EntradaTerminarPlanTemporal,
    PlanTemporalVista
> {
    readonly nombre = 'servicios.terminar_plan_temporal'

    protected async handle(input: EntradaTerminarPlanTemporal, t: Transaccion): Promise<PlanTemporalVista> {
        const ahora = input.ahora ?? new Date()
        const fila = await bloquearPlanTemporal(t.trx, input.id)
        t.fijarEntidad('plan_temporal', fila.id)
        t.fijarEmpresa(fila.empresa_id)
        if (fila.estado !== 'activo' || new Date(fila.fin) > ahora) return verPlanTemporal(fila.id, t.trx)

        await devolverPlanBase(t, fila, { estado: 'terminado', terminado_en: ahora }, 'fin')
        return verPlanTemporal(fila.id, t.trx)
    }
}

/**
 * Cierra un plan temporal activo (terminar o cancelar): el servicio vuelve a `plan_original_id`
 * si todavía tiene el plan temporal, y la fila queda con `cambios`.
 */
export async function devolverPlanBase(
    t: Transaccion,
    fila: { id: number; servicio_id: number; plan_id: number; plan_original_id: number },
    cambios: Record<string, unknown>,
    momento: 'fin' | 'cancelación',
): Promise<void> {
    const servicio = (await t.trx
        .from('core.servicios')
        .where('id', fila.servicio_id)
        .forUpdate()
        .select('plan_id', 'empresa_id')
        .firstOrFail()) as { plan_id: number; empresa_id: number }
    const antes = await filaAuditable(t.trx, fila.id)
    await t.trx
        .from('core.servicios_planes_temporales')
        .where('id', fila.id)
        .update({
            ...cambios,
            version: t.trx.knexRawQuery('version + 1'),
            updated_at: t.trx.knexRawQuery('now()'),
        } as Record<string, unknown>)
    await t.registrarCambios(
        { tipo: 'plan_temporal', id: fila.id },
        antes,
        await filaAuditable(t.trx, fila.id),
    )
    if (Number(servicio.plan_id) !== fila.plan_id) return
    await cambiarPlanPorTemporal(t, {
        servicioId: fila.servicio_id,
        empresaId: Number(servicio.empresa_id),
        de: fila.plan_id,
        a: fila.plan_original_id,
        planTemporalId: fila.id,
        tramo: `plan temporal ${fila.id}: ${momento}`,
    })
}
