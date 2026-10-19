import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { actualizarConVersion, verificarVersion } from '#shared/version'
import { verAdicional, type AdicionalVista } from '#core/adicionales'

export interface EntradaDesactivarAdicional {
    id: number
    version: number
}

/**
 * Desactiva un adicional del catálogo (`adicionales.desactivar`); nunca se borra. Ya no se puede
 * asignar ni lo traen los planes que lo incluyen (se salta al crear o cambiar de plan). Las
 * asignaciones vigentes se quedan como están. Ya inactivo: 200 sin cambios.
 */
export default class DesactivarAdicional extends DomainAction<EntradaDesactivarAdicional, AdicionalVista> {
    readonly nombre = 'adicionales.desactivar'

    protected async handle(input: EntradaDesactivarAdicional, t: Transaccion): Promise<AdicionalVista> {
        t.fijarEntidad('adicional', input.id)
        const antes = await verAdicional(input.id, t.trx)
        t.fijarEmpresa(antes.empresa_id)
        exigirAccesoEmpresa(t.ctx, antes.empresa_id)
        verificarVersion('adicional', input.id, antes.version, input.version)
        if (!antes.activo) return antes
        await actualizarConVersion(t.trx, 'core.adicionales', input.id, input.version, { activo: false })
        const despues = await verAdicional(input.id, t.trx)
        await t.registrarCambios({ tipo: 'adicional', id: input.id }, antes, despues)
        return despues
    }
}
