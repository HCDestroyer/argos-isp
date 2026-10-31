import { DomainAction, type Transaccion } from '#shared/domain_action'
import { verMovimiento, type MovimientoVista } from '#inventario/kardex'
import { origenExternoDe } from '#inventario/origen_externo'
import { aplicarConsumos, type DatosConsumo, type LineaConsumo } from '#inventario/consumos'
import type { UnidadVista } from '#inventario/unidades'

/**
 * `inventario.consumir` en lote (`POST /inventario/consumos/lote`, fase D, `contratos/inventario.md` D.3
 * y D.6): todo lo instalado en una orden de un servicio, en una petición y todo o nada. Cada línea aplica
 * la modalidad de su producto (gasto, cobro o comodato, `#inventario/consumos`); los cobros van en un solo
 * cargo único. Errores `lineas.N.*`. Es lo que manda Iris al cerrar una orden (`iris:consumo:<orden_id>`),
 * con `tecnico` para salir de la bodega del técnico.
 */

export interface EntradaConsumoLote extends DatosConsumo {
    lineas: LineaConsumo[]
}

export interface ConsumoLote {
    empresa_id: number
    /** un movimiento por línea, en su orden (consumo, venta o asignación en comodato) */
    movimientos: MovimientoVista[]
    /** la factura del cargo único de los cobros; null si no hubo */
    factura_id: number | null
    /** las unidades prestadas en comodato */
    comodatos: UnidadVista[]
}

export default class ConsumirInventarioLote extends DomainAction<EntradaConsumoLote, ConsumoLote> {
    readonly nombre = 'inventario.consumir'

    protected async handle(input: EntradaConsumoLote, t: Transaccion): Promise<ConsumoLote> {
        const origenExterno = origenExternoDe(input)
        const resultado = await aplicarConsumos(
            t,
            input,
            input.lineas,
            origenExterno,
            (i, campo) => `lineas.${i}.${campo}`,
        )
        if (resultado.movimientos[0]) t.fijarEntidad('movimiento_inventario', resultado.movimientos[0])
        const movimientos: MovimientoVista[] = []
        for (const id of resultado.movimientos) movimientos.push(await verMovimiento(id, t.trx))
        return {
            empresa_id: resultado.empresaId,
            movimientos,
            factura_id: resultado.facturaId,
            comodatos: resultado.comodatos,
        }
    }
}
