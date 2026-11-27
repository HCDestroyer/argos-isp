import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ValidacionFallida } from '#shared/errores'
import { verificarVersion } from '#shared/version'
import type { ServicioVista } from '#core/consultas/servicios'
import { verServicio } from '#core/consultas/servicios'
import EditarServicio from '#core/actions/editar_servicio'
import { exigirServicioConRouter } from '#core/tipo_servicio_servicio'
import {
    PlanNoPermitido,
    ServicioNoPendiente,
    bloquearServicio,
    exigirServicioDeIris,
    modoDePlan,
    planAplicable,
} from '#core/instalacion_iris'

export const MOTIVOS_CAMBIO_PLAN = ['mas_velocidad', 'menos_velocidad', 'otro'] as const

export interface EntradaCambiarPlanPendiente {
    id: number
    plan_id: number
    motivo: (typeof MOTIVOS_CAMBIO_PLAN)[number]
    /** obligatorio con `motivo: otro`; queda solo en la auditoría */
    motivo_texto?: string
    version?: number
    origen_tipo: string
    origen_id: string
    desdeIris?: boolean
}

/**
 * `servicios.cambiar_plan_pendiente` (`POST /servicios/:id/cambiar-plan`, contrato Iris 0.10.0
 * §3.4.5, A40): el técnico cambia el plan antes de activar. Solo en `pendiente_instalacion` (422
 * `servicio_no_pendiente`), a un plan aplicable (activo, del mismo modo y asignado a todos los
 * routers o al del servicio; si no, 422 `plan_no_permitido`). Sin factura ni prorrateo. `version`
 * opcional (409 si llega y no coincide). Corre como una edición del plan (`servicios.editar`
 * anidada): emite `servicio.config_cambiada` con `plan` y `precio` en `campos[]` y la orden de Iris
 * en `origen_tipo`/`origen_id`.
 */
export default class CambiarPlanPendiente extends DomainAction<EntradaCambiarPlanPendiente, ServicioVista> {
    readonly nombre = 'servicios.cambiar_plan_pendiente'

    protected async handle(input: EntradaCambiarPlanPendiente, t: Transaccion): Promise<ServicioVista> {
        t.fijarEntidad('servicio', input.id)
        if (input.motivo === 'otro' && !input.motivo_texto?.trim()) {
            throw new ValidacionFallida([
                { field: 'motivo_texto', rule: 'required', message: 'Con motivo otro, escribe el motivo' },
            ])
        }
        const servicio = await bloquearServicio(t.trx, input.id)
        if (!servicio) throw new NoEncontrado(`El servicio ${input.id} no existe`)
        t.fijarEmpresa(servicio.empresa_id)
        await exigirServicioConRouter(t.trx, input.id)
        if (servicio.estado !== 'pendiente_instalacion') throw new ServicioNoPendiente(servicio.estado)
        const origen = { origen_tipo: input.origen_tipo, origen_id: input.origen_id }
        if (input.desdeIris) await exigirServicioDeIris(t, input.id, origen)
        if (input.version !== undefined) {
            verificarVersion('servicio', input.id, servicio.version, input.version)
        }
        if (input.plan_id === servicio.plan_id) return verServicio(input.id, t.trx)
        const modo = await modoDePlan(t.trx, servicio.plan_id)
        if (!(await planAplicable(t.trx, input.plan_id, servicio.router_id, modo))) {
            throw new PlanNoPermitido()
        }
        const editado = await new EditarServicio().execute(
            { id: input.id, version: servicio.version, plan_id: input.plan_id, origen },
            t.ctx,
            { trx: t.trx },
        )
        // la respuesta es el servicio, sin las advertencias del tipo de plan de la edición
        return Object.fromEntries(
            Object.entries(editado).filter(([clave]) => clave !== 'warnings'),
        ) as unknown as ServicioVista
    }
}
