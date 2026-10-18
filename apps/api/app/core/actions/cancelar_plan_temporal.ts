import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, NoEncontrado } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { verificarVersion } from '#shared/version'
import {
    bloquearPlanTemporal,
    filaAuditable,
    verPlanTemporal,
    type PlanTemporalVista,
} from '#core/planes_temporales'
import { devolverPlanBase } from '#core/actions/terminar_plan_temporal'

export interface EntradaCancelarPlanTemporal {
    id: number
    /** `version` del plan temporal; 409 si cambió */
    version: number
    motivo: string
    /** si viene, el plan temporal debe ser de este servicio (ruta `/servicios/:id/...`) */
    servicio_id?: number
}

/**
 * Cancela un plan temporal (`servicios.cancelar_plan_temporal`): `programado` → `cancelado` sin
 * tocar el servicio; `activo` → `cancelado` y el servicio vuelve a su plan base con
 * `servicio.config_cambiada` (`motivo: 'plan_temporal'`). La llama el panel y, anidada con actor
 * sistema, `lealtad.revertir_canje`. Terminado o cancelado: 409 `plan_temporal_cerrado`.
 */
export default class CancelarPlanTemporal extends DomainAction<
    EntradaCancelarPlanTemporal,
    PlanTemporalVista
> {
    readonly nombre = 'servicios.cancelar_plan_temporal'

    protected async handle(input: EntradaCancelarPlanTemporal, t: Transaccion): Promise<PlanTemporalVista> {
        const fila = await bloquearPlanTemporal(t.trx, input.id)
        t.fijarEntidad('plan_temporal', fila.id)
        t.fijarEmpresa(fila.empresa_id)
        if (input.servicio_id !== undefined && input.servicio_id !== fila.servicio_id) {
            throw new NoEncontrado(`El plan temporal ${fila.id} no es del servicio ${input.servicio_id}`)
        }
        exigirAccesoEmpresa(t.ctx, fila.empresa_id)
        verificarVersion('plan_temporal', fila.id, fila.version, input.version)
        if (fila.estado !== 'programado' && fila.estado !== 'activo') {
            throw new Conflicto(
                `El plan temporal ${fila.id} ya está ${fila.estado}`,
                'plan_temporal_cerrado',
                'Plan temporal cerrado',
            )
        }

        const cambios = { estado: 'cancelado', motivo: input.motivo, terminado_en: new Date() }
        if (fila.estado === 'activo') {
            await devolverPlanBase(t, fila, cambios, 'cancelación')
        } else {
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
        }
        return verPlanTemporal(fila.id, t.trx)
    }
}
