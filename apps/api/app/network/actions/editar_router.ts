import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ReglaNegocio } from '#shared/errores'
import { actualizarConVersion } from '#shared/version'
import { auditableRouter, columnasRouter, type DatosRouter } from '#network/actions/crear_router'
import { verRouter, type RouterVista } from '#network/consultas/routers'
import { exigirEmpresaActiva } from '#core/empresas'
import { extremoApi, exigirRouterUnico } from '#network/routers_duplicados'

export interface EntradaEditarRouter extends DatosRouter {
    id: number
    version: number
}

/**
 * 409 `router_duplicado` (`contratos/routers.md`) solo por lo que la edición cambia: el extremo de
 * la API, la `nas_ip`, o reactivar un router (entonces se revisa todo, también el serial). Así un
 * duplicado que ya existía se puede seguir editando hasta unirlo (`routers.unir`).
 */
async function exigirSinDuplicado(t: Transaccion, antes: RouterVista, datos: DatosRouter) {
    const despues = {
        id: antes.id,
        host: datos.host ?? antes.host,
        api_url: datos.api_url !== undefined ? datos.api_url : antes.api_url,
        nas_ip: datos.nas_ip ?? antes.nas_ip,
        serial: antes.serial,
    }
    const activo = datos.activo ?? antes.activo
    const reactiva = activo && !antes.activo
    if (reactiva && antes.unido_a_id !== null) {
        throw new ReglaNegocio(
            `El router está unido al router ${antes.unido_a_id}: es el mismo equipo y no se reactiva`,
            'router_unido',
        )
    }
    await exigirRouterUnico(t.trx, despues, {
        api: activo && (reactiva || extremoApi(despues) !== extremoApi(antes)),
        nas_ip: despues.nas_ip !== antes.nas_ip,
        serial: reactiva,
    })
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
        await exigirSinDuplicado(t, antes, datos)
        await actualizarConVersion(t.trx, 'network.routers', id, version, columnasRouter(datos))
        const despues = await verRouter(id, t.trx)

        const a = auditableRouter(antes)
        const d = auditableRouter(despues)
        // Una credencial reemplazada por otra también es un cambio, aunque ambas estén "definidas".
        if (typeof datos.api_password === 'string' && a.api_password) a.api_password = 'anterior'
        if (typeof datos.radius_secret === 'string' && a.radius_secret) a.radius_secret = 'anterior'
        if (typeof datos.api_ca === 'string' && a.api_ca) a.api_ca = 'anterior'
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
