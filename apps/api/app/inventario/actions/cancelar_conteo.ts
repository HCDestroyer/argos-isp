import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import { usuarioDelActor } from '#shared/contexto'
import { verConteo, type ConteoVista } from '#inventario/conteos'
import { conteoAbierto } from '#inventario/actions/contar_inventario'

/**
 * `inventario.cancelar_conteo` (`POST /inventario/conteos/:id/cancelar`): cancela un conteo abierto
 * sin ajustar nada, con motivo. Cerrado o cancelado: 409 `conteo_no_abierto`.
 */

export interface EntradaCancelarConteo {
    id: number
    motivo: string
}

export default class CancelarConteo extends DomainAction<EntradaCancelarConteo, ConteoVista> {
    readonly nombre = 'inventario.cancelar_conteo'

    protected async handle(input: EntradaCancelarConteo, t: Transaccion): Promise<ConteoVista> {
        const motivo = input.motivo?.trim() ?? ''
        if (motivo.length < 3) {
            throw new ValidacionFallida([
                { field: 'motivo', message: 'La cancelación lleva su motivo', rule: 'required' },
            ])
        }
        const conteo = await conteoAbierto(t, input.id)
        const actual = (await t.trx
            .from('inventario.conteos')
            .where('id', conteo.id)
            .select('motivo')
            .first()) as {
            motivo: string | null
        }
        await t.trx
            .from('inventario.conteos')
            .where('id', conteo.id)
            .update({
                estado: 'cancelado',
                motivo: actual.motivo ? `${actual.motivo} · cancelado: ${motivo}` : `cancelado: ${motivo}`,
                cerrado_por: usuarioDelActor(t.ctx.actor),
                cerrado_en: t.trx.knexRawQuery('now()'),
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        return verConteo(conteo.id, t.trx)
    }
}
