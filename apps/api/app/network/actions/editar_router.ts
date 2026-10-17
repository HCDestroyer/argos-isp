import { DomainAction, type Transaccion } from '#shared/domain_action'
import { actualizarConVersion } from '#shared/version'
import { auditableRouter, columnasRouter, type DatosRouter } from '#network/actions/crear_router'
import { verRouter, type RouterVista } from '#network/consultas/routers'
import { exigirEmpresaActiva } from '#core/empresas'

export interface EntradaEditarRouter extends DatosRouter {
    id: number
    version: number
}

/**
 * Edita un router (control optimista por `version`). Cambiar una credencial se audita como
 * campo cambiado con valor `***`, nunca en claro. Cambiar la capacidad del enlace emite
 * `router.control_cambiado` con `campos: ['capacidad']` (A2 recalcula el padre global). El
 * control de velocidad no se edita aquí: `CambiarControlVelocidad` (`routers.cambiar_control_velocidad`).
 */
export default class EditarRouter extends DomainAction<EntradaEditarRouter, RouterVista> {
    readonly nombre = 'routers.editar'

    protected async handle(input: EntradaEditarRouter, t: Transaccion): Promise<RouterVista> {
        const { id, version, ...datos } = input
        t.fijarEntidad('router', id)
        const antes = await verRouter(id, t.trx)
        if (datos.empresa_sugerida_id && datos.empresa_sugerida_id !== antes.empresa_sugerida_id) {
            await exigirEmpresaActiva(t.trx, datos.empresa_sugerida_id, 'empresa_sugerida_id')
        }
        await actualizarConVersion(t.trx, 'network.routers', id, version, columnasRouter(datos))
        const despues = await verRouter(id, t.trx)

        const a = auditableRouter(antes)
        const d = auditableRouter(despues)
        // Una credencial reemplazada por otra también es un cambio, aunque ambas estén "definidas".
        if (typeof datos.api_password === 'string' && a.api_password) a.api_password = 'anterior'
        if (typeof datos.radius_secret === 'string' && a.radius_secret) a.radius_secret = 'anterior'
        await t.registrarCambios({ tipo: 'router', id }, a, d)
        if (
            antes.capacidad_bajada_kbps !== despues.capacidad_bajada_kbps ||
            antes.capacidad_subida_kbps !== despues.capacidad_subida_kbps
        ) {
            await t.emit('router.control_cambiado', {
                router_id: id,
                de: despues.control_velocidad,
                a: despues.control_velocidad,
                capacidad_bajada_kbps: despues.capacidad_bajada_kbps,
                capacidad_subida_kbps: despues.capacidad_subida_kbps,
                campos: ['capacidad'],
                motivo: null,
            })
        }
        return despues
    }
}
