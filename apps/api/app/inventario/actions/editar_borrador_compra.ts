import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { Conflicto, ConflictoVersion, NoEncontrado } from '#shared/errores'
import type { ExtraccionCompra } from '#inventario/facturas_compra/extraccion'
import {
    exigirFacturaNueva,
    nitLimpio,
    proponer,
    verBorrador,
    type BorradorVista,
} from '#inventario/facturas_compra/borradores'

/**
 * `compras.editar_borrador` (`POST /compras/borradores/:id/editar`, fase D, D.5): el usuario corrige los
 * datos (mismo esquema que la extracción, validado por la ruta), con `version`. Recalcula la propuesta;
 * la extracción original no cambia. Solo un borrador `borrador` (409 `borrador_cerrado`). La misma
 * factura en otra compra o borrador: 409.
 */

export interface EntradaEditarBorrador {
    id: number
    version: number
    datos: ExtraccionCompra
}

export default class EditarBorradorCompra extends DomainAction<EntradaEditarBorrador, BorradorVista> {
    readonly nombre = 'compras.editar_borrador'

    protected async handle(input: EntradaEditarBorrador, t: Transaccion): Promise<BorradorVista> {
        t.fijarEntidad('borrador_compra', input.id)
        const fila = await t.trx
            .from('inventario.compras_borradores')
            .where('id', input.id)
            .forUpdate()
            .first()
        if (!fila) throw new NoEncontrado(`El borrador de compra ${input.id} no existe`)
        const empresaId = Number(fila.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        if (Number(fila.version) !== input.version) throw new ConflictoVersion('borrador_compra', input.id)
        if (fila.estado !== 'borrador') {
            throw new Conflicto(
                `El borrador ${input.id} está ${fila.estado}`,
                'borrador_cerrado',
                'Borrador cerrado',
            )
        }
        const datos = {
            ...input.datos,
            emisor: { ...input.datos.emisor, nit: nitLimpio(input.datos.emisor.nit) },
        }
        await exigirFacturaNueva(
            t.trx,
            empresaId,
            { nit: datos.emisor.nit, serie: datos.serie, numero: datos.numero },
            input.id,
        )
        const propuesta = await proponer(t.trx, empresaId, datos)
        await t.trx
            .from('inventario.compras_borradores')
            .where('id', input.id)
            .update({
                datos: JSON.stringify(datos),
                propuesta: JSON.stringify(propuesta),
                emisor_nit: datos.emisor.nit,
                serie: datos.serie,
                numero: datos.numero,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            })
        await t.registrarCambios(
            { tipo: 'borrador_compra', id: input.id },
            {
                emisor_nit: fila.emisor_nit,
                serie: fila.serie,
                numero: fila.numero,
                lineas: (fila.datos?.lineas ?? []).length,
            },
            {
                emisor_nit: datos.emisor.nit,
                serie: datos.serie,
                numero: datos.numero,
                lineas: datos.lineas.length,
            },
        )
        return verBorrador(input.id, t.trx)
    }
}
