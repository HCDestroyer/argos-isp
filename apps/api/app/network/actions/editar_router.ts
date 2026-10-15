import { DomainAction, type Transaccion } from '#shared/domain_action'
import { actualizarConVersion } from '#shared/version'
import { auditableRouter, columnasRouter, type DatosRouter } from '#network/actions/crear_router'
import { verRouter, type RouterVista } from '#network/consultas/routers'

export interface EntradaEditarRouter extends DatosRouter {
    id: number
    version: number
}

/**
 * Edita un router (control optimista por `version`). Cambiar una credencial se audita como
 * campo cambiado con valor `***`, nunca en claro.
 */
export default class EditarRouter extends DomainAction<EntradaEditarRouter, RouterVista> {
    readonly nombre = 'routers.editar'

    protected async handle(input: EntradaEditarRouter, t: Transaccion): Promise<RouterVista> {
        const { id, version, ...datos } = input
        t.fijarEntidad('router', id)
        const antes = await verRouter(id, t.trx)
        await actualizarConVersion(t.trx, 'network.routers', id, version, columnasRouter(datos))
        const despues = await verRouter(id, t.trx)

        const a = auditableRouter(antes)
        const d = auditableRouter(despues)
        // Una credencial reemplazada por otra también es un cambio, aunque ambas estén "definidas".
        if (typeof datos.api_password === 'string' && a.api_password) a.api_password = 'anterior'
        if (typeof datos.radius_secret === 'string' && a.radius_secret) a.radius_secret = 'anterior'
        await t.registrarCambios({ tipo: 'router', id }, a, d)
        return despues
    }
}
