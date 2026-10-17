import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { filtrarPorAlcance, type Alcance } from '#core/acl'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { NoEncontrado } from '#shared/errores'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import { CERO, dec, redondear, type Dec } from '#ledger/dinero'
import { dimensionesFactura } from '#billing/facturas'

/**
 * Notas de crédito internas (`billing.notas_credito`): lectura y reparto contable.
 *
 * Una nota reduce el saldo de una factura viva (parcial o total) y la CxC del cliente con un
 * asiento `nota_credito` que **espeja en proporción** el asiento de la factura: lo que la factura
 * acreditó a Ingresos, IVA débito, Otros ingresos o Recargos por mora se debita en la misma
 * proporción (monto / total), así el IVA de la nota sale del IVA de la factura. FEL: semana 5.
 */

export interface NotaCreditoFila {
    id: number
    /** la empresa de su factura */
    empresa_id: number
    factura_id: number
    cliente_id: number
    cliente_nombre: string
    servicio_id: number | null
    fecha: string
    subtotal: string
    iva: string
    monto: string
    motivo: string
    asiento_id: number | null
    created_by: number | null
    created_by_nombre: string | null
    created_at: Date
}

export function columnasNota(cliente: QueryClientContract) {
    return [
        'n.id',
        'n.empresa_id',
        'n.factura_id',
        'n.cliente_id',
        cliente.raw('(select cl.nombre from core.clientes cl where cl.id = n.cliente_id) as cliente_nombre'),
        'n.servicio_id',
        cliente.raw(`to_char(n.fecha, 'YYYY-MM-DD') as fecha`),
        'n.subtotal',
        'n.iva',
        'n.monto',
        'n.motivo',
        cliente.raw(
            `(select a.id from ledger.asientos a where a.origen_tipo = 'nota_credito' and a.origen_id = n.id and a.reversa_de is null order by a.id limit 1) as asiento_id`,
        ),
        'n.created_by',
        cliente.raw('(select u.nombre from core.usuarios u where u.id = n.created_by) as created_by_nombre'),
        'n.created_at',
    ]
}

export async function verNotaCredito(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await cliente
        .from('billing.notas_credito as n')
        .where('n.id', id)
        .select(...columnasNota(cliente))
        .first()) as NotaCreditoFila | null
    if (!fila) throw new NoEncontrado(`La nota de crédito ${id} no existe`)
    return fila
}

export async function notasDeFactura(
    facturaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<NotaCreditoFila[]> {
    return (await cliente
        .from('billing.notas_credito as n')
        .where('n.factura_id', facturaId)
        .orderBy('n.id', 'asc')
        .select(...columnasNota(cliente))) as NotaCreditoFila[]
}

export interface FiltrosNotas extends OpcionesPaginacion {
    cliente_id?: number
    factura_id?: number
    desde?: string
    hasta?: string
}

export async function listarNotasCredito(
    filtros: FiltrosNotas,
    alcance?: Alcance,
    empresas: number[] | null = null,
) {
    const consulta = db
        .from('billing.notas_credito as n')
        .join('billing.facturas as f', 'f.id', 'n.factura_id')
        .join('core.clientes as c', 'c.id', 'f.cliente_id')
        .leftJoin('core.servicios as s', 's.id', 'f.servicio_id')
        .select(...columnasNota(db.connection()))
        .if(filtros.cliente_id, (q) => q.where('n.cliente_id', filtros.cliente_id!))
        .if(filtros.factura_id, (q) => q.where('n.factura_id', filtros.factura_id!))
        .if(filtros.desde, (q) => q.where('n.fecha', '>=', filtros.desde!))
        .if(filtros.hasta, (q) => q.where('n.fecha', '<=', filtros.hasta!))
    filtrarPorAlcance(consulta, alcance, dimensionesFactura)
    filtrarPorEmpresa(consulta, empresas, (q, ids) => q.whereIn('n.empresa_id', ids))
    return paginar<NotaCreditoFila>(consulta, filtros, { columna: 'n.id' })
}

/** Total acreditado por notas a una factura. */
export async function acreditadoDe(cliente: QueryClientContract, facturaId: number): Promise<Dec> {
    const fila = (await cliente
        .from('billing.notas_credito')
        .where('factura_id', facturaId)
        .select(cliente.raw('coalesce(sum(monto), 0)::text as total'))
        .first()) as { total: string }
    return dec(fila.total)
}

export interface LineaCredito {
    cuenta_id: number
    cuenta_codigo: string
    haber: string
}

/**
 * Reparte `monto` entre las líneas acreditadas del asiento de la factura en proporción a lo que
 * cada una recibió (`haber_i × monto / total`), redondeado a centavos al final; la diferencia de
 * redondeo va a la línea mayor, así el reparto suma exacto `monto`.
 */
export function repartirProporcional(
    lineas: LineaCredito[],
    monto: Dec,
): Array<{ cuenta_id: number; cuenta_codigo: string; debe: Dec }> {
    const total = lineas.reduce((suma, l) => suma.plus(dec(l.haber)), CERO)
    const partes = lineas.map((l) => ({
        cuenta_id: l.cuenta_id,
        cuenta_codigo: l.cuenta_codigo,
        debe: total.isZero() ? CERO : redondear(dec(l.haber).times(monto).div(total)),
    }))
    const repartido = partes.reduce((suma, p) => suma.plus(p.debe), CERO)
    const diferencia = monto.minus(repartido)
    if (!diferencia.isZero() && partes.length > 0) {
        const mayor = partes.reduce((a, b) => (b.debe.gt(a.debe) ? b : a))
        mayor.debe = mayor.debe.plus(diferencia)
    }
    return partes.filter((p) => p.debe.gt(0))
}
