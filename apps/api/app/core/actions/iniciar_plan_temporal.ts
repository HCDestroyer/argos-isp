import { DomainAction, type Transaccion } from '#shared/domain_action'
import type { EstadoServicio } from '#shared/eventos'
import {
    bloquearPlanTemporal,
    cambiarPlanPorTemporal,
    filaAuditable,
    verPlanTemporal,
    type PlanTemporalVista,
} from '#core/planes_temporales'

export interface EntradaIniciarPlanTemporal {
    id: number
    /** reloj de la corrida (cron); por defecto, ahora */
    ahora?: Date
}

/**
 * Inicia un plan temporal `programado` cuyo `inicio` ya llegó (`servicios.iniciar_plan_temporal`,
 * acción del sistema: la llaman el cron y `servicios.programar_plan_temporal`).
 *
 * - Guarda en `plan_original_id` el plan vigente del servicio (su plan base) y pone el temporal en
 *   `core.servicios.plan_id`; emite `servicio.config_cambiada` (`campos: ['plan']`, `motivo:
 *   'plan_temporal'`) y reescribe `aaa:user:*`. A2 aplica la velocidad sin cortar la sesión.
 * - Idempotente: si ya no está `programado` (otra corrida lo tomó) no hace nada.
 * - Si el `fin` ya pasó (el cron estuvo detenido toda la vigencia) queda `terminado` sin aplicar;
 *   si el servicio está retirado, `cancelado`.
 */
export default class IniciarPlanTemporal extends DomainAction<EntradaIniciarPlanTemporal, PlanTemporalVista> {
    readonly nombre = 'servicios.iniciar_plan_temporal'

    protected async handle(input: EntradaIniciarPlanTemporal, t: Transaccion): Promise<PlanTemporalVista> {
        const ahora = input.ahora ?? new Date()
        const fila = await bloquearPlanTemporal(t.trx, input.id)
        t.fijarEntidad('plan_temporal', fila.id)
        t.fijarEmpresa(fila.empresa_id)
        if (fila.estado !== 'programado' || new Date(fila.inicio) > ahora) {
            return verPlanTemporal(fila.id, t.trx)
        }

        const servicio = (await t.trx
            .from('core.servicios')
            .where('id', fila.servicio_id)
            .forUpdate()
            .select('plan_id', 'estado', 'empresa_id')
            .firstOrFail()) as { plan_id: number; estado: EstadoServicio; empresa_id: number }
        const planBase = Number(servicio.plan_id)
        const antes = await filaAuditable(t.trx, fila.id)

        let cambios: Record<string, unknown>
        if (servicio.estado === 'retirado') {
            cambios = { estado: 'cancelado', motivo: 'servicio_retirado', terminado_en: ahora }
        } else if (new Date(fila.fin) <= ahora) {
            cambios = { estado: 'terminado', motivo: 'vencido_sin_iniciar', terminado_en: ahora }
        } else {
            cambios = { estado: 'activo', iniciado_en: ahora }
            // el plan base es el que el servicio tiene al iniciar (pudo cambiar desde que se programó)
            if (planBase !== fila.plan_id) cambios.plan_original_id = planBase
        }
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

        if (cambios.estado === 'activo') {
            await cambiarPlanPorTemporal(t, {
                servicioId: fila.servicio_id,
                empresaId: Number(servicio.empresa_id),
                de: planBase,
                a: fila.plan_id,
                planTemporalId: fila.id,
                tramo: `plan temporal ${fila.id}: inicio`,
            })
        }
        return verPlanTemporal(fila.id, t.trx)
    }
}
