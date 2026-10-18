import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ValidacionFallida } from '#shared/errores'
import { empresaFiscal } from '#fiscal/comun'
import { configuracionFel, type ConfiguracionFel } from '#fiscal/fel/configuracion'
import { FelNoConfigurada } from '#fiscal/fel/errores'

/**
 * `fel.contingencia` (`POST /fel/activar-contingencia` y `/fel/desactivar-contingencia`
 * `{ motivo }`): contabilidad declara (o levanta) la contingencia del certificador para la empresa
 * (contrato §8.3). El worker puede proponerla tras varios fallos seguidos, nunca la activa solo.
 *
 * - Activa: en `obligatoria` las facturas nuevas se emiten (asiento y evento) y su DTE queda
 *   `contingencia`, en cola. **Confirmar con contador**: procedimiento oficial y plazo
 *   (`fel_contingencia_plazo`, sin valor; NO VERIFICADO 7).
 * - Desactiva: los DTE en contingencia quedan listos para enviarse en la siguiente corrida.
 * - Evento `fel.contingencia_cambiada`.
 */

export interface EntradaContingenciaFel {
    empresa_id?: number | null
    activa: boolean
    motivo: string
}

export default class CambiarContingenciaFel extends DomainAction<EntradaContingenciaFel, ConfiguracionFel> {
    readonly nombre = 'fel.contingencia'

    protected async handle(input: EntradaContingenciaFel, t: Transaccion): Promise<ConfiguracionFel> {
        const motivo = input.motivo?.trim() ?? ''
        if (motivo.length < 3) {
            throw new ValidacionFallida([
                {
                    field: 'motivo',
                    message: 'El motivo es obligatorio (mínimo 3 caracteres)',
                    rule: 'motivo',
                },
            ])
        }
        const { empresaId } = await empresaFiscal(t, input.empresa_id)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(3007, ?)', [empresaId])
        const antes = await configuracionFel(empresaId, t.trx)
        if (antes.modo === 'desactivada' || antes.version === 0) {
            throw new FelNoConfigurada(
                'La FEL de la empresa está desactivada: no hay contingencia que declarar',
            )
        }
        if (antes.contingencia_activa === input.activa) {
            throw new Conflicto(
                input.activa ? 'La contingencia ya está activa' : 'La contingencia no está activa',
                'contingencia_sin_cambio',
                'Contingencia sin cambio',
            )
        }
        await t.trx
            .from('fiscal.fel_configuracion')
            .where('empresa_id', empresaId)
            .update({
                contingencia_activa: input.activa,
                contingencia_motivo: motivo,
                contingencia_desde: input.activa ? t.trx.knexRawQuery('now()') : null,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        t.fijarEntidad('fel_configuracion', empresaId)
        await t.registrarCambios(
            { tipo: 'fel_configuracion', id: empresaId },
            { contingencia_activa: antes.contingencia_activa },
            { contingencia_activa: input.activa },
        )
        await t.emit('fel.contingencia_cambiada', { empresa_id: empresaId, activa: input.activa, motivo })
        return configuracionFel(empresaId, t.trx)
    }
}
