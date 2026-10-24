import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import { usuarioDelActor } from '#shared/contexto'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { hoyGuatemala } from '#ledger/fechas'
import { bodegaMovible } from '#inventario/kardex'
import { verConteo, type ConteoVista } from '#inventario/conteos'

/**
 * `inventario.abrir_conteo` (`POST /inventario/conteos`): abre el conteo físico de una bodega (§5).
 * Uno abierto por bodega: el segundo, 409 `conteo_abierto`. La bodega es de la empresa y está activa.
 * Mientras está abierto, la bodega sigue operando: lo esperado se toma al cerrar.
 */

export interface EntradaAbrirConteo {
    bodega_id: number
    motivo?: string | null
}

export default class AbrirConteo extends DomainAction<EntradaAbrirConteo, ConteoVista> {
    readonly nombre = 'inventario.abrir_conteo'

    protected async handle(input: EntradaAbrirConteo, t: Transaccion): Promise<ConteoVista> {
        const empresa = (await t.trx
            .from('inventario.bodegas')
            .where('id', input.bodega_id)
            .select('empresa_id')
            .first()) as { empresa_id: number } | null
        const bodega = await bodegaMovible(t, input.bodega_id, Number(empresa?.empresa_id ?? 0), {
            entrada: true,
        })
        exigirAccesoEmpresa(t.ctx, bodega.empresa_id)
        t.fijarEmpresa(bodega.empresa_id)
        // serializa las aperturas de la bodega (el índice único es la última defensa)
        await t.trx.from('inventario.bodegas').where('id', bodega.id).forUpdate().select('id')
        const abierto = await t.trx
            .from('inventario.conteos')
            .where({ bodega_id: bodega.id, estado: 'abierto' })
            .select('id')
            .first()
        if (abierto) {
            throw new Conflicto(
                `La bodega ${bodega.nombre} ya tiene abierto el conteo ${abierto.id}`,
                'conteo_abierto',
                'Conteo abierto',
            )
        }
        const [fila] = (await t.trx
            .insertQuery()
            .table('inventario.conteos')
            .insert({
                empresa_id: bodega.empresa_id,
                bodega_id: bodega.id,
                fecha_corte: hoyGuatemala(),
                motivo: input.motivo?.trim() || null,
                abierto_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('conteo_inventario', id)
        return verConteo(id, t.trx)
    }
}
