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
 * activa. 422 `empresa_principal` para la empresa 1, `empresa_inactiva` si ya lo está y
 * `empresa_con_servicios` si aún tiene servicios sin retirar (se mueven antes con
 * `servicios.cambiar_empresa`).
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
        const servicios = (await t.trx
            .from('core.servicios')
            .where('empresa_id', input.id)
            .whereNot('estado', 'retirado')
            .count('* as total')
            .first()) as { total: number | string }
        if (Number(servicios.total) > 0) {
            throw new ReglaNegocio(
                `La empresa tiene ${servicios.total} servicio(s) sin retirar; muévelos antes de desactivarla`,
                'empresa_con_servicios',
            )
        }
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
