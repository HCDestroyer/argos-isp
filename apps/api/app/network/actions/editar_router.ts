import { DomainAction, type Transaccion } from '#shared/domain_action'
import { actualizarConVersion } from '#shared/version'
import { auditableRouter, columnasRouter, exigirZona, type DatosRouter } from '#network/actions/crear_router'
import { verRouter, type RouterVista } from '#network/consultas/routers'
import { exigirEmpresaActiva } from '#core/empresas'
import { ValidacionFallida } from '#shared/errores'

export interface EntradaEditarRouter extends DatosRouter {
    id: number
    version: number
    /** borra la clave de la API (en la edición, `api_password` vacía o null no cambia nada) */
    quitar_api_password?: boolean
    /** borra el secreto RADIUS (en la edición, `radius_secret` vacío o null no cambia nada) */
    quitar_radius_secret?: boolean
}

/**
 * Credenciales en la edición (pedido del PM, 28 oct): el panel deja el campo vacío para "no
 * cambiar" (el bodyparser convierte `""` en null), así que null tampoco cambia nada. Quitar una
 * credencial es explícito, con `quitar_*`; pedir las dos cosas a la vez es 422.
 */
function credencialesEditadas(input: EntradaEditarRouter): EntradaEditarRouter {
    const { quitar_api_password: quitarApi, quitar_radius_secret: quitarRadius, ...datos } = input
    const errores = []
    for (const [campo, quitar] of [
        ['api_password', quitarApi],
        ['radius_secret', quitarRadius],
    ] as const) {
        const valor = datos[campo]
        if (quitar && valor) {
            errores.push({
                field: campo,
                rule: 'quitar',
                message: `Manda ${campo} o quitar_${campo}, no los dos: no se puede cambiar y quitar a la vez`,
            })
        }
        if (quitar) datos[campo] = null
        else if (!valor) delete datos[campo]
    }
    if (errores.length > 0) throw new ValidacionFallida(errores)
    return datos
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
        const { id, version, ...datos } = credencialesEditadas(input)
        t.fijarEntidad('router', id)
        const antes = await verRouter(id, t.trx)
        if (datos.empresa_sugerida_id && datos.empresa_sugerida_id !== antes.empresa_sugerida_id) {
            await exigirEmpresaActiva(t.trx, datos.empresa_sugerida_id, 'empresa_sugerida_id')
        }
        if (datos.zona_id !== antes.zona_id) await exigirZona(t.trx, datos.zona_id)
        await actualizarConVersion(t.trx, 'network.routers', id, version, columnasRouter(datos))
        const despues = await verRouter(id, t.trx)

        const a = auditableRouter(antes)
        const d = auditableRouter(despues)
        // Una credencial reemplazada por otra también es un cambio, aunque ambas estén "definidas".
        if (datos.api_password && a.api_password) a.api_password = 'anterior'
        if (datos.radius_secret && a.radius_secret) a.radius_secret = 'anterior'
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
