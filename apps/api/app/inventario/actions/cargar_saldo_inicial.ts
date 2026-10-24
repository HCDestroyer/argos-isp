import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ValidacionFallida } from '#shared/errores'
import { dec, redondear } from '#ledger/dinero'
import { fechaValida, hoyGuatemala } from '#ledger/fechas'
import { CUENTAS } from '#ledger/plan_cuentas'
import {
    bloquearProducto,
    bodegaMovible,
    cantidadValida,
    productoMovible,
    registrarMovimientoConAsiento,
    verMovimiento,
    type MovimientoVista,
} from '#inventario/kardex'

/**
 * `inventario.cargar_saldo_inicial` (`POST /inventario/saldos-iniciales`): la existencia con la que
 * empieza un producto en una bodega, una sola vez y antes de cualquier otro movimiento de ese
 * producto en esa bodega (409 `saldo_inicial_registrado` / `saldo_inicial_con_movimientos`).
 *
 * Asiento `1.1.14 Inventarios / 2.9.01 Saldos de apertura` por el costo (origen `inventario`). El
 * costo es `costo_total` o `cantidad × costo_unitario` (uno de los dos, mayor que 0). `fecha` (por
 * defecto hoy, no futura) respeta los bloqueos de siempre.
 */

export interface EntradaSaldoInicial {
    producto_id: number
    bodega_id: number
    cantidad: string
    costo_unitario?: string | null
    costo_total?: string | null
    fecha?: string | null
    motivo?: string | null
}

export default class CargarSaldoInicial extends DomainAction<EntradaSaldoInicial, MovimientoVista> {
    readonly nombre = 'inventario.cargar_saldo_inicial'

    protected async handle(input: EntradaSaldoInicial, t: Transaccion): Promise<MovimientoVista> {
        const producto = await productoMovible(t, input.producto_id, { entrada: true })
        const empresaId = producto.empresa_id
        t.fijarEmpresa(empresaId)
        const bodega = await bodegaMovible(t, input.bodega_id, empresaId, { entrada: true })
        const cantidad = cantidadValida(input.cantidad)
        const hoy = hoyGuatemala()
        const fecha = input.fecha ? fechaValida(input.fecha) : hoy
        if (fecha > hoy) {
            throw new ValidacionFallida([
                { field: 'fecha', message: 'La fecha no puede ser futura', rule: 'futuro' },
            ])
        }
        const dado = [input.costo_unitario, input.costo_total].filter((v) => v !== undefined && v !== null)
        if (dado.length !== 1) {
            throw new ValidacionFallida([
                {
                    field: 'costo_total',
                    message: 'Indica costo_total o costo_unitario (uno de los dos)',
                    rule: 'required',
                },
            ])
        }
        const costo = input.costo_total
            ? dec(input.costo_total)
            : redondear(cantidad.times(dec(input.costo_unitario!)))
        if (costo.lte(0)) {
            throw new ValidacionFallida([
                {
                    field: input.costo_total ? 'costo_total' : 'costo_unitario',
                    message: 'El costo es mayor que 0',
                    rule: 'monto',
                },
            ])
        }

        await bloquearProducto(t, producto.id)
        const previo = (await t.trx
            .from('inventario.movimientos')
            .where({ producto_id: producto.id, bodega_id: bodega.id })
            .orderBy('id')
            .select('id', 'tipo')
            .first()) as { id: number; tipo: string } | null
        if (previo) {
            throw previo.tipo === 'saldo_inicial'
                ? new Conflicto(
                      `El producto ${producto.sku} ya tiene su saldo inicial en ${bodega.nombre} (movimiento ${previo.id})`,
                      'saldo_inicial_registrado',
                      'Saldo inicial registrado',
                  )
                : new Conflicto(
                      `El producto ${producto.sku} ya tiene movimientos en ${bodega.nombre}: corrige con un ajuste`,
                      'saldo_inicial_con_movimientos',
                      'Producto con movimientos',
                  )
        }
        const id = await registrarMovimientoConAsiento(
            t,
            {
                empresaId,
                tipo: 'saldo_inicial',
                fecha,
                producto,
                bodegaId: bodega.id,
                cantidad,
                costoTotal: costo,
                motivo: input.motivo ?? null,
            },
            {
                contrapartida: CUENTAS.SALDOS_APERTURA,
                descripcion: `Saldo inicial de ${producto.sku} · ${producto.nombre} en ${bodega.nombre}`,
            },
        )
        t.fijarEntidad('movimiento_inventario', id)
        return verMovimiento(id, t.trx)
    }
}
