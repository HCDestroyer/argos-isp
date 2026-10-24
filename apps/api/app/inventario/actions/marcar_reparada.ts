import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { bloquearProducto } from '#inventario/kardex'
import {
    actualizarUnidad,
    productoDeUnidad,
    unidadesDeBodega,
    verUnidad,
    type UnidadVista,
} from '#inventario/unidades'

/**
 * `inventario.marcar_reparada` (`POST /inventario/unidades/:id/marcar-reparada`, decisión del líder,
 * fase C): una unidad `en_reparacion` vuelve a `disponible` en su misma bodega, con motivo. No cambia su
 * valor ni su existencia (la unidad en reparación ya contaba en la bodega): sin movimiento ni asiento;
 * queda en `audit.cambios`. Desde `en_reparacion` también se puede dar de baja (`POST /inventario/bajas`).
 * Otro estado: 409 `unidad_no_disponible` (o `unidad_en_comodato`).
 */

export interface EntradaMarcarReparada {
    unidad_id: number
    motivo: string
}

export default class MarcarReparada extends DomainAction<EntradaMarcarReparada, UnidadVista> {
    readonly nombre = 'inventario.marcar_reparada'

    protected async handle(input: EntradaMarcarReparada, t: Transaccion): Promise<UnidadVista> {
        const motivo = input.motivo?.trim() ?? ''
        if (motivo.length < 3) {
            throw new ValidacionFallida([
                { field: 'motivo', message: 'La reparación lleva su motivo', rule: 'required' },
            ])
        }
        t.fijarEntidad('unidad_inventario', input.unidad_id)
        const productoId = await productoDeUnidad(t, input.unidad_id)
        const empresa = (await t.trx
            .from('inventario.unidades')
            .where('id', input.unidad_id)
            .select('empresa_id')
            .first()) as { empresa_id: number }
        const empresaId = Number(empresa.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        await bloquearProducto(t, productoId)
        const [unidad] = await unidadesDeBodega(t, [input.unidad_id], {
            empresaId,
            productoId,
            estados: ['en_reparacion'],
            campo: 'unidad_id',
        })
        await actualizarUnidad(t, unidad!.id, { estado: 'disponible' })
        await t.registrarCambios(
            { tipo: 'unidad_inventario', id: unidad!.id },
            { estado: 'en_reparacion' },
            { estado: 'disponible', motivo },
        )
        return verUnidad(unidad!.id, t.trx)
    }
}
