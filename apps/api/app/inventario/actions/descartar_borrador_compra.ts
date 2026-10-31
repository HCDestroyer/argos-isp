import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { Conflicto, ConflictoVersion, NoEncontrado } from '#shared/errores'
import { verBorrador, type BorradorVista } from '#inventario/facturas_compra/borradores'

/**
 * `compras.descartar_borrador` (`POST /compras/borradores/:id/descartar`, fase D, D.5): con motivo y
 * `version`; solo un `borrador`. El archivo queda en el almacén (la fila guarda su huella) y se puede
 * volver a cargar.
 */

export interface EntradaDescartarBorrador {
    id: number
    version: number
    motivo: string
}

export default class DescartarBorradorCompra extends DomainAction<EntradaDescartarBorrador, BorradorVista> {
    readonly nombre = 'compras.descartar_borrador'

    protected async handle(input: EntradaDescartarBorrador, t: Transaccion): Promise<BorradorVista> {
        t.fijarEntidad('borrador_compra', input.id)
        const fila = await t.trx
            .from('inventario.compras_borradores')
            .where('id', input.id)
            .forUpdate()
            .first()
        if (!fila) throw new NoEncontrado(`El borrador de compra ${input.id} no existe`)
        exigirAccesoEmpresa(t.ctx, Number(fila.empresa_id))
        t.fijarEmpresa(Number(fila.empresa_id))
        if (Number(fila.version) !== input.version) throw new ConflictoVersion('borrador_compra', input.id)
        if (fila.estado !== 'borrador') {
            throw new Conflicto(
                `El borrador ${input.id} está ${fila.estado}`,
                'borrador_cerrado',
                'Borrador cerrado',
            )
        }
        await t.trx
            .from('inventario.compras_borradores')
            .where('id', input.id)
            .update({
                estado: 'descartado',
                motivo_descarte: input.motivo.trim(),
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            })
        await t.registrarCambios(
            { tipo: 'borrador_compra', id: input.id },
            { estado: 'borrador', motivo_descarte: null },
            { estado: 'descartado', motivo_descarte: input.motivo.trim() },
        )
        return verBorrador(input.id, t.trx)
    }
}
