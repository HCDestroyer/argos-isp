import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import { Conflicto, NoEncontrado, ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa, filtrarPorEmpresa } from '#shared/empresa_activa'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import { D, aTexto, dec, redondear, type Dec } from '#ledger/dinero'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { fechaValida, hoyGuatemala, inicioDeMes } from '#ledger/fechas'
import { periodoCerrado } from '#ledger/cierres'
import RegistrarAsiento, { type LineaAsiento } from '#ledger/actions/registrar_asiento'
import { filtrarBodegasVisibles, type AccesoBodegas } from '#inventario/bodegas'
import { columnasOrigenExterno, type OrigenExterno, type OrigenExternoTipo } from '#inventario/origen_externo'

/**
 * Kardex (`contratos/inventario.md` §2 y §5): la única puerta de entrada a
 * `inventario.movimientos` (solo inserción) y sus lecturas.
 *
 * - **Costo.** Promedio ponderado móvil **por producto y bodega** (desvío A.1 del contrato): el saldo
 *   de cada bodega es `cantidad` y `valor`; una salida vale `cantidad × valor / existencia`,
 *   redondeado a centavos, y la que vacía la bodega lleva todo el valor que queda. Una entrada suma
 *   su costo. Un reverso usa el costo del movimiento que corrige.
 * - **Saldos.** `inventario.saldos` es la proyección que mantiene el trigger de `movimientos`; aquí
 *   solo se lee, con el lock del producto (`LOCK_PRODUCTO`), para calcular el costo. Salida mayor
 *   que la existencia: 409 `existencia_insuficiente` antes de escribir nada.
 * - **Asiento.** Los movimientos propios (consumo, ajuste, baja, saldo inicial) llevan su asiento con
 *   origen `inventario` y `origen_id` = el movimiento (el id se pide antes de insertar). Los de una
 *   compra llevan el asiento de la compra. Sin costo (Q0.00) no hay asiento.
 * - **Eventos.** `inventario.movimiento_registrado` por movimiento e `inventario.existencia_minima`
 *   cuando la existencia total del producto cruza su mínimo hacia abajo.
 */

export const LOCK_PRODUCTO = 3060

export const TIPOS_MOVIMIENTO = [
    'entrada_compra',
    'reverso_compra',
    'devolucion_proveedor',
    'venta',
    'reverso_venta',
    'consumo',
    'traslado',
    'asignacion_comodato',
    'devolucion_comodato',
    'ajuste_conteo',
    'ajuste',
    'baja',
    'saldo_inicial',
    'premio',
    'reverso_premio',
] as const
export type TipoMovimiento = (typeof TIPOS_MOVIMIENTO)[number]

export const CAUSAS_BAJA = ['danado', 'robado', 'obsoleto', 'otro'] as const
export type CausaBaja = (typeof CAUSAS_BAJA)[number]

/** Cantidad con hasta 3 decimales (texto exacto de `numeric(14,3)`). */
export function aCantidad(valor: Dec): string {
    return valor.toFixed(3)
}

/** Lock del producto: serializa los movimientos de un producto (costo y existencia). */
export async function bloquearProducto(t: Transaccion, productoId: number): Promise<void> {
    await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_PRODUCTO, productoId])
}

export interface Saldo {
    cantidad: Dec
    valor: Dec
}

/** Saldo de un producto en una bodega (llamar con el lock del producto). */
export async function saldoDe(t: Transaccion, productoId: number, bodegaId: number): Promise<Saldo> {
    const fila = (await t.trx
        .from('inventario.saldos')
        .where({ producto_id: productoId, bodega_id: bodegaId })
        .select('cantidad', 'valor')
        .first()) as { cantidad: string; valor: string } | null
    return { cantidad: dec(fila?.cantidad ?? '0'), valor: dec(fila?.valor ?? '0') }
}

/** Existencia total del producto en todas sus bodegas. */
async function existenciaTotal(t: Transaccion, productoId: number): Promise<Dec> {
    const fila = (await t.trx
        .from('inventario.saldos')
        .where('producto_id', productoId)
        .select(t.trx.raw('coalesce(sum(cantidad), 0)::text as cantidad'))
        .first()) as { cantidad: string }
    return dec(fila.cantidad)
}

export class ExistenciaInsuficiente extends Conflicto {
    constructor(producto: { id: number; sku?: string }, bodegaId: number, pedido: Dec, hay: Dec) {
        super(
            `El producto ${producto.sku ?? producto.id} tiene ${aCantidad(hay)} en la bodega ${bodegaId}; se pidieron ${aCantidad(pedido)}`,
            'existencia_insuficiente',
            'Existencia insuficiente',
        )
    }
}

/**
 * Costo de sacar `cantidad` (> 0) de un saldo: proporcional al valor, o todo el valor si la vacía.
 * 409 `existencia_insuficiente` si no alcanza.
 */
export function costoSalida(
    saldo: Saldo,
    cantidad: Dec,
    producto: { id: number; sku?: string },
    bodegaId: number,
): Dec {
    if (cantidad.gt(saldo.cantidad)) {
        throw new ExistenciaInsuficiente(producto, bodegaId, cantidad, saldo.cantidad)
    }
    if (cantidad.eq(saldo.cantidad)) return saldo.valor
    return redondear(cantidad.times(saldo.valor).div(saldo.cantidad))
}

/** Costo unitario de un movimiento: `|costo| / |cantidad|` con 6 decimales. */
export function costoUnitario(costo: Dec, cantidad: Dec): string {
    if (cantidad.isZero()) return '0.000000'
    return costo.abs().div(cantidad.abs()).toDecimalPlaces(6, D.ROUND_HALF_UP).toFixed(6)
}

export interface ProductoMovible {
    id: number
    empresa_id: number
    sku: string
    nombre: string
    seguimiento: string
    clase_activo: string | null
    activo: boolean
    existencia_minima: string | null
    cuenta_costo: string | null
    cuenta_consumo: string | null
}

export interface BodegaMovible {
    id: number
    empresa_id: number
    nombre: string
    tipo: string
    usuario_id: number | null
    zona_id: number | null
    router_id: number | null
    activo: boolean
}

/**
 * Producto de un movimiento: existe, es de la empresa (404 si es de otra) y está activo (para
 * entrar). `seguimiento` dice si el movimiento va por cantidad o por unidades
 * (`exigirSeguimiento`).
 */
export async function productoMovible(
    t: Transaccion,
    productoId: number,
    opciones: { empresaId?: number; campo?: string; entrada?: boolean } = {},
): Promise<ProductoMovible> {
    const campo = opciones.campo ?? 'producto_id'
    const fila = (await t.trx
        .from('inventario.productos')
        .where('id', productoId)
        .select(
            'id',
            'empresa_id',
            'sku',
            'nombre',
            'seguimiento',
            'clase_activo',
            'activo',
            t.trx.raw('existencia_minima::text as existencia_minima'),
            'cuenta_costo',
            'cuenta_consumo',
        )
        .first()) as ProductoMovible | null
    if (!fila || (opciones.empresaId !== undefined && Number(fila.empresa_id) !== opciones.empresaId)) {
        throw new NoEncontrado(`El producto ${productoId} no existe`)
    }
    exigirAccesoEmpresa(t.ctx, Number(fila.empresa_id))
    if (opciones.entrada && !fila.activo) {
        throw new ValidacionFallida([
            { field: campo, message: `El producto ${fila.sku} está desactivado`, rule: 'producto_inactivo' },
        ])
    }
    return { ...fila, id: Number(fila.id), empresa_id: Number(fila.empresa_id) }
}

/**
 * 422 si la operación no corresponde al seguimiento del producto: uno por cantidad no lleva
 * unidades (`no_aplica`) y uno por serie no va por cantidad (`requiere_unidades`).
 */
export function exigirSeguimiento(
    producto: ProductoMovible,
    conUnidades: boolean,
    campo = conUnidades ? 'unidad_id' : 'cantidad',
): void {
    if (producto.seguimiento === 'serie' && !conUnidades) {
        throw new ValidacionFallida([
            {
                field: campo,
                message: `El producto ${producto.sku} se lleva por serie: indica sus unidades`,
                rule: 'requiere_unidades',
            },
        ])
    }
    if (producto.seguimiento !== 'serie' && conUnidades) {
        throw new ValidacionFallida([
            {
                field: campo,
                message: `El producto ${producto.sku} se lleva por cantidad: no lleva unidades`,
                rule: 'no_aplica',
            },
        ])
    }
}

/**
 * Bodega de un movimiento: existe y es de la empresa (404 si no), activa para recibir. La bodega
 * virtual «en tránsito» (fase D, `contratos/inventario.md` D.1) solo la mueven las órdenes de traslado
 * (`transito: true`); cualquier otra operación sobre ella responde 422 `bodega_transito`.
 */
export async function bodegaMovible(
    t: Transaccion,
    bodegaId: number,
    empresaId: number,
    opciones: { campo?: string; entrada?: boolean; transito?: boolean } = {},
): Promise<BodegaMovible> {
    const fila = (await t.trx
        .from('inventario.bodegas')
        .where('id', bodegaId)
        .select('id', 'empresa_id', 'nombre', 'tipo', 'usuario_id', 'zona_id', 'router_id', 'activo')
        .first()) as BodegaMovible | null
    if (!fila || Number(fila.empresa_id) !== empresaId) {
        throw new NoEncontrado(`La bodega ${bodegaId} no existe`)
    }
    if (fila.tipo === 'transito' && !opciones.transito) {
        throw new ValidacionFallida([
            {
                field: opciones.campo ?? 'bodega_id',
                message: `La bodega ${fila.nombre} es la de lo que viaja en órdenes de traslado: no se opera a mano`,
                rule: 'bodega_transito',
            },
        ])
    }
    if (opciones.entrada && !fila.activo) {
        throw new ValidacionFallida([
            {
                field: opciones.campo ?? 'bodega_id',
                message: `La bodega ${fila.nombre} está desactivada`,
                rule: 'bodega_inactiva',
            },
        ])
    }
    return {
        ...fila,
        id: Number(fila.id),
        empresa_id: Number(fila.empresa_id),
        usuario_id: fila.usuario_id === null ? null : Number(fila.usuario_id),
        zona_id: fila.zona_id === null ? null : Number(fila.zona_id),
        router_id: fila.router_id === null ? null : Number(fila.router_id),
    }
}

/**
 * Costo unitario de un sobrante (H41 del auditor): con existencia en la bodega, su promedio (el
 * `costo_unitario` pedido se ignora); sin existencia, el `costo_unitario` pedido (> 0) o el del último
 * movimiento con costo del producto. Sin ninguno, o con `costo_unitario` ≤ 0: 422 `costo_requerido`.
 */
export async function costoDeSobrante(
    t: Transaccion,
    producto: { id: number; sku: string },
    bodegaId: number,
    pedido?: string | null,
): Promise<Dec> {
    const saldo = await saldoDe(t, producto.id, bodegaId)
    if (saldo.cantidad.gt(0)) return saldo.valor.div(saldo.cantidad)
    const requerido = (mensaje: string) =>
        new ValidacionFallida([{ field: 'costo_unitario', message: mensaje, rule: 'costo_requerido' }])
    if (pedido !== undefined && pedido !== null && pedido !== '') {
        const unitario = dec(pedido)
        if (unitario.lte(0)) throw requerido('El costo unitario de un sobrante es mayor que 0')
        return unitario
    }
    const ultimo = (await t.trx
        .from('inventario.movimientos')
        .where('producto_id', producto.id)
        .where('costo_unitario', '>', 0)
        .orderBy('id', 'desc')
        .select('costo_unitario')
        .first()) as { costo_unitario: string } | null
    if (!ultimo) throw requerido(`El producto ${producto.sku} no tiene costo conocido: indica costo_unitario`)
    return dec(ultimo.costo_unitario)
}

/**
 * Fecha de un consumo o un ajuste (decisión del líder, fase C): por defecto hoy; una pasada solo dentro
 * de un periodo abierto (422 `periodo_cerrado`; los bloqueos del libro los aplica el asiento) y nunca
 * futura (422 `futuro`). El costo es siempre el promedio del momento de registrar.
 */
export async function fechaDeOperacion(
    t: Transaccion,
    empresaId: number,
    pedida?: string | null,
): Promise<string> {
    const hoy = hoyGuatemala()
    if (!pedida) return hoy
    const fecha = fechaValida(pedida)
    if (fecha > hoy) {
        throw new ValidacionFallida([
            { field: 'fecha', message: 'La fecha no puede ser futura', rule: 'futuro' },
        ])
    }
    if (fecha < hoy && (await periodoCerrado(t.trx, fecha, empresaId))) {
        throw new ReglaNegocio(
            `Periodo ${inicioDeMes(fecha).slice(0, 7)} cerrado: no se registran movimientos con fecha ${fecha}`,
            'periodo_cerrado',
        )
    }
    return fecha
}

/**
 * H55 (decisión del líder): un consumo o un ajuste por cantidad con fecha pasada solo se acepta si el
 * producto, en esa bodega, no tiene después de esa fecha ningún movimiento que cambie el promedio: una
 * entrada (compra, traslado que llega, sobrante, reverso…) o una salida a un costo que no es el promedio
 * (anulación de compra, devolución al proveedor). Así el promedio de esa fecha es el de hoy y el
 * movimiento se valúa bien. Si no: 409 `fecha_con_movimientos_posteriores` (se registra con la fecha de
 * hoy).
 */
export async function exigirPromedioSinCambiosDesde(
    t: Transaccion,
    producto: { id: number; sku: string },
    bodegaId: number,
    fecha: string,
): Promise<void> {
    if (fecha >= hoyGuatemala()) return
    const posterior = (await t.trx
        .from('inventario.movimientos')
        .where({ producto_id: producto.id, bodega_id: bodegaId })
        .where('fecha', '>', fecha)
        .where((q) =>
            q.where('cantidad', '>', 0).orWhereIn('tipo', ['reverso_compra', 'devolucion_proveedor']),
        )
        .orderBy('fecha')
        .orderBy('id')
        .select('id', 'tipo', t.trx.raw(`to_char(fecha, 'YYYY-MM-DD') as fecha`))
        .first()) as { id: number; tipo: string; fecha: string } | null
    if (posterior) {
        throw new Conflicto(
            `El producto ${producto.sku} tiene en la bodega ${bodegaId} un movimiento posterior al ${fecha} que cambió su costo promedio (${posterior.tipo.replaceAll('_', ' ')} del ${posterior.fecha}, movimiento ${posterior.id}): regístralo con la fecha de hoy`,
            'fecha_con_movimientos_posteriores',
            'Movimientos posteriores a la fecha',
        )
    }
}

/**
 * Un movimiento con fecha pasada no deja la bodega en negativo en ninguna fecha desde la suya (con el
 * lock del producto): ni la existencia ni el valor acumulados por fecha, más lo que el movimiento suma o
 * resta, en su fecha y en cada fecha posterior con movimientos. Si no alcanza: 409
 * `existencia_insuficiente_en_fecha`.
 */
export async function exigirExistenciaDesde(
    t: Transaccion,
    producto: { id: number; sku: string },
    bodegaId: number,
    fecha: string,
    sale: Dec,
    costo: Dec = dec('0'),
): Promise<void> {
    if (fecha >= hoyGuatemala()) return
    const { rows } = (await t.trx.rawQuery(
        `WITH por_dia AS (
             SELECT fecha, sum(sum(cantidad)) OVER (ORDER BY fecha) AS cantidad,
                    sum(sum(costo_total)) OVER (ORDER BY fecha) AS valor
               FROM inventario.movimientos
              WHERE producto_id = ? AND bodega_id = ?
              GROUP BY fecha
         ), puntos AS (
             SELECT ?::date AS fecha,
                    (SELECT coalesce(sum(cantidad), 0) FROM inventario.movimientos
                      WHERE producto_id = ? AND bodega_id = ? AND fecha <= ?::date) AS cantidad,
                    (SELECT coalesce(sum(costo_total), 0) FROM inventario.movimientos
                      WHERE producto_id = ? AND bodega_id = ? AND fecha <= ?::date) AS valor
             UNION ALL
             SELECT fecha, cantidad, valor FROM por_dia WHERE fecha > ?::date
         )
         SELECT to_char(fecha, 'YYYY-MM-DD') AS en, cantidad::text, valor::text
           FROM puntos
          WHERE cantidad - ? < 0 OR valor - ? < 0
          ORDER BY fecha LIMIT 1`,
        [
            producto.id,
            bodegaId,
            fecha,
            producto.id,
            bodegaId,
            fecha,
            producto.id,
            bodegaId,
            fecha,
            fecha,
            aCantidad(sale),
            aTexto(costo),
        ],
    )) as { rows: Array<{ en: string; cantidad: string }> }
    const negativo = rows[0]
    if (negativo) {
        throw new Conflicto(
            `Con fecha ${fecha} el producto ${producto.sku} quedaría en negativo en la bodega ${bodegaId} el ${negativo.en} (había ${aCantidad(dec(negativo.cantidad))}); se piden ${aCantidad(sale)}`,
            'existencia_insuficiente_en_fecha',
            'Existencia insuficiente en la fecha',
        )
    }
}

/** Cantidad válida de una operación: > 0 con hasta 3 decimales. */
export function cantidadValida(valor: string | number, campo = 'cantidad', conSigno = false): Dec {
    const cantidad = dec(String(valor))
    if (
        cantidad.decimalPlaces() > 3 ||
        (conSigno ? cantidad.isZero() : cantidad.lte(0)) ||
        cantidad.abs().gte('100000000000')
    ) {
        throw new ValidacionFallida([
            {
                field: campo,
                message: conSigno
                    ? 'La cantidad es distinta de 0 con hasta 3 decimales'
                    : 'La cantidad es mayor que 0 con hasta 3 decimales',
                rule: 'cantidad',
            },
        ])
    }
    return cantidad
}

export interface MovimientoNuevo {
    /** id pedido antes (el del `origen_id` del asiento propio); si falta, lo da la base */
    id?: number
    empresaId: number
    tipo: TipoMovimiento
    fecha: string
    producto: ProductoMovible
    bodegaId: number
    /** con signo: + entra, − sale */
    cantidad: Dec
    /** con signo, a centavos */
    costoTotal: Dec
    servicioId?: number | null
    /** movimiento de una unidad de serie (cantidad ±1 a su costo) */
    unidadId?: number | null
    /** venta y sus reversos: la línea de la factura */
    facturaLineaId?: number | null
    asientoId?: number | null
    origen?: { tipo: string; id: number } | null
    /** orden de Iris u otro sistema externo (solo trazabilidad, `#inventario/origen_externo`) */
    origenExterno?: OrigenExterno | null
    trasladoId?: number | null
    reversoDe?: number | null
    causa?: CausaBaja | null
    motivo?: string | null
    /** false en un traslado: la existencia total no cambia (sin `inventario.existencia_minima`) */
    avisarMinimo?: boolean
}

/** Pide el id del siguiente movimiento (para el `origen_id` de su asiento). */
export async function reservarMovimiento(t: Transaccion): Promise<number> {
    const { rows } = (await t.trx.rawQuery(
        `SELECT nextval(pg_get_serial_sequence('inventario.movimientos', 'id'))::bigint AS id`,
    )) as { rows: Array<{ id: string }> }
    return Number(rows[0]!.id)
}

/**
 * Inserta un movimiento (con el lock del producto ya tomado), deja que el trigger proyecte el saldo y
 * emite sus eventos. Devuelve el id.
 */
export async function insertarMovimiento(t: Transaccion, m: MovimientoNuevo): Promise<number> {
    const antes =
        m.producto.existencia_minima !== null && m.avisarMinimo !== false
            ? await existenciaTotal(t, m.producto.id)
            : null
    const [fila] = (await t.trx
        .insertQuery()
        .table('inventario.movimientos')
        .insert({
            ...(m.id ? { id: m.id } : {}),
            empresa_id: m.empresaId,
            tipo: m.tipo,
            fecha: m.fecha,
            producto_id: m.producto.id,
            bodega_id: m.bodegaId,
            cantidad: aCantidad(m.cantidad),
            costo_unitario: costoUnitario(m.costoTotal, m.cantidad),
            costo_total: aTexto(m.costoTotal),
            servicio_id: m.servicioId ?? null,
            unidad_id: m.unidadId ?? null,
            factura_linea_id: m.facturaLineaId ?? null,
            asiento_id: m.asientoId ?? null,
            origen_tipo: m.origen?.tipo ?? null,
            origen_id: m.origen?.id ?? null,
            ...columnasOrigenExterno(m.origenExterno),
            traslado_id: m.trasladoId ?? null,
            reverso_de: m.reversoDe ?? null,
            causa: m.causa ?? null,
            motivo: m.motivo?.trim() || null,
            actor_tipo: t.ctx.actor.tipo,
            actor_id: t.ctx.actor.id,
            request_id: t.ctx.requestId,
        })
        .returning('id')) as Array<{ id: number }>
    const id = Number(fila!.id)
    await t.emit('inventario.movimiento_registrado', {
        movimiento_id: id,
        empresa_id: m.empresaId,
        tipo: m.tipo,
        producto_id: m.producto.id,
        bodega_id: m.bodegaId,
        cantidad: aCantidad(m.cantidad),
        costo_total: aTexto(m.costoTotal),
        unidad_id: m.unidadId ?? null,
        servicio_id: m.servicioId ?? null,
        origen_tipo: m.origen?.tipo ?? null,
        origen_id: m.origen?.id ?? null,
        ...columnasOrigenExterno(m.origenExterno),
    })
    if (antes !== null) {
        const minimo = dec(m.producto.existencia_minima!)
        const despues = antes.plus(m.cantidad)
        if (antes.gte(minimo) && despues.lt(minimo)) {
            await t.emit('inventario.existencia_minima', {
                empresa_id: m.empresaId,
                producto_id: m.producto.id,
                bodega_id: null,
                cantidad: aCantidad(despues),
                minimo: aCantidad(minimo),
            })
        }
    }
    return id
}

/**
 * Movimiento propio con su asiento (consumo, ajuste, baja, saldo inicial): `1.1.14` contra
 * `contrapartida` por el costo; sale de 1.1.14 si la cantidad es negativa. Sin costo, sin asiento.
 * El asiento respeta los bloqueos de siempre (`RegistrarAsiento`: 422 `periodo_cerrado` o
 * `periodo_bloqueado`, 409 `bloqueo_duro`).
 */
export async function registrarMovimientoConAsiento(
    t: Transaccion,
    m: Omit<MovimientoNuevo, 'id' | 'asientoId'>,
    asiento: {
        contrapartida?: string | number
        descripcion: string
        /** partidas propias (la devolución de comodato); por defecto 1.1.14 contra `contrapartida` */
        movimientos?: LineaAsiento[]
        /** diario del asiento (la venta va al de ventas, `VEN`, y respeta su bloqueo) */
        diario?: string | null
    },
    id: number | null = null,
): Promise<number> {
    id ??= await reservarMovimiento(t)
    let asientoId: number | null = null
    if (!m.costoTotal.isZero() || asiento.movimientos) {
        const monto = aTexto(m.costoTotal.abs())
        const sale = m.cantidad.lt(0)
        const contrapartida = asiento.contrapartida!
        const registrado = await new RegistrarAsiento().execute(
            {
                empresa_id: m.empresaId,
                fecha: m.fecha,
                descripcion: asiento.descripcion,
                origen_tipo: 'inventario',
                origen_id: id,
                diario: asiento.diario ?? null,
                movimientos: asiento.movimientos ?? [
                    { cuenta: sale ? contrapartida : CUENTAS_GT.INVENTARIOS, debe: monto },
                    { cuenta: sale ? CUENTAS_GT.INVENTARIOS : contrapartida, haber: monto },
                ],
            },
            t.ctx,
            { trx: t.trx },
        )
        asientoId = registrado.id
    }
    return insertarMovimiento(t, { ...m, id, asientoId })
}

/*
|--------------------------------------------------------------------------
| Lectura
|--------------------------------------------------------------------------
*/

export interface MovimientoVista {
    id: number
    empresa_id: number
    tipo: TipoMovimiento
    fecha: string
    producto_id: number
    producto_sku: string
    producto_nombre: string
    bodega_id: number
    bodega_nombre: string
    cantidad: string
    costo_unitario: string
    costo_total: string
    unidad_id: number | null
    servicio_id: number | null
    asiento_id: number | null
    origen_tipo: string | null
    origen_id: number | null
    origen_externo_tipo: OrigenExternoTipo | null
    origen_externo_id: string | null
    traslado_id: number | null
    reverso_de: number | null
    causa: CausaBaja | null
    motivo: string | null
    actor_tipo: string
    actor_id: number | null
    created_at: Date
    /** saldo corrido del producto (en la bodega si se filtró por bodega) después del movimiento */
    saldo_cantidad: string
    saldo_valor: string
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

function normalizarMovimiento(f: MovimientoVista): MovimientoVista {
    return {
        ...f,
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        producto_id: Number(f.producto_id),
        bodega_id: Number(f.bodega_id),
        unidad_id: n(f.unidad_id),
        servicio_id: n(f.servicio_id),
        asiento_id: n(f.asiento_id),
        origen_id: n(f.origen_id),
        traslado_id: n(f.traslado_id),
        reverso_de: n(f.reverso_de),
        actor_id: n(f.actor_id),
    }
}

/** Columnas de un movimiento (sin saldo corrido). */
function columnasMovimiento(cliente: QueryClientContract) {
    return [
        'm.id',
        'm.empresa_id',
        'm.tipo',
        cliente.raw(`to_char(m.fecha, 'YYYY-MM-DD') as fecha`),
        'm.producto_id',
        'p.sku as producto_sku',
        'p.nombre as producto_nombre',
        'm.bodega_id',
        'b.nombre as bodega_nombre',
        cliente.raw('m.cantidad::text as cantidad'),
        cliente.raw('m.costo_unitario::text as costo_unitario'),
        cliente.raw('m.costo_total::text as costo_total'),
        'm.unidad_id',
        'm.servicio_id',
        'm.asiento_id',
        'm.origen_tipo',
        'm.origen_id',
        'm.origen_externo_tipo',
        'm.origen_externo_id',
        'm.traslado_id',
        'm.reverso_de',
        'm.causa',
        'm.motivo',
        'm.actor_tipo',
        'm.actor_id',
        'm.created_at',
    ]
}

/** Un movimiento con el saldo del producto en su bodega después de él. */
export async function verMovimiento(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await cliente
        .from('inventario.movimientos as m')
        .join('inventario.productos as p', 'p.id', 'm.producto_id')
        .join('inventario.bodegas as b', 'b.id', 'm.bodega_id')
        .where('m.id', id)
        .select(
            ...columnasMovimiento(cliente),
            cliente.raw(
                `(SELECT sum(x.cantidad) FROM inventario.movimientos x
                   WHERE x.producto_id = m.producto_id AND x.bodega_id = m.bodega_id AND x.id <= m.id)::text as saldo_cantidad`,
            ),
            cliente.raw(
                `(SELECT sum(x.costo_total) FROM inventario.movimientos x
                   WHERE x.producto_id = m.producto_id AND x.bodega_id = m.bodega_id AND x.id <= m.id)::text as saldo_valor`,
            ),
        )
        .first()) as MovimientoVista | null
    if (!fila) throw new NoEncontrado(`El movimiento ${id} no existe`)
    return normalizarMovimiento(fila)
}

export interface FiltrosKardex extends OpcionesPaginacion {
    producto_id?: number
    bodega_id?: number
    desde?: string
    hasta?: string
    tipo?: TipoMovimiento
    /** id de la orden de Iris (`origen_externo_id`) */
    origen_externo_id?: string
}

/**
 * El kardex en orden de registro (el del costo promedio), con el saldo corrido por producto (y por
 * bodega si se filtra por bodega) calculado sobre toda la historia antes de filtrar por fecha o tipo.
 */
export async function listarKardex(
    filtros: FiltrosKardex,
    empresas: number[] | null,
    acceso?: AccesoBodegas,
) {
    const cliente = db.connection()
    const particion = filtros.bodega_id ? 'm.producto_id, m.bodega_id' : 'm.producto_id'
    const base = cliente
        .from('inventario.movimientos as m')
        .join('inventario.productos as p', 'p.id', 'm.producto_id')
        .join('inventario.bodegas as b', 'b.id', 'm.bodega_id')
        .if(filtros.producto_id, (q) => q.where('m.producto_id', filtros.producto_id!))
        .if(filtros.bodega_id, (q) => q.where('m.bodega_id', filtros.bodega_id!))
        .select(
            ...columnasMovimiento(cliente),
            cliente.raw(
                `(sum(m.cantidad) OVER (PARTITION BY ${particion} ORDER BY m.id))::text as saldo_cantidad`,
            ),
            cliente.raw(
                `(sum(m.costo_total) OVER (PARTITION BY ${particion} ORDER BY m.id))::text as saldo_valor`,
            ),
        )
    filtrarPorEmpresa(base, empresas, (q, ids) => q.whereIn('m.empresa_id', ids))
    filtrarBodegasVisibles(base, acceso)
    const consulta = cliente
        .query()
        .from(base.as('k'))
        .select('k.*')
        .if(filtros.desde, (q) => q.where('k.fecha', '>=', filtros.desde!))
        .if(filtros.hasta, (q) => q.where('k.fecha', '<=', filtros.hasta!))
        .if(filtros.tipo, (q) => q.where('k.tipo', filtros.tipo!))
        // los movimientos de una orden de Iris (el saldo corrido sigue siendo el de toda la historia)
        .if(filtros.origen_externo_id, (q) => q.where('k.origen_externo_id', filtros.origen_externo_id!))
    const pagina = await paginar<MovimientoVista>(consulta, filtros, { columna: 'k.id', direccion: 'asc' })
    return { data: pagina.data.map(normalizarMovimiento), nextCursor: pagina.nextCursor }
}

export interface ExistenciaVista {
    id: number
    empresa_id: number
    producto_id: number
    producto_sku: string
    producto_nombre: string
    unidad: string
    bodega_id: number
    bodega_nombre: string
    bodega_tipo: string
    cantidad: string
    valor: string
    /** valor / cantidad de la bodega; null sin existencia */
    costo_promedio: string | null
    /** existencia total del producto en la empresa */
    existencia_total: string
    existencia_minima: string | null
    bajo_minimo: boolean
}

export interface FiltrosExistencias extends OpcionesPaginacion {
    producto_id?: number
    bodega_id?: number
    bajo_minimo?: boolean
}

/** Existencias por producto × bodega (la proyección `inventario.saldos`). */
export async function listarExistencias(
    filtros: FiltrosExistencias,
    empresas: number[] | null,
    acceso?: AccesoBodegas,
) {
    const cliente = db.connection()
    const total = `(SELECT sum(t.cantidad) FROM inventario.saldos t WHERE t.producto_id = s.producto_id)`
    const consulta = cliente
        .from('inventario.saldos as s')
        .join('inventario.productos as p', 'p.id', 's.producto_id')
        .join('inventario.bodegas as b', 'b.id', 's.bodega_id')
        .if(filtros.producto_id, (q) => q.where('s.producto_id', filtros.producto_id!))
        .if(filtros.bodega_id, (q) => q.where('s.bodega_id', filtros.bodega_id!))
        .if(filtros.bajo_minimo === true, (q) =>
            q.whereNotNull('p.existencia_minima').whereRaw(`${total} < p.existencia_minima`),
        )
        .select(
            's.id',
            's.empresa_id',
            's.producto_id',
            'p.sku as producto_sku',
            'p.nombre as producto_nombre',
            'p.unidad',
            's.bodega_id',
            'b.nombre as bodega_nombre',
            'b.tipo as bodega_tipo',
            cliente.raw('s.cantidad::text as cantidad'),
            cliente.raw('s.valor::text as valor'),
            cliente.raw(
                `CASE WHEN s.cantidad > 0 THEN round(s.valor / s.cantidad, 6)::numeric(18,6)::text END as costo_promedio`,
            ),
            cliente.raw(`${total}::numeric(14,3)::text as existencia_total`),
            cliente.raw('p.existencia_minima::text as existencia_minima'),
            cliente.raw(`coalesce(${total} < p.existencia_minima, false) as bajo_minimo`),
        )
    filtrarPorEmpresa(consulta, empresas, (q, ids) => q.whereIn('s.empresa_id', ids))
    filtrarBodegasVisibles(consulta, acceso)
    const pagina = await paginar<ExistenciaVista>(consulta, filtros, { columna: 's.id', direccion: 'asc' })
    return {
        data: pagina.data.map((f) => ({
            ...f,
            id: Number(f.id),
            empresa_id: Number(f.empresa_id),
            producto_id: Number(f.producto_id),
            bodega_id: Number(f.bodega_id),
        })),
        nextCursor: pagina.nextCursor,
    }
}

/*
|--------------------------------------------------------------------------
| Para el auditor (`contratos/inventario.md` §8)
|--------------------------------------------------------------------------
*/

/** Valor del kardex de la empresa hasta una fecha (inclusive): Σ `costo_total`. Check §8.1. */
export async function valorKardex(
    empresaId: number,
    hasta?: string | null,
    cliente: QueryClientContract = db.connection(),
): Promise<Dec> {
    const fila = (await cliente
        .from('inventario.movimientos')
        .where('empresa_id', empresaId)
        .if(hasta, (q) => q.where('fecha', '<=', hasta!))
        .select(cliente.raw('coalesce(sum(costo_total), 0)::text as valor'))
        .first()) as { valor: string }
    return dec(fila.valor)
}

/**
 * Existencias reconstruidas del kardex hasta una fecha, por producto × bodega (check §8.2 a la fecha
 * de hoy compara contra `inventario.saldos`).
 */
export async function existenciasDelKardex(
    empresaId: number,
    hasta?: string | null,
    cliente: QueryClientContract = db.connection(),
): Promise<Array<{ producto_id: number; bodega_id: number; cantidad: string; valor: string }>> {
    const filas = (await cliente
        .from('inventario.movimientos')
        .where('empresa_id', empresaId)
        .if(hasta, (q) => q.where('fecha', '<=', hasta!))
        .groupBy('producto_id', 'bodega_id')
        .orderBy(['producto_id', 'bodega_id'])
        .select(
            'producto_id',
            'bodega_id',
            cliente.raw('sum(cantidad)::numeric(14,3)::text as cantidad'),
            cliente.raw('sum(costo_total)::numeric(14,2)::text as valor'),
        )) as Array<{ producto_id: number; bodega_id: number; cantidad: string; valor: string }>
    return filas.map((f) => ({ ...f, producto_id: Number(f.producto_id), bodega_id: Number(f.bodega_id) }))
}
