import { DomainAction, type Transaccion } from '#shared/domain_action'
import { actualizarConVersion } from '#shared/version'
import { auditableRouter } from '#network/actions/crear_router'
import { verRouter, type RouterVista } from '#network/consultas/routers'
import type { ControlVelocidad } from '#network/velocidad'

export interface EntradaCambiarControlVelocidad {
    id: number
    version: number
    control_velocidad: ControlVelocidad
    motivo?: string
}

/**
 * Cambia el control de velocidad de un router (`simple` ↔ `arbol_pcq`, `contratos/velocidad.md`).
 * Solo cambia el campo (control optimista por `version`), lo audita y emite
 * `router.control_cambiado`; la vista previa y la ejecución por lotes en el router son de A2 (la
 * reciben por el evento). Si ya está en ese modo, responde el router sin cambios ni evento.
 * Permiso `routers.cambiar_control_velocidad` (solo `admin`).
 */
export default class CambiarControlVelocidad extends DomainAction<
    EntradaCambiarControlVelocidad,
    RouterVista
> {
    readonly nombre = 'routers.cambiar_control_velocidad'

    protected async handle(input: EntradaCambiarControlVelocidad, t: Transaccion): Promise<RouterVista> {
        t.fijarEntidad('router', input.id)
        const antes = await verRouter(input.id, t.trx)
        if (antes.control_velocidad === input.control_velocidad) return antes
        await actualizarConVersion(t.trx, 'network.routers', input.id, input.version, {
            control_velocidad: input.control_velocidad,
        })
        const despues = await verRouter(input.id, t.trx)
        await t.registrarCambios(
            { tipo: 'router', id: input.id },
            auditableRouter(antes),
            auditableRouter(despues),
        )
        await t.emit('router.control_cambiado', {
            router_id: input.id,
            de: antes.control_velocidad,
            a: despues.control_velocidad,
            capacidad_bajada_kbps: despues.capacidad_bajada_kbps,
            capacidad_subida_kbps: despues.capacidad_subida_kbps,
            campos: ['control_velocidad'],
            motivo: input.motivo ?? null,
        })
        return despues
    }
}
