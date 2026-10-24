import { DomainAction, type Transaccion } from '#shared/domain_action'
import { actualizarConVersion, verificarVersion } from '#shared/version'
import { verCampoPersonalizado, type CampoPersonalizadoVista } from '#core/campos_personalizados'

export interface EntradaActivarCampoPersonalizado {
    id: number
    version: number
}

/**
 * Vuelve a activar un campo personalizado (`campos_personalizados.activar`): se muestra y se
 * valida otra vez. Ya activo: 200 sin cambios.
 */
export default class ActivarCampoPersonalizado extends DomainAction<
    EntradaActivarCampoPersonalizado,
    CampoPersonalizadoVista
> {
    readonly nombre = 'campos_personalizados.activar'

    protected async handle(
        input: EntradaActivarCampoPersonalizado,
        t: Transaccion,
    ): Promise<CampoPersonalizadoVista> {
        t.fijarEntidad('campo_personalizado', input.id)
        const antes = await verCampoPersonalizado(input.id, t.trx)
        verificarVersion('campo personalizado', input.id, antes.version, input.version)
        if (antes.activo) return antes
        await actualizarConVersion(t.trx, 'core.campos_personalizados', input.id, input.version, {
            activo: true,
        })
        const despues = await verCampoPersonalizado(input.id, t.trx)
        await t.registrarCambios({ tipo: 'campo_personalizado', id: input.id }, antes, despues)
        return despues
    }
}
