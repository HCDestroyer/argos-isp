import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ConflictoVersion, NoEncontrado, Prohibido, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import type { Seguimiento } from '#inventario/productos'
import {
    problemaModalidad,
    verTipoProducto,
    type Modalidad,
    type TipoProductoVista,
} from '#inventario/tipos_producto'

/**
 * `tipos_producto.editar` (`POST /inventario/tipos-producto/:id/editar`, fase D, D.2): nombre,
 * seguimiento y modalidad por defecto, con `version` y `audit.cambios`. El código no cambia. Solo
 * afecta a los productos que se creen después. Un tipo global solo con alcance global de empresas.
 */

export interface EntradaEditarTipoProducto {
    id: number
    version: number
    nombre?: string | null
    seguimiento_defecto?: Seguimiento | null
    modalidad_defecto?: Modalidad | null
    alcance_global?: boolean
}

export default class EditarTipoProducto extends DomainAction<EntradaEditarTipoProducto, TipoProductoVista> {
    readonly nombre = 'tipos_producto.editar'

    protected async handle(input: EntradaEditarTipoProducto, t: Transaccion): Promise<TipoProductoVista> {
        t.fijarEntidad('tipo_producto', input.id)
        const fila = await t.trx.from('inventario.tipos_producto').where('id', input.id).forUpdate().first()
        if (!fila) throw new NoEncontrado(`El tipo de producto ${input.id} no existe`)
        const antes = await verTipoProducto(input.id, t.trx)
        if (antes.empresa_id === null) {
            if (input.alcance_global === false) {
                throw new Prohibido(
                    'Un tipo de producto global lo edita un usuario con alcance global de empresas',
                )
            }
        } else {
            exigirAccesoEmpresa(t.ctx, antes.empresa_id)
            t.fijarEmpresa(antes.empresa_id)
        }
        if (antes.version !== input.version) throw new ConflictoVersion('tipo_producto', input.id)
        const nuevo = {
            nombre: input.nombre?.trim() || antes.nombre,
            seguimiento_defecto: input.seguimiento_defecto ?? antes.seguimiento_defecto,
            modalidad_defecto: input.modalidad_defecto ?? antes.modalidad_defecto,
        }
        const problema = problemaModalidad(
            nuevo.modalidad_defecto,
            nuevo.seguimiento_defecto,
            'modalidad_defecto',
        )
        if (problema) throw new ValidacionFallida([problema])
        await t.trx
            .from('inventario.tipos_producto')
            .where('id', input.id)
            .update({
                ...nuevo,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            })
        const tipo = await verTipoProducto(input.id, t.trx)
        await t.registrarCambios(
            { tipo: 'tipo_producto', id: input.id },
            {
                nombre: antes.nombre,
                seguimiento_defecto: antes.seguimiento_defecto,
                modalidad_defecto: antes.modalidad_defecto,
            },
            nuevo,
        )
        return tipo
    }
}
