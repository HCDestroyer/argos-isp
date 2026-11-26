import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { ReglaNegocio } from '#shared/errores'
import { filaCuentaPasarela, vistaDeCuenta, type CuentaPasarelaVista } from '#billing/pasarelas/cuentas'
import { normalizarPredeterminadas, paraAuditoria } from '#billing/pasarelas/cuentas_config'

/**
 * `pasarelas.activar_cuenta` (`POST /pasarelas/cuentas/:id/activar`, permiso `pasarelas.configurar`):
 * la cuenta empieza a cobrar. Exige una prueba buena (`prueba_ok`; 422 `cuenta_sin_prueba`). Si la
 * empresa no tenía cuenta predeterminada para un uso, esta pasa a serlo. Idempotente.
 */
export default class ActivarCuentaPasarela extends DomainAction<{ id: number }, CuentaPasarelaVista> {
    readonly nombre = 'pasarelas.activar_cuenta'

    protected async handle(input: { id: number }, t: Transaccion): Promise<CuentaPasarelaVista> {
        t.fijarEntidad('cuenta_pasarela', input.id)
        const actual = await filaCuentaPasarela(input.id, t.trx, true)
        const empresaId = Number(actual.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        if (actual.activa) return vistaDeCuenta(actual)
        if (!actual.prueba_ok) {
            throw new ReglaNegocio(
                'La cuenta no tiene una prueba buena: usa «probar» antes de activarla',
                'cuenta_sin_prueba',
            )
        }
        await t.trx
            .from('billing.pasarela_cuentas')
            .where('id', input.id)
            .update({
                activa: true,
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
