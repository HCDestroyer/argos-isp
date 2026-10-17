import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ReglaNegocio } from '#shared/errores'
import { actualizarConVersion } from '#shared/version'
import { EMPRESA_PRINCIPAL, verEmpresaCompleta, type EmpresaCompleta } from '#core/empresas'
import { sinDerivados } from '#core/actions/crear_empresa'

export interface EntradaDesactivarEmpresa {
    id: number
    version: number
    motivo: string
}

/**
 * Desactiva una empresa (`empresas.desactivar`): deja de aparecer en el selector y no recibe
 * servicios nuevos. Nunca se borra (puede tener documentos); su NIT queda libre para otra empresa
 * activa. 422 `empresa_principal` para la empresa 1 y `empresa_inactiva` si ya lo está.
 */
export default class DesactivarEmpresa extends DomainAction<EntradaDesactivarEmpresa, EmpresaCompleta> {
    readonly nombre = 'empresas.desactivar'

    protected async handle(input: EntradaDesactivarEmpresa, t: Transaccion): Promise<EmpresaCompleta> {
        t.fijarEntidad('empresa', input.id)
        t.fijarEmpresa(input.id)
        const antes = await verEmpresaCompleta(input.id, t.trx)
        if (input.id === EMPRESA_PRINCIPAL) {
            throw new ReglaNegocio('La empresa principal no se puede desactivar', 'empresa_principal')
        }
        if (!antes.activa) throw new ReglaNegocio('La empresa ya está desactivada', 'empresa_inactiva')
        await actualizarConVersion(t.trx, 'core.empresas', input.id, input.version, { activa: false })
        const despues = await verEmpresaCompleta(input.id, t.trx)
        await t.registrarCambios(
            { tipo: 'empresa', id: input.id },
            sinDerivados(antes),
            sinDerivados(despues),
        )
        return despues
    }
}
