import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { ConflictoVersion, NoEncontrado } from '#shared/errores'
import { listarCajas, type CajaVista, type FormatoImpresion } from '#ledger/cajas'

/**
 * `cajas.configurar_impresion` (`PUT /cajas/:id/impresion`, decisión del PM 20): cada caja recuerda
 * en qué formato imprime el recibo (`pos_80` de fábrica, ticket de 80 mm) y la factura (`carta` de
 * fábrica). Con `version` (409). Solo cambia lo que viene; diff en `audit.cambios` y evento
 * `caja.impresion_cambiada` con los nombres de los campos (sin cambios no emite).
 */

export interface EntradaImpresionCaja {
    caja_id: number
    version: number
    formato_recibo?: FormatoImpresion
    formato_factura?: FormatoImpresion
}

export default class ConfigurarImpresionCaja extends DomainAction<EntradaImpresionCaja, CajaVista> {
    readonly nombre = 'cajas.configurar_impresion'

    protected async handle(input: EntradaImpresionCaja, t: Transaccion): Promise<CajaVista> {
        t.fijarEntidad('caja', input.caja_id)
        const caja = (await t.trx
            .from('ledger.cajas')
            .where('id', input.caja_id)
            .forUpdate()
            .select('empresa_id', 'formato_recibo', 'formato_factura', 'version')
            .first()) as {
            empresa_id: number
            formato_recibo: FormatoImpresion
            formato_factura: FormatoImpresion
            version: number
        } | null
        if (!caja) throw new NoEncontrado(`La caja ${input.caja_id} no existe`)
        const empresaId = Number(caja.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        if (Number(caja.version) !== input.version) throw new ConflictoVersion('caja', input.caja_id)

        const antes = { formato_recibo: caja.formato_recibo, formato_factura: caja.formato_factura }
        const despues = {
            formato_recibo: input.formato_recibo ?? caja.formato_recibo,
            formato_factura: input.formato_factura ?? caja.formato_factura,
        }
        const campos = (['formato_recibo', 'formato_factura'] as const).filter((c) => antes[c] !== despues[c])
        if (campos.length > 0) {
            await t.trx
                .from('ledger.cajas')
                .where('id', input.caja_id)
                .update({
                    ...despues,
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                } as Record<string, unknown>)
            await t.registrarCambios({ tipo: 'caja', id: input.caja_id }, antes, despues)
            await t.emit('caja.impresion_cambiada', {
                caja_id: input.caja_id,
                empresa_id: empresaId,
                campos: [...campos],
                formato_recibo: despues.formato_recibo,
                formato_factura: despues.formato_factura,
            })
        }
        const cajas = await listarCajas(undefined, [empresaId], t.trx)
        return cajas.find((c) => Number(c.id) === input.caja_id)!
    }
}
