import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ConflictoVersion } from '#shared/errores'
import { exigirEmpresaActivaDelContexto } from '#shared/empresa_activa'
import { DIAS_BAJA_FABRICA } from '#billing/panel/indicadores'

export interface EntradaConfigurarPanel {
    dias_baja: number
    /** la `version` leída en GET /panel-financiero/ajustes (1 si nunca se guardó) */
    version?: number
}

export interface AjustesPanel {
    empresa_id: number
    dias_baja: number
    /** true si la empresa nunca los cambió (valores de fábrica) */
    fabrica: boolean
    version: number
}

/**
 * `panel_financiero.configurar`: ajustes del panel de la empresa activa (decisión 4 del PM: días de
 * suspensión para contar una baja, 60 de fábrica). 409 si `version` cambió. Diff en `audit.cambios`
 * (`panel_financiero`, empresa) y `panel_financiero.ajustes_cambiados` si algo cambió.
 */
export default class ConfigurarPanelFinanciero extends DomainAction<EntradaConfigurarPanel, AjustesPanel> {
    readonly nombre = 'panel_financiero.configurar'

    protected async handle(input: EntradaConfigurarPanel, t: Transaccion): Promise<AjustesPanel> {
        const empresaId = exigirEmpresaActivaDelContexto(t.ctx)
        t.fijarEmpresa(empresaId)
        t.fijarEntidad('panel_financiero', empresaId)
        const antes = (await t.trx
            .from('billing.panel_ajustes')
            .where('empresa_id', empresaId)
            .forUpdate()
            .first()) as { dias_baja: number; version: number } | null
        const versionActual = antes ? Number(antes.version) : 1
        if (input.version !== undefined && input.version !== versionActual) {
            throw new ConflictoVersion('panel_financiero', empresaId)
        }
        const diasAntes = antes ? Number(antes.dias_baja) : DIAS_BAJA_FABRICA
        if (antes) {
            if (diasAntes !== input.dias_baja) {
                await t.trx
                    .from('billing.panel_ajustes')
                    .where('empresa_id', empresaId)
                    .update({
                        dias_baja: input.dias_baja,
                        version: t.trx.knexRawQuery('version + 1'),
                        updated_at: t.trx.knexRawQuery('now()'),
                    })
            }
        } else {
            await t.trx
                .table('billing.panel_ajustes')
                .insert({ empresa_id: empresaId, dias_baja: input.dias_baja })
        }
        if (diasAntes !== input.dias_baja) {
            await t.registrarCambios(
                { tipo: 'panel_financiero', id: empresaId },
                { dias_baja: diasAntes },
                { dias_baja: input.dias_baja },
            )
            await t.emit('panel_financiero.ajustes_cambiados', {
                empresa_id: empresaId,
                campos: ['dias_baja'],
                dias_baja: input.dias_baja,
            })
        }
        return verAjustesPanel(t.trx, empresaId)
    }
}

export async function verAjustesPanel(c: QueryClientContract, empresaId: number): Promise<AjustesPanel> {
    const fila = (await c.from('billing.panel_ajustes').where('empresa_id', empresaId).first()) as {
        dias_baja: number
        version: number
    } | null
    return {
        empresa_id: empresaId,
        dias_baja: fila ? Number(fila.dias_baja) : DIAS_BAJA_FABRICA,
        fabrica: !fila,
        version: fila ? Number(fila.version) : 1,
    }
}
