import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { filtrarPorAlcance, type Alcance, type FiltrosDimension } from '#core/acl'
import { NoEncontrado } from '#shared/errores'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import { CERO, D, aTexto, dec, redondear, type Dec, type Monto } from '#ledger/dinero'
import { notasDeFactura } from '#billing/notas_credito'

/**
 * Facturas: montos (IVA incluido), estado según lo pagado y consultas de lectura.
 */

export const TASA_IVA = new D('0.12')
const DIVISOR_IVA = new D('1.12')

export type EstadoFactura = 'emitida' | 'parcial' | 'pagada' | 'vencida' | 'anulada'
export type TipoFactura = 'servicio' | 'mora'

export interface LineaCalculada {
    concepto: string
    tipo: 'servicio' | 'producto' | 'mora' | 'otro'
    cantidad: string
    precio_unitario: string
    gravable: boolean
    iva: string
    total: string
}

/**
 * Desglosa el IVA incluido en el total de una línea: `subtotal = total / 1.12`, `iva = total −
 * subtotal`, redondeado a centavos al final del cálculo. El subtotal de la factura es
 * `total − Σ iva` para que siempre cuadre al centavo.
 */
export function lineaConIva(
    datos: Omit<LineaCalculada, 'iva' | 'total' | 'precio_unitario'> & { total: Monto },
): LineaCalculada {
    const total = redondear(datos.total)
    const iva = datos.gravable ? redondear(total.minus(total.div(DIVISOR_IVA))) : CERO
    const cantidad = dec(datos.cantidad)
    return {
        ...datos,
        cantidad: cantidad.toString(),
        precio_unitario: aTexto(cantidad.isZero() ? total : total.div(cantidad)),
        iva: aTexto(iva),
        total: aTexto(total),
    }
}

export interface Totales {
    subtotal: Dec
    iva: Dec
    total: Dec
}

export function totalesDe(lineas: LineaCalculada[]): Totales {
    let total = CERO
    let iva = CERO
    for (const linea of lineas) {
        total = total.plus(linea.total)
        iva = iva.plus(linea.iva)
    }
    return { subtotal: total.minus(iva), iva, total }
}

/** Estado de una factura viva según lo pagado y si ya pasó por el vencimiento. */
export function estadoSegunPago(f: { total: Monto; pagado: Monto; vencida_en: unknown }): EstadoFactura {
    if (dec(f.pagado).gte(dec(f.total))) return 'pagada'
    if (f.vencida_en) return 'vencida'
    return dec(f.pagado).gt(0) ? 'parcial' : 'emitida'
}

export const ESTADOS_PENDIENTES: readonly EstadoFactura[] = ['emitida', 'parcial', 'vencida']

/*
|--------------------------------------------------------------------------
| Lectura
|--------------------------------------------------------------------------
*/

export interface FacturaFila {
    id: number
    cliente_id: number
    cliente_nombre: string
    servicio_id: number | null
    tipo: TipoFactura
    factura_origen_id: number | null
    periodo: string
    clave_unica: string
    emitida_en: Date
    vence_en: string
    vencida_en: Date | null
    estado: EstadoFactura
    subtotal: string
    iva: string
    total: string
    /** cubierto: pagos, saldos a favor aplicados y notas de crédito */
    pagado: string
    /** parte de `pagado` que viene de notas de crédito */
    acreditado: string
    fel_uuid: string | null
    fel_serie: string | null
    fel_numero: string | null
    fel_estado: string | null
    anulada_en?: Date | null
    motivo_anulacion?: string | null
    version: number
    created_at: Date
    updated_at: Date
}

export function columnasFactura(cliente: QueryClientContract, alias = 'f') {
    const c = (columna: string) => `${alias}.${columna}`
    return [
        c('id'),
        c('cliente_id'),
        cliente.raw(
            `(select cl.nombre from core.clientes cl where cl.id = ${alias}.cliente_id) as cliente_nombre`,
        ),
        c('servicio_id'),
        c('tipo'),
        c('factura_origen_id'),
        cliente.raw(`to_char(${alias}.periodo, 'YYYY-MM-DD') as periodo`),
        c('clave_unica'),
        c('emitida_en'),
        cliente.raw(`to_char(${alias}.vence_en, 'YYYY-MM-DD') as vence_en`),
        c('vencida_en'),
        c('estado'),
        c('subtotal'),
        c('iva'),
        c('total'),
        c('pagado'),
        cliente.raw(
            `(select coalesce(sum(n.monto), 0) from billing.notas_credito n where n.factura_id = ${alias}.id) as acreditado`,
        ),
        c('fel_uuid'),
        c('fel_serie'),
        c('fel_numero'),
        c('fel_estado'),
        c('anulada_en'),
        c('motivo_anulacion'),
        c('version'),
        c('created_at'),
        c('updated_at'),
    ]
}

export interface FiltrosFacturas extends OpcionesPaginacion {
    cliente_id?: number
    servicio_id?: number
    estado?: EstadoFactura
    periodo?: string
    tipo?: TipoFactura
}

/** Filtros de alcance de una factura: zona del cliente y router del servicio. */
export const dimensionesFactura: FiltrosDimension = {
    zona: (q, ids) => q.whereIn('c.zona_id', ids),
    router: (q, ids) => q.whereIn('s.router_id', ids),
}

export async function listarFacturas(filtros: FiltrosFacturas, alcance?: Alcance) {
    const consulta = db
        .from('billing.facturas as f')
        .join('core.clientes as c', 'c.id', 'f.cliente_id')
        .leftJoin('core.servicios as s', 's.id', 'f.servicio_id')
        .select(...columnasFactura(db.connection()))
        .if(filtros.cliente_id, (q) => q.where('f.cliente_id', filtros.cliente_id!))
        .if(filtros.servicio_id, (q) => q.where('f.servicio_id', filtros.servicio_id!))
        .if(filtros.estado, (q) => q.where('f.estado', filtros.estado!))
        .if(filtros.periodo, (q) => q.where('f.periodo', filtros.periodo!))
        .if(filtros.tipo, (q) => q.where('f.tipo', filtros.tipo!))
    filtrarPorAlcance(consulta, alcance, dimensionesFactura)
    return paginar<FacturaFila>(consulta, filtros, { columna: 'f.id' })
}

export async function verFactura(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await cliente
        .from('billing.facturas as f')
        .where('f.id', id)
        .select(...columnasFactura(cliente), 'f.reglas_snapshot')
        .first()) as (FacturaFila & { reglas_snapshot: unknown }) | null
    if (!fila) throw new NoEncontrado(`La factura ${id} no existe`)
    const lineas = await cliente
        .from('billing.facturas_lineas')
        .where('factura_id', id)
        .orderBy('id', 'asc')
        .select(
            'id',
            'concepto',
            'tipo',
            cliente.raw('cantidad::text as cantidad'),
            'precio_unitario',
            'gravable',
            'iva',
            'total',
        )
    const notas = await notasDeFactura(id, cliente)
    return { ...fila, lineas, notas_credito: notas }
}

/** Dimensiones de alcance de una factura (para `exigirAlcance`). */
export async function dimensionesDeFactura(id: number) {
    const fila = (await db
        .from('billing.facturas as f')
        .join('core.clientes as c', 'c.id', 'f.cliente_id')
        .leftJoin('core.servicios as s', 's.id', 'f.servicio_id')
        .where('f.id', id)
        .select('c.zona_id', 's.router_id')
        .first()) as { zona_id: number | null; router_id: number | null } | null
    if (!fila) throw new NoEncontrado(`La factura ${id} no existe`)
    return { zona: [fila.zona_id], router: [fila.router_id] }
}

/** Pendiente de cobro de una factura. */
export function pendienteDe(f: { total: Monto; pagado: Monto }): Dec {
    return dec(f.total).minus(dec(f.pagado))
}
