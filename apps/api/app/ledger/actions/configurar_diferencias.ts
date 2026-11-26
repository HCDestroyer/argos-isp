import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, ValidacionFallida } from '#shared/errores'
import { resolverEmpresaActiva } from '#core/empresas'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { aTexto, dec } from '#ledger/dinero'
import {
    LOCK_DIFERENCIAS,
    leerAjustesConciliacion,
    leerTopes,
    type AjustesConciliacion,
} from '#ledger/diferencias_conciliacion'

/**
 * `bancos.configurar_diferencias` (`PUT /bancos/ajustes-conciliacion`; plan de contabilidad §5.8):
 * tope de quien concilia en la empresa activa, por línea y por día (Q 0.00 = toda diferencia que
 * cuente contra el tope pide aprobación). El tope por línea no pasa del tope del día. Con `version`
 * (0 si nunca se guardó; 409 `conflicto_version`). Solo cambia lo que viene. Diff en `audit.cambios`
 * y evento `banco.diferencias_config_cambiada` (sin cambios no emite).
 */

export interface EntradaConfigurarDiferencias {
    empresa_id?: number | null
    version: number
    tope_linea?: string
    tope_dia?: string
}

export default class ConfigurarDiferencias extends DomainAction<
    EntradaConfigurarDiferencias,
    AjustesConciliacion
> {
    readonly nombre = 'bancos.configurar_diferencias'

    protected async handle(
        input: EntradaConfigurarDiferencias,
        t: Transaccion,
    ): Promise<AjustesConciliacion> {
        const empresaId = input.empresa_id ?? (await resolverEmpresaActiva(t.ctx, t.trx))
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        t.fijarEntidad('empresa', empresaId)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?::int)', [LOCK_DIFERENCIAS, empresaId])
        const antes = await leerTopes(empresaId, t.trx)
        if (antes.version !== input.version) {
            throw new Conflicto(
                `Los ajustes cambiaron (versión ${antes.version}); vuelve a leerlos`,
                'conflicto_version',
                'Conflicto de versión',
            )
        }
        const despues = {
            tope_linea: aTexto(input.tope_linea ?? antes.tope_linea),
            tope_dia: aTexto(input.tope_dia ?? antes.tope_dia),
        }
        if (dec(despues.tope_linea).isNegative() || dec(despues.tope_dia).isNegative()) {
            throw new ValidacionFallida([
                { field: 'tope_linea', message: 'Los topes no son negativos', rule: 'min' },
            ])
        }
        if (dec(despues.tope_linea).gt(despues.tope_dia)) {
            throw new ValidacionFallida([
                {
                    field: 'tope_linea',
                    message: 'El tope por línea no pasa del tope del día',
                    rule: 'tope_dia',
                },
            ])
        }
        const campos = (['tope_linea', 'tope_dia'] as const).filter((c) => despues[c] !== antes[c])
        if (campos.length === 0) return leerAjustesConciliacion(empresaId, t.trx)
        await t.trx.rawQuery(
            `INSERT INTO billing.ajustes_conciliacion (empresa_id, tope_linea, tope_dia, updated_by)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (empresa_id) DO UPDATE
                SET tope_linea = EXCLUDED.tope_linea,
                    tope_dia = EXCLUDED.tope_dia,
                    updated_by = EXCLUDED.updated_by,
                    version = billing.ajustes_conciliacion.version + 1,
                    updated_at = now()`,
            [empresaId, despues.tope_linea, despues.tope_dia, usuarioDelActor(t.ctx.actor) as number],
        )
        await t.registrarCambios(
            { tipo: 'ajustes_conciliacion', id: empresaId },
            { tope_linea: antes.tope_linea, tope_dia: antes.tope_dia },
            despues,
        )
        await t.emit('banco.diferencias_config_cambiada', {
            empresa_id: empresaId,
            motivo_id: null,
            campos: [...campos],
        })
        return leerAjustesConciliacion(empresaId, t.trx)
    }
}
