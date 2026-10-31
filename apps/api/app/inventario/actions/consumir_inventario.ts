import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import { verMovimiento, type MovimientoVista } from '#inventario/kardex'
import { origenExternoDe, type OrigenExternoTipo } from '#inventario/origen_externo'
import { aplicarConsumos, type CargoConsumo, type LineaConsumo } from '#inventario/consumos'
import type { TecnicoExterno } from '#inventario/tecnicos'

/**
 * `inventario.consumir` (`POST /inventario/consumos`): materiales usados en una instalación o una
 * reparación. Una línea (`producto_id` arriba) o varias (`lineas[]`, lo que manda Iris al cerrar una
 * orden; contrato Iris 0.5.0 §3.3), todo o nada. Desde la fase D aplica la **modalidad del producto**
 * (`contratos/inventario.md` D.3, `#inventario/consumos`):
 *
 * - `consumible_gasto` (lo de siempre): sale de la bodega al costo promedio; asiento `cuenta_consumo`
 *   del producto (por defecto `5.2.07`) / `1.1.14`. Más que la existencia: 409
 *   `existencia_insuficiente` sin escribir nada. `fecha` (fase C; por defecto hoy): una pasada solo
 *   dentro de un periodo abierto (422 `periodo_cerrado`) y si después de ella no hay movimientos que
 *   cambiaran el promedio (H55: 409 `fecha_con_movimientos_posteriores`); nunca deja existencia ni valor
 *   negativos en ninguna fecha (409 `existencia_insuficiente_en_fecha`).
 * - `consumible_cobro` (con `servicio_id`; si no, 422 `cobro_sin_cliente`): un cargo único inmediato al
 *   cliente del servicio por todas las líneas cobradas, con la venta del kardex (`5.6.01 / 1.1.14`), la
 *   orden de Iris y `cargos[]` en la respuesta.
 * - `comodato`: 422 `producto_es_comodato` (los equipos van por `POST /servicios/:id/equipos`).
 *
 * Responde el movimiento de la primera línea (lo de siempre) más `movimientos[]`, `cargos[]` y
 * `factura_id`. `tecnico` sin `bodega_id`: la bodega del técnico en la empresa de la operación.
 */

export interface EntradaConsumo extends LineaConsumo {
    producto_id?: number | null
    /** varias líneas (en lugar de `producto_id` arriba) */
    lineas?: LineaConsumo[] | null
    bodega_id?: number | null
    servicio_id?: number | null
    motivo?: string | null
    fecha?: string | null
    /** técnico de Argos de la orden de Iris (su bodega es la de salida si no hay bodega_id) */
    tecnico?: TecnicoExterno | null
    /** orden de Iris (`iris_orden`) que lo originó; con origen_tipo, origen_id es obligatorio */
    origen_tipo?: OrigenExternoTipo | null
    origen_id?: string | null
}

export type MovimientoConsumo = MovimientoVista & {
    /** la factura del cargo único (consumible_cobro); null si no hubo cobro */
    factura_id: number | null
    /** un movimiento por línea, en el orden de las líneas */
    movimientos: MovimientoVista[]
    cargos: CargoConsumo[]
}

export default class ConsumirInventario extends DomainAction<EntradaConsumo, MovimientoConsumo> {
    readonly nombre = 'inventario.consumir'

    protected async handle(input: EntradaConsumo, t: Transaccion): Promise<MovimientoConsumo> {
        const origenExterno = origenExternoDe(input)
        const conLineas = input.lineas !== undefined && input.lineas !== null
        if (conLineas === Boolean(input.producto_id)) {
            throw new ValidacionFallida([
                {
                    field: conLineas ? 'producto_id' : 'lineas',
                    message: 'Indica producto_id (una línea) o lineas[] (varias), no las dos',
                    rule: 'producto_o_lineas',
                },
            ])
        }
        const lineas: LineaConsumo[] = conLineas
            ? input.lineas!
            : [
                  {
                      producto_id: input.producto_id,
                      cantidad: input.cantidad,
                      unidad_id: input.unidad_id,
                      serie: input.serie,
                      precio_unitario: input.precio_unitario,
                      concepto_id: input.concepto_id,
                  },
              ]
        const resultado = await aplicarConsumos(t, input, lineas, origenExterno, (i, campo) =>
            conLineas ? `lineas.${i}.${campo}` : campo,
        )
        const movimientos: MovimientoVista[] = []
        for (const id of resultado.movimientos) movimientos.push(await verMovimiento(id, t.trx))
        t.fijarEntidad('movimiento_inventario', movimientos[0]!.id)
        return { ...movimientos[0]!, factura_id: resultado.facturaId, movimientos, cargos: resultado.cargos }
    }
}
