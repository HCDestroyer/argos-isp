import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { ConflictoVersion, ValidacionFallida } from '#shared/errores'
import { configuracionInventario, type ConfiguracionInventario } from '#inventario/ordenes_traslado'

/**
 * `inventario.configurar` (`POST /inventario/configuracion`, fase D, `contratos/inventario.md` D.1):
 * la configuración del inventario de una empresa (`traslado_firma_obligatoria`). Sin fila, los valores
 * por defecto (`version` 0): la primera vez se manda `version: 0`. Con `audit.cambios`.
 */

export interface EntradaConfigurarInventario {
    empresa_id?: number | null
    traslado_firma_obligatoria: boolean
    version: number
}

export default class ConfigurarInventario extends DomainAction<
    EntradaConfigurarInventario,
    ConfiguracionInventario
> {
    readonly nombre = 'inventario.configurar'

    protected async handle(
        input: EntradaConfigurarInventario,
        t: Transaccion,
    ): Promise<ConfiguracionInventario> {
        const empresaId = input.empresa_id ?? t.ctx.empresaId ?? null
        if (!empresaId) {
            throw new ValidacionFallida([
                { field: 'empresa_id', message: 'Indica la empresa', rule: 'required' },
            ])
        }
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [3073, empresaId])
        const antes = await configuracionInventario(empresaId, t.trx)
        if (antes.version !== input.version) throw new ConflictoVersion('configuracion_inventario', empresaId)
        if (antes.version === 0) {
            await t.trx.insertQuery().table('inventario.configuracion').insert({
                empresa_id: empresaId,
                traslado_firma_obligatoria: input.traslado_firma_obligatoria,
            })
        } else {
            await t.trx
                .from('inventario.configuracion')
                .where('empresa_id', empresaId)
                .update({
                    traslado_firma_obligatoria: input.traslado_firma_obligatoria,
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                })
        }
        const fila = await t.trx
            .from('inventario.configuracion')
            .where('empresa_id', empresaId)
            .select('id')
            .first()
        t.fijarEntidad('configuracion_inventario', Number(fila!.id))
        await t.registrarCambios(
            { tipo: 'configuracion_inventario', id: Number(fila!.id) },
            { traslado_firma_obligatoria: antes.traslado_firma_obligatoria },
            { traslado_firma_obligatoria: input.traslado_firma_obligatoria },
        )
        return configuracionInventario(empresaId, t.trx)
    }
}
