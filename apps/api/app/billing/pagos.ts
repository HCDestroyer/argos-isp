import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { filtrarPorAlcance, type Alcance, type FiltrosDimension } from '#core/acl'
import { NoEncontrado } from '#shared/errores'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import type { MetodoPago } from '#shared/eventos'
import { CUENTAS } from '#ledger/plan_cuentas'

/**
 * Pagos: lectura (lista, detalle para el recibo) y la caja principal.
 */

export type EstadoPago = 'registrado' | 'pendiente_verificacion' | 'anulado'

export interface PagoVista {
    id: number
    cliente_id: number
    metodo: MetodoPago
    monto: string
    comision: string
    referencia: string | null
    caja_id: number | null
    pasarela: string | null
    estado: EstadoPago
    nota: string | null
    registrado_por: number | null
    anulado_en: Date | null
    motivo_anulacion: string | null
    banco_origen_id: number | null
    banco_origen_nombre: string | null
    cuenta_bancaria_id: number | null
    cuenta_bancaria_nombre: string | null
    aplicaciones: Array<{ factura_id: number; monto: string }>
    version: number
    created_at: Date
    updated_at: Date
}

const COLUMNAS = [
    'p.id',
    'p.cliente_id',
    'p.metodo',
    'p.monto',
    'p.comision',
    'p.referencia',
    'p.caja_id',
    'p.pasarela',
    'p.estado',
    'p.nota',
    'p.registrado_por',
    'p.anulado_en',
    'p.motivo_anulacion',
    'p.banco_origen_id',
    'bo.nombre as banco_origen_nombre',
    'p.cuenta_bancaria_id',
    db.raw(
        "case when cb.id is null then null else bd.nombre || ' · ' || cb.alias end as cuenta_bancaria_nombre",
    ),
    'p.version',
    'p.created_at',
    'p.updated_at',
]

async function conAplicaciones(
    cliente: QueryClientContract,
    pagos: Array<Omit<PagoVista, 'aplicaciones'>>,
): Promise<PagoVista[]> {
    if (pagos.length === 0) return []
    const filas = (await cliente
        .from('billing.pagos_aplicaciones')
        .whereIn(
            'pago_id',
            pagos.map((p) => p.id),
        )
        .orderBy('id', 'asc')
        .select('pago_id', 'factura_id', 'monto')) as Array<{
        pago_id: number
        factura_id: number
        monto: string
    }>
    return pagos.map((pago) => ({
        ...pago,
        aplicaciones: filas
            .filter((f) => f.pago_id === pago.id)
            .map((f) => ({ factura_id: f.factura_id, monto: f.monto })),
    }))
}

export async function verPago(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<PagoVista> {
    const fila = await cliente
        .from('billing.pagos as p')
        .leftJoin('billing.bancos as bo', 'bo.id', 'p.banco_origen_id')
        .leftJoin('billing.cuentas_bancarias as cb', 'cb.id', 'p.cuenta_bancaria_id')
        .leftJoin('billing.bancos as bd', 'bd.id', 'cb.banco_id')
        .where('p.id', id)
        .select(...COLUMNAS)
        .first()
    if (!fila) throw new NoEncontrado(`El pago ${id} no existe`)
    const [pago] = await conAplicaciones(cliente, [fila])
    return pago!
}

export interface FiltrosPagos extends OpcionesPaginacion {
    cliente_id?: number
    caja_id?: number
    cuenta_bancaria_id?: number
    metodo?: MetodoPago
    estado?: EstadoPago
    desde?: Date
    hasta?: Date
}

/** Un cajero con alcance por caja solo ve los pagos de su caja. */
const dimensionesPago: FiltrosDimension = {
    caja: (q, ids) => q.whereIn('p.caja_id', ids),
}

export async function listarPagos(filtros: FiltrosPagos, alcance?: Alcance) {
    const consulta = db
        .from('billing.pagos as p')
        .leftJoin('billing.bancos as bo', 'bo.id', 'p.banco_origen_id')
        .leftJoin('billing.cuentas_bancarias as cb', 'cb.id', 'p.cuenta_bancaria_id')
        .leftJoin('billing.bancos as bd', 'bd.id', 'cb.banco_id')
        .select(...COLUMNAS)
        .if(filtros.cliente_id, (q) => q.where('p.cliente_id', filtros.cliente_id!))
        .if(filtros.caja_id, (q) => q.where('p.caja_id', filtros.caja_id!))
        .if(filtros.cuenta_bancaria_id, (q) => q.where('p.cuenta_bancaria_id', filtros.cuenta_bancaria_id!))
        .if(filtros.metodo, (q) => q.where('p.metodo', filtros.metodo!))
        .if(filtros.estado, (q) => q.where('p.estado', filtros.estado!))
        .if(filtros.desde, (q) => q.where('p.created_at', '>=', filtros.desde!))
        .if(filtros.hasta, (q) => q.where('p.created_at', '<=', filtros.hasta!))
    filtrarPorAlcance(consulta, alcance, dimensionesPago)
    const pagina = await paginar<Omit<PagoVista, 'aplicaciones'>>(consulta, filtros, { columna: 'p.id' })
    return { data: await conAplicaciones(db.connection(), pagina.data), nextCursor: pagina.nextCursor }
}

/** Dimensiones de alcance de un pago (su caja, si tiene). */
export async function dimensionesDePago(id: number) {
    const fila = await db.from('billing.pagos').where('id', id).select('caja_id').first()
    if (!fila) throw new NoEncontrado(`El pago ${id} no existe`)
    return { caja: [fila.caja_id as number | null] }
}

/** Caja a la que va un pago en efectivo sin `caja_id` (la del plan de cuentas `1.1.01.01`). */
export async function cajaPrincipalId(
    cliente: QueryClientContract = db.connection(),
): Promise<number | null> {
    const fila = await cliente
        .from('ledger.cajas as c')
        .join('ledger.cuentas as cu', 'cu.id', 'c.cuenta_id')
        .where('cu.codigo', CUENTAS.CAJA_PRINCIPAL)
        .where('c.activa', true)
        .select('c.id')
        .first()
    return fila?.id ?? null
}
