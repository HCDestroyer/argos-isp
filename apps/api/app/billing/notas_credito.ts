import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { filtrarPorAlcance, type Alcance } from '#core/acl'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { NoEncontrado } from '#shared/errores'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import { CERO, D, dec, redondear, type Dec } from '#ledger/dinero'
import { dimensionesFactura } from '#billing/facturas'

/**
 * Notas de crédito internas (`billing.notas_credito`): lectura y reparto contable.
 *
 * Una nota reduce el saldo de una factura viva (parcial o total) y la CxC del cliente con un
 * asiento `nota_credito` que **espeja en proporción** el asiento de la factura: lo que a la
 * factura le queda acreditado en Ingresos, IVA débito, Otros ingresos o Recargos por mora (su
 * asiento menos las notas anteriores) se debita en proporción `monto / restante`, así el IVA de la
 * nota sale del IVA de la factura y la nota que agota la factura lleva el resto exacto de cada
 * cuenta (nunca queda IVA residual por redondeo). FEL: semana 5.
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
    /** la NCRE la rechazó la SAT en definitivo y la nota se anuló (fase 3); null si sigue vigente */
    anulada_en?: Date | null
    /** su NCRE (`fiscal.dte`): la vigente o, si no hay, la última rechazada; null en una nota interna */
    dte_id?: number | null
    fel_estado?: string | null
    fel_uuid?: string | null
    fel_serie?: string | null
    fel_numero?: string | null
    fel_error?: string | null
}

/** La NCRE de la nota: la vigente (no rechazada) o, si no hay, la última rechazada. */
function columnasNcre(cliente: QueryClientContract) {
    const dte = `(select d.%s from fiscal.dte d
        where d.documento_tipo = 'nota_credito' and d.documento_id = n.id
        order by (d.estado = 'rechazado'), d.id desc limit 1)`
    const col = (campo: string, como: string) => cliente.raw(`${dte.replace('%s', campo)} as ${como}`)
    return [
        col('id', 'dte_id'),
        col('estado', 'fel_estado'),
        col('autorizacion', 'fel_uuid'),
        col('serie', 'fel_serie'),
        col('numero', 'fel_numero'),
        col('ultimo_error', 'fel_error'),
    ]
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
        cliente.raw(
            '(select x.anulado_en from billing.notas_credito_anulaciones x where x.nota_id = n.id) as anulada_en',
        ),
        ...columnasNcre(cliente),
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
        .from('billing.notas_credito as n')
        .where('n.factura_id', facturaId)
        .whereNotExists((q) => q.from('billing.notas_credito_anulaciones as x').whereRaw('x.nota_id = n.id'))
        .select(cliente.raw('coalesce(sum(n.monto), 0)::text as total'))
        .first()) as { total: string }
    return dec(fila.total)
}

export interface LineaCredito {
    cuenta_id: number
    cuenta_codigo: string
    haber: string
}

/**
 * Reparte `monto` entre las líneas acreditables (`haber` = lo que a cada cuenta **le queda** por
 * acreditar de la factura, ya descontadas las notas anteriores) en proporción a ese restante
 * (`haber_i × monto / total`), redondeado a centavos al final; la diferencia de redondeo va a la
 * línea con más holgura, sin pasar nunca su restante.
 *
 * "El último toma el resto": como cada nota reparte sobre lo que queda, la que agota lo
 * acreditable (`monto = Σ haber`) toma exactamente el restante de cada cuenta y el asiento de la
 * factura queda espejado al centavo (Ingresos, IVA débito, Otros ingresos, Recargos).
 */
export function repartirProporcional(
    lineas: LineaCredito[],
    monto: Dec,
): Array<{ cuenta_id: number; cuenta_codigo: string; debe: Dec }> {
    const total = lineas.reduce((suma, l) => suma.plus(dec(l.haber)), CERO)
    if (monto.gte(total)) {
        return lineas
            .map((l) => ({ cuenta_id: l.cuenta_id, cuenta_codigo: l.cuenta_codigo, debe: dec(l.haber) }))
            .filter((p) => p.debe.gt(0))
    }
    const partes = lineas.map((l) => ({
        cuenta_id: l.cuenta_id,
        cuenta_codigo: l.cuenta_codigo,
        tope: dec(l.haber),
        debe: total.isZero() ? CERO : redondear(dec(l.haber).times(monto).div(total)),
    }))
    let diferencia = monto.minus(partes.reduce((suma, p) => suma.plus(p.debe), CERO))
    // centavo a centavo hacia la línea con más holgura (o la mayor, si sobra); nunca pasa su tope
    while (!diferencia.isZero() && partes.length > 0) {
        const paso = diferencia.gt(0) ? new D('0.01') : new D('-0.01')
        const candidatas = partes.filter((p) => (paso.gt(0) ? p.tope.minus(p.debe).gt(0) : p.debe.gt(0)))
        if (candidatas.length === 0) break
        const elegida = candidatas.reduce((a, b) =>
            (paso.gt(0) ? b.tope.minus(b.debe).gt(a.tope.minus(a.debe)) : b.debe.gt(a.debe)) ? b : a,
        )
        elegida.debe = elegida.debe.plus(paso)
        diferencia = diferencia.minus(paso)
    }
    return partes
        .filter((p) => p.debe.gt(0))
        .map((p) => ({ cuenta_id: p.cuenta_id, cuenta_codigo: p.cuenta_codigo, debe: p.debe }))
}
