import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { Problema } from '#shared/errores'
import { actualizarConVersion, verificarVersion } from '#shared/version'
import { verMotivoCortesia, type MotivoCortesiaVista } from '#core/adicionales'

export interface EntradaDesactivarMotivoCortesia {
    id: number
    version: number
}

/**
 * Desactiva un motivo de cortesía (`adicionales.desactivar_motivo`); nunca se borra y las
 * cortesías que ya lo usan lo conservan. Un motivo común (de todas las empresas) solo lo desactiva
 * quien tiene alcance sobre todas (403 `empresa_no_permitida`). Ya inactivo: 200 sin cambios.
 */
export default class DesactivarMotivoCortesia extends DomainAction<
    EntradaDesactivarMotivoCortesia,
    MotivoCortesiaVista
> {
    readonly nombre = 'adicionales.desactivar_motivo'

    protected async handle(
        input: EntradaDesactivarMotivoCortesia,
        t: Transaccion,
    ): Promise<MotivoCortesiaVista> {
        t.fijarEntidad('motivo_cortesia', input.id)
        const antes = await verMotivoCortesia(input.id, t.trx)
        if (antes.empresa_id === null) {
            const permitidas = t.ctx.empresasPermitidas
            if (permitidas !== null && permitidas !== undefined) {
                throw new Problema(
                    403,
                    'empresa_no_permitida',
                    'Empresa no permitida',
                    'Un motivo común a todas las empresas solo lo desactiva quien tiene alcance global',
                )
            }
        } else {
            t.fijarEmpresa(antes.empresa_id)
            exigirAccesoEmpresa(t.ctx, antes.empresa_id)
        }
        verificarVersion('motivo de cortesía', input.id, antes.version, input.version)
        if (!antes.activo) return antes
        await actualizarConVersion(t.trx, 'core.motivos_cortesia', input.id, input.version, { activo: false })
        const despues = await verMotivoCortesia(input.id, t.trx)
        await t.registrarCambios({ tipo: 'motivo_cortesia', id: input.id }, antes, despues)
        return despues
    }
}
