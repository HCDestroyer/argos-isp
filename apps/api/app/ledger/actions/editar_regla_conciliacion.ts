import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ConflictoVersion, NoEncontrado } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { verRegla, type ReglaConciliacionVista } from '#ledger/conciliacion'
import { normalizarRegla, type EntradaRegla } from '#ledger/reglas_conciliacion'

/** `bancos.editar_regla` (`PUT /bancos/reglas/:id`, permiso `bancos.conciliar`): con `version` y `audit.cambios`. */
export default class EditarReglaConciliacion extends DomainAction<
    EntradaRegla & { id: number; version: number },
    ReglaConciliacionVista
> {
    readonly nombre = 'bancos.editar_regla'

    protected async handle(
        input: EntradaRegla & { id: number; version: number },
        t: Transaccion,
    ): Promise<ReglaConciliacionVista> {
        t.fijarEntidad('regla_conciliacion', input.id)
        const actual = (await t.trx
            .from('ledger.reglas_conciliacion')
            .where('id', input.id)
            .forUpdate()
            .select('*')
            .first()) as Record<string, unknown> | null
        if (!actual) throw new NoEncontrado(`La regla de conciliación ${input.id} no existe`)
        const empresaId = Number(actual.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        if (Number(actual.version) !== input.version) {
            throw new ConflictoVersion('regla_conciliacion', input.id)
        }
        const datos = await normalizarRegla(t, input, empresaId)
        const antes = Object.fromEntries(Object.keys(datos).map((k) => [k, actual[k] ?? null]))
        await t.trx
            .from('ledger.reglas_conciliacion')
            .where('id', input.id)
            .update({
                ...datos,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios({ tipo: 'regla_conciliacion', id: input.id }, antes, datos)
        return verRegla(input.id, t.trx)
    }
}
