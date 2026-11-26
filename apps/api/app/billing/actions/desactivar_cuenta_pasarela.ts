import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { filaCuentaPasarela, vistaDeCuenta, type CuentaPasarelaVista } from '#billing/pasarelas/cuentas'
import { normalizarPredeterminadas, paraAuditoria } from '#billing/pasarelas/cuentas_config'

/**
 * `pasarelas.desactivar_cuenta` (`POST /pasarelas/cuentas/:id/desactivar`, permiso
 * `pasarelas.configurar`): la cuenta deja de crear cobros y deja de ser la predeterminada (si hay
 * otra activa con ese uso, esa pasa a serlo). Sus webhooks siguen valiendo para los cobros ya
 * hechos. Idempotente. Si era la única cuenta de la empresa, la empresa queda sin pago en línea
 * (503 `pasarela_no_configurada`): no vuelve al entorno.
 */
export default class DesactivarCuentaPasarela extends DomainAction<{ id: number }, CuentaPasarelaVista> {
    readonly nombre = 'pasarelas.desactivar_cuenta'

    protected async handle(input: { id: number }, t: Transaccion): Promise<CuentaPasarelaVista> {
        t.fijarEntidad('cuenta_pasarela', input.id)
        const actual = await filaCuentaPasarela(input.id, t.trx, true)
        const empresaId = Number(actual.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        if (!actual.activa) return vistaDeCuenta(actual)
        await t.trx
            .from('billing.pasarela_cuentas')
            .where('id', input.id)
            .update({
                activa: false,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await normalizarPredeterminadas(t.trx, empresaId)
        const despues = await filaCuentaPasarela(input.id, t.trx)
        const campos = await t.registrarCambios(
            { tipo: 'cuenta_pasarela', id: input.id },
            paraAuditoria(actual),
            paraAuditoria(despues),
        )
        await t.emit('pasarela.config_cambiada', {
            pasarela_cuenta_id: input.id,
            empresa_id: empresaId,
            proveedor: actual.proveedor,
            campos,
        })
        return vistaDeCuenta(despues)
    }
}
