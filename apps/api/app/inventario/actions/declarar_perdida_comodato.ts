import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import DarDeBajaActivo from '#ledger/actions/dar_de_baja_activo'
import { bloquearProducto } from '#inventario/kardex'
import { actualizarUnidad, productoDeUnidad, unidadesDeBodega, type UnidadVista } from '#inventario/unidades'
import {
    empresaDeLaUnidad,
    exigirEnComodatoDe,
    fechaDeComodato,
    servicioDe,
    unidadVista,
} from '#inventario/comodato'

/**
 * `inventario.declarar_perdida_comodato` (`POST /servicios/:id/equipos/:unidad_id/perdida`): el
 * cliente no devuelve el equipo (§5). Sin kardex (la unidad ya no está en inventario): el activo se
 * da de baja a pérdida con `activos.dar_de_baja` tipo `retiro` (deprecia lo pendiente y asienta
 * `1.2.02 + 5.3.06 Pérdida en baja de activos / 1.2.01`). La unidad queda `dada_de_baja` (con su
 * servicio, para la historia). Cobrarlo al cliente es aparte: un cargo único «equipo no devuelto».
 */

export interface EntradaPerdidaComodato {
    servicio_id: number
    unidad_id: number
    motivo: string
    fecha?: string | null
}

export default class DeclararPerdidaComodato extends DomainAction<EntradaPerdidaComodato, UnidadVista> {
    readonly nombre = 'inventario.declarar_perdida_comodato'

    protected async handle(input: EntradaPerdidaComodato, t: Transaccion): Promise<UnidadVista> {
        const motivo = input.motivo?.trim() ?? ''
        if (motivo.length < 3) {
            throw new ValidacionFallida([
                { field: 'motivo', message: 'El motivo es obligatorio', rule: 'required' },
            ])
        }
        t.fijarEntidad('unidad', input.unidad_id)
        const empresaId = await empresaDeLaUnidad(t, input.unidad_id)
        t.fijarEmpresa(empresaId)
        const servicio = await servicioDe(t, input.servicio_id, empresaId)
        // locks en el orden de todo el inventario: producto primero, después la fila de la unidad
        const previa = await productoDeUnidad(t, input.unidad_id)
        await bloquearProducto(t, previa)
        const [unidad] = await unidadesDeBodega(t, [input.unidad_id], {
            empresaId,
            estados: ['en_comodato', 'por_recuperar'],
            campo: 'unidad_id',
        })
        exigirEnComodatoDe(unidad!, servicio.id)
        const fecha = await fechaDeComodato(t, unidad!.id, input.fecha)
        await new DarDeBajaActivo().execute(
            {
                activo_id: unidad!.activo_id!,
                tipo: 'retiro',
                fecha,
                motivo: `equipo en comodato no devuelto (servicio ${servicio.id}): ${motivo}`,
                desde_comodato: true,
            },
            t.ctx,
            { trx: t.trx },
        )
        await actualizarUnidad(t, unidad!.id, { estado: 'dada_de_baja', activo_id: null })
        await t.registrarCambios(
            { tipo: 'unidad', id: unidad!.id },
            { estado: unidad!.estado, activo_id: unidad!.activo_id },
            { estado: 'dada_de_baja', activo_id: null },
        )
        return unidadVista(unidad!.id, t)
    }
}
