import { DomainAction, type Transaccion } from '#shared/domain_action'
import { actualizarConVersion, verificarVersion } from '#shared/version'
import { verCampoPersonalizado, type CampoPersonalizadoVista } from '#core/campos_personalizados'

export interface EntradaDesactivarCampoPersonalizado {
    id: number
    version: number
}

/**
 * Desactiva un campo personalizado (`campos_personalizados.desactivar`): deja de mostrarse y de
 * validarse; los valores guardados en los clientes se conservan. Ya inactivo: 200 sin cambios.
 */
export default class DesactivarCampoPersonalizado extends DomainAction<
    EntradaDesactivarCampoPersonalizado,
    CampoPersonalizadoVista
> {
    readonly nombre = 'campos_personalizados.desactivar'

    protected async handle(
        input: EntradaDesactivarCampoPersonalizado,
        t: Transaccion,
    ): Promise<CampoPersonalizadoVista> {
        t.fijarEntidad('campo_personalizado', input.id)
        const antes = await verCampoPersonalizado(input.id, t.trx)
        verificarVersion('campo personalizado', input.id, antes.version, input.version)
        if (!antes.activo) return antes
        await actualizarConVersion(t.trx, 'core.campos_personalizados', input.id, input.version, {
            activo: false,
        })
        const despues = await verCampoPersonalizado(input.id, t.trx)
        await t.registrarCambios({ tipo: 'campo_personalizado', id: input.id }, antes, despues)
        return despues
    }
}
