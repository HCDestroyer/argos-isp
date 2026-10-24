import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import { dec, redondear, type Dec } from '#ledger/dinero'
import { hoyGuatemala } from '#ledger/fechas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import {
    bloquearProducto,
    bodegaMovible,
    cantidadValida,
    costoDeSobrante,
    costoSalida,
    exigirSeguimiento,
    productoMovible,
    registrarMovimientoConAsiento,
    saldoDe,
    verMovimiento,
    type MovimientoVista,
} from '#inventario/kardex'
import {
    actualizarUnidad,
    crearUnidades,
    unidadesDeBodega,
    validarUnidadesNuevas,
    type UnidadNueva,
} from '#inventario/unidades'

/**
 * `inventario.ajustar` (`POST /inventario/ajustes`): ajuste manual con motivo obligatorio, como un
 * conteo (§5).
 *
 * - **Faltante**: por cantidad, `cantidad` negativa al costo promedio; por serie, `unidad_id` (la
 *   unidad sale a su costo y queda `dada_de_baja`). `5.6.02 Mermas y faltantes / 1.1.14`. Más que la
 *   existencia: 409 `existencia_insuficiente`.
 * - **Sobrante**: por cantidad, `cantidad` positiva; por serie, `unidad` (serie o MAC nueva). Con
 *   existencia en la bodega entra a su promedio (el `costo_unitario` pedido se ignora, H41); sin
 *   existencia, al `costo_unitario` pedido (> 0) o al del último movimiento del producto. `1.1.14 /
 *   4.2.04 Sobrantes`. Sin costo, o con costo ≤ 0: 422 `costo_requerido`.
 *
 * Fecha de hoy; respeta los bloqueos de siempre.
 */

export interface EntradaAjuste {
    producto_id: number
    bodega_id: number
    cantidad?: string | null
    unidad_id?: number | null
    unidad?: UnidadNueva | null
    motivo: string
    costo_unitario?: string | null
}

export default class AjustarInventario extends DomainAction<EntradaAjuste, MovimientoVista> {
    readonly nombre = 'inventario.ajustar'

    protected async handle(input: EntradaAjuste, t: Transaccion): Promise<MovimientoVista> {
        const motivo = input.motivo?.trim() ?? ''
        if (motivo.length < 3) {
            throw new ValidacionFallida([
                { field: 'motivo', message: 'El ajuste lleva su motivo', rule: 'required' },
            ])
        }
        const porUnidad = Boolean(input.unidad_id || input.unidad)
        if (input.unidad_id && input.unidad) {
            throw new ValidacionFallida([
                {
                    field: 'unidad',
                    message: 'Un faltante lleva unidad_id; un sobrante, unidad',
                    rule: 'no_aplica',
                },
            ])
        }
        const cantidad = porUnidad
            ? dec(input.unidad ? '1' : '-1')
            : cantidadValida(input.cantidad ?? '', 'cantidad', true)
        const entra = cantidad.gt(0)
        const producto = await productoMovible(t, input.producto_id, { entrada: entra })
        const empresaId = producto.empresa_id
        t.fijarEmpresa(empresaId)
        exigirSeguimiento(producto, porUnidad, input.unidad ? 'unidad' : 'unidad_id')
        const bodega = await bodegaMovible(t, input.bodega_id, empresaId, { entrada: entra })
        await bloquearProducto(t, producto.id)

        let costo: Dec
        let unidadId: number | null = null
        if (entra) {
            const unitario = await costoDeSobrante(t, producto, bodega.id, input.costo_unitario)
            costo = redondear(cantidad.times(unitario))
            if (input.unidad) {
                const [nueva] = await validarUnidadesNuevas(t, empresaId, [input.unidad], 'unidad')
                const [unidad] = await crearUnidades(t, {
                    empresaId,
                    productoId: producto.id,
                    bodegaId: bodega.id,
                    unidades: [nueva!],
                    costos: [costo],
                    condicion: 'usado',
                })
                unidadId = unidad!.id
            }
        } else if (input.unidad_id) {
            const [unidad] = await unidadesDeBodega(t, [input.unidad_id], {
                empresaId,
                productoId: producto.id,
                bodegaId: bodega.id,
                campo: 'unidad_id',
            })
            costo = dec(unidad!.costo).neg()
            unidadId = unidad!.id
            await actualizarUnidad(t, unidad!.id, { estado: 'dada_de_baja', bodega_id: null })
        } else {
            costo = costoSalida(
                await saldoDe(t, producto.id, bodega.id),
                cantidad.abs(),
                producto,
                bodega.id,
            ).neg()
        }
        const id = await registrarMovimientoConAsiento(
            t,
            {
                empresaId,
                tipo: 'ajuste',
                fecha: hoyGuatemala(),
                producto,
                bodegaId: bodega.id,
                cantidad,
                costoTotal: costo,
                unidadId,
                motivo,
            },
            {
                contrapartida: entra ? CUENTAS_GT.SOBRANTES_INVENTARIO : CUENTAS_GT.MERMAS_INVENTARIO,
                descripcion: `Ajuste de inventario (${entra ? 'sobrante' : 'faltante'}) de ${producto.sku} en ${bodega.nombre}: ${motivo}`,
            },
        )
        t.fijarEntidad('movimiento_inventario', id)
        return verMovimiento(id, t.trx)
    }
}
