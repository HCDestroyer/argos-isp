import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ConflictoVersion, NoEncontrado, Prohibido } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { verTipoProducto, type TipoProductoVista } from '#inventario/tipos_producto'

/**
 * `tipos_producto.desactivar` (`POST /inventario/tipos-producto/:id/desactivar`, fase D, D.2), con
 * `version`. Los productos que ya lo usan siguen igual; un producto nuevo no lo acepta (422
 * `tipo_inactivo`). Uno ya desactivado: 409 `tipo_inactivo`. Un tipo global solo con alcance global.
 */

export interface EntradaDesactivarTipoProducto {
    id: number
    version: number
    motivo?: string | null
    alcance_global?: boolean
}

export default class DesactivarTipoProducto extends DomainAction<
    EntradaDesactivarTipoProducto,
    TipoProductoVista
> {
    readonly nombre = 'tipos_producto.desactivar'

    protected async handle(input: EntradaDesactivarTipoProducto, t: Transaccion): Promise<TipoProductoVista> {
        t.fijarEntidad('tipo_producto', input.id)
        const fila = await t.trx.from('inventario.tipos_producto').where('id', input.id).forUpdate().first()
        if (!fila) throw new NoEncontrado(`El tipo de producto ${input.id} no existe`)
        const antes = await verTipoProducto(input.id, t.trx)
        if (antes.empresa_id === null) {
            if (input.alcance_global === false) {
                throw new Prohibido(
                    'Un tipo de producto global lo desactiva un usuario con alcance global de empresas',
                )
            }
        } else {
            exigirAccesoEmpresa(t.ctx, antes.empresa_id)
            t.fijarEmpresa(antes.empresa_id)
        }
        if (antes.version !== input.version) throw new ConflictoVersion('tipo_producto', input.id)
        if (!antes.activo) {
            throw new Conflicto(
                `El tipo ${antes.codigo} ya está desactivado`,
                'tipo_inactivo',
                'Tipo desactivado',
            )
        }
        await t.trx
            .from('inventario.tipos_producto')
            .where('id', input.id)
            .update({
                activo: false,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            })
        await t.registrarCambios({ tipo: 'tipo_producto', id: input.id }, { activo: true }, { activo: false })
        return verTipoProducto(input.id, t.trx)
    }
}
