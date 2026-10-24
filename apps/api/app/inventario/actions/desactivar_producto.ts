import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ConflictoVersion, NoEncontrado } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { bloquearProducto } from '#inventario/kardex'
import { verProducto, type ProductoVista } from '#inventario/productos'

/**
 * `productos.desactivar` (`POST /productos/:id/desactivar`): el producto deja de recibir entradas y
 * de ofrecerse; no se borra (su kardex queda). Solo sin existencias (409 `producto_con_existencias`)
 * y con `version` (409 si cambió). Desactivar uno ya inactivo: 409 `producto_inactivo`.
 */

export interface EntradaDesactivarProducto {
    id: number
    version: number
    motivo?: string | null
}

export default class DesactivarProducto extends DomainAction<EntradaDesactivarProducto, ProductoVista> {
    readonly nombre = 'productos.desactivar'

    protected async handle(input: EntradaDesactivarProducto, t: Transaccion): Promise<ProductoVista> {
        t.fijarEntidad('producto', input.id)
        const actual = (await t.trx
            .from('inventario.productos')
            .where('id', input.id)
            .forUpdate()
            .select('id', 'empresa_id', 'sku', 'activo', 'version')
            .first()) as {
            id: number
            empresa_id: number
            sku: string
            activo: boolean
            version: number
        } | null
        if (!actual) throw new NoEncontrado(`El producto ${input.id} no existe`)
        exigirAccesoEmpresa(t.ctx, Number(actual.empresa_id))
        t.fijarEmpresa(Number(actual.empresa_id))
        if (Number(actual.version) !== input.version) throw new ConflictoVersion('producto', input.id)
        if (!actual.activo) {
            throw new Conflicto(
                `El producto ${actual.sku} ya está desactivado`,
                'producto_inactivo',
                'Producto inactivo',
            )
        }
        await bloquearProducto(t, input.id)
        const existencia = await t.trx
            .from('inventario.saldos')
            .where('producto_id', input.id)
            .where('cantidad', '>', 0)
            .select('bodega_id')
            .first()
        if (existencia) {
            throw new Conflicto(
                `El producto ${actual.sku} tiene existencias en la bodega ${existencia.bodega_id}: sácalas antes de desactivarlo`,
                'producto_con_existencias',
                'Producto con existencias',
            )
        }
        await t.trx
            .from('inventario.productos')
            .where('id', input.id)
            .update({
                activo: false,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios({ tipo: 'producto', id: input.id }, { activo: true }, { activo: false })
        return verProducto(input.id, t.trx)
    }
}
