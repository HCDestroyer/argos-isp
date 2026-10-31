import { DomainAction, type Transaccion } from '#shared/domain_action'
import { verMovimiento, type MovimientoVista } from '#inventario/kardex'
import { origenExternoDe, type OrigenExternoTipo } from '#inventario/origen_externo'
import { aplicarConsumos } from '#inventario/consumos'
import type { TecnicoExterno } from '#inventario/tecnicos'

/**
 * `inventario.consumir` (`POST /inventario/consumos`): materiales usados en una instalación o una
 * reparación (`servicio_id` opcional, de la misma empresa). Desde la fase D aplica la **modalidad del
 * producto** (`contratos/inventario.md` D.3, `#inventario/consumos`):
 *
 * - `consumible_gasto` (lo de siempre): sale de la bodega al costo promedio; asiento `cuenta_consumo`
 *   del producto (por defecto `5.2.07`) / `1.1.14`. Más que la existencia: 409
 *   `existencia_insuficiente` sin escribir nada. `fecha` (fase C; por defecto hoy): una pasada solo
 *   dentro de un periodo abierto (422 `periodo_cerrado`) y si después de ella no hay movimientos que
 *   cambiaran el promedio (H55: 409 `fecha_con_movimientos_posteriores`); nunca deja existencia ni valor
 *   negativos en ninguna fecha (409 `existencia_insuficiente_en_fecha`).
 * - `consumible_cobro` (con `servicio_id`): cargo único inmediato al cliente del servicio, con la venta
 *   del kardex (`5.6.01 / 1.1.14`) y la factura; responde la venta con su `factura_id`.
 * - `comodato` (serie, con `servicio_id` y `unidad_id` o `serie`): `inventario.asignar_comodato`.
 *
 * - `origen_tipo` = `iris_orden` + `origen_id` (orden de Iris): se guardan en el movimiento
 *   (`origen_externo_*`) y en la factura; con `tecnico` y sin `bodega_id`, sale de la bodega del técnico.
 */

export interface EntradaConsumo {
    producto_id: number
    bodega_id?: number | null
    cantidad?: string | null
    /** fase D: equipo por serie (comodato o venta) */
    unidad_id?: number | null
    serie?: string | null
    /** fase D: precio del cobro (por defecto `precio_venta` del producto) */
    precio_unitario?: string | null
    /** fase D: concepto del cobro (por defecto `concepto_cargo_id` del producto) */
    concepto_id?: number | null
    servicio_id?: number | null
    motivo?: string | null
    fecha?: string | null
    /** fase D: técnico de Argos de la orden de Iris (su bodega es la de salida si no hay bodega_id) */
    tecnico?: TecnicoExterno | null
    /** orden de Iris (`iris_orden`) que lo originó; con origen_tipo, origen_id es obligatorio */
    origen_tipo?: OrigenExternoTipo | null
    origen_id?: string | null
}

export type MovimientoConsumo = MovimientoVista & {
    /** la factura del cargo (modalidad consumible_cobro); null en las demás */
    factura_id: number | null
}

export default class ConsumirInventario extends DomainAction<EntradaConsumo, MovimientoConsumo> {
    readonly nombre = 'inventario.consumir'

    protected async handle(input: EntradaConsumo, t: Transaccion): Promise<MovimientoConsumo> {
        const origenExterno = origenExternoDe(input)
        const resultado = await aplicarConsumos(
            t,
            input,
            [
                {
                    producto_id: input.producto_id,
                    cantidad: input.cantidad,
                    unidad_id: input.unidad_id,
                    serie: input.serie,
                    precio_unitario: input.precio_unitario,
                    concepto_id: input.concepto_id,
                },
            ],
            origenExterno,
            (_i, campo) => campo,
        )
        const id = resultado.movimientos[0]!
        t.fijarEntidad('movimiento_inventario', id)
        return { ...(await verMovimiento(id, t.trx)), factura_id: resultado.facturaId }
    }
}
