import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { resolverEmpresaActiva } from '#core/empresas'
import { verRegla, type ReglaConciliacionVista } from '#ledger/conciliacion'
import { normalizarRegla, type EntradaRegla } from '#ledger/reglas_conciliacion'

/** `bancos.crear_regla` (`POST /bancos/reglas`, permiso `bancos.conciliar`). */
export default class CrearReglaConciliacion extends DomainAction<EntradaRegla, ReglaConciliacionVista> {
    readonly nombre = 'bancos.crear_regla'

    protected async handle(input: EntradaRegla, t: Transaccion): Promise<ReglaConciliacionVista> {
        const empresaId = input.empresa_id ?? (await resolverEmpresaActiva(t.ctx, t.trx))
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        const datos = await normalizarRegla(t, input, empresaId)
        const [fila] = (await t.trx
            .insertQuery()
            .table('ledger.reglas_conciliacion')
            .insert({ ...datos, empresa_id: empresaId })
            .returning('id')) as Array<{ id: number }>
        t.fijarEntidad('regla_conciliacion', fila!.id)
        await t.registrarCambios({ tipo: 'regla_conciliacion', id: fila!.id }, null, {
            ...datos,
            empresa_id: empresaId,
        })
        return verRegla(fila!.id, t.trx)
    }
}
