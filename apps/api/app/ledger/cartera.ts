import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import { dec, type Dec } from '#ledger/dinero'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'

/**
 * Estimación y castigo de cartera (contrato de localización fiscal §10.9): lectura.
 */

export interface ProvisionVista {
    id: number
    empresa_id: number
    anio: number
    fecha: string
    base: string
    porcentaje: string
    tope: string
    saldo_anterior: string
    monto: string
    asiento_id: number | null
    registrado_por: number | null
    created_at: Date
}

function consultaProvisiones(cliente: QueryClientContract) {
    return cliente
        .from('ledger.provisiones_cartera as p')
        .select(
            'p.id',
            'p.empresa_id',
            'p.anio',
            cliente.raw(`to_char(p.fecha, 'YYYY-MM-DD') as fecha`),
            'p.base',
            'p.porcentaje',
            'p.tope',
            'p.saldo_anterior',
            'p.monto',
            cliente.raw(
                `(SELECT a.id FROM ledger.asientos a WHERE a.origen_tipo = 'provision' AND a.origen_id = p.id AND a.reversa_de IS NULL) as asiento_id`,
            ),
            'p.registrado_por',
            'p.created_at',
        )
}

export async function verProvision(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await consultaProvisiones(cliente).where('p.id', id).first()) as ProvisionVista | null
    if (!fila) throw new NoEncontrado(`La estimación ${id} no existe`)
    return fila
}

export async function listarProvisiones(filtros: OpcionesPaginacion, empresas: number[] | null) {
    const consulta = consultaProvisiones(db.connection())
    filtrarPorEmpresa(consulta, empresas, (q, ids) => q.whereIn('p.empresa_id', ids))
    return paginar<ProvisionVista>(consulta, filtros, { columna: 'p.id' })
}

export interface CastigoVista {
    id: number
    empresa_id: number
    cliente_id: number
    cliente_nombre: string
    fecha: string
    motivo: string
    evidencia: string
    monto: string
    iva: string
    estimacion: string
    gasto: string
    asiento_id: number | null
    registrado_por: number | null
    created_at: Date
    facturas: Array<{ factura_id: number; monto: string; iva: string }>
}

function consultaCastigos(cliente: QueryClientContract) {
    return cliente
        .from('ledger.castigos as k')
        .join('core.clientes as c', 'c.id', 'k.cliente_id')
        .select(
            'k.id',
            'k.empresa_id',
            'k.cliente_id',
            'c.nombre as cliente_nombre',
            cliente.raw(`to_char(k.fecha, 'YYYY-MM-DD') as fecha`),
            'k.motivo',
            'k.evidencia',
            'k.monto',
            'k.iva',
            'k.estimacion',
            'k.gasto',
            cliente.raw(
                `(SELECT a.id FROM ledger.asientos a WHERE a.origen_tipo = 'castigo' AND a.origen_id = k.id AND a.reversa_de IS NULL) as asiento_id`,
            ),
            'k.registrado_por',
            'k.created_at',
        )
}

async function conFacturas(cliente: QueryClientContract, filas: Array<Omit<CastigoVista, 'facturas'>>) {
    if (filas.length === 0) return []
    const facturas = (await cliente
        .from('ledger.castigos_facturas')
        .whereIn(
            'castigo_id',
            filas.map((f) => f.id),
        )
        .orderBy('factura_id')
        .select('castigo_id', 'factura_id', 'monto', 'iva')) as Array<{
        castigo_id: number
        factura_id: number
        monto: string
        iva: string
    }>
    return filas.map((f) => ({
        ...f,
        facturas: facturas
            .filter((x) => Number(x.castigo_id) === Number(f.id))
            .map((x) => ({ factura_id: Number(x.factura_id), monto: x.monto, iva: x.iva })),
    }))
}

export async function verCastigo(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = await consultaCastigos(cliente).where('k.id', id).first()
    if (!fila) throw new NoEncontrado(`El castigo ${id} no existe`)
    const [vista] = await conFacturas(cliente, [fila])
    return vista! as CastigoVista
}

export async function listarCastigos(filtros: OpcionesPaginacion, empresas: number[] | null) {
    const cliente = db.connection()
    const consulta = consultaCastigos(cliente)
    filtrarPorEmpresa(consulta, empresas, (q, ids) => q.whereIn('k.empresa_id', ids))
    const pagina = await paginar<Omit<CastigoVista, 'facturas'>>(consulta, filtros, { columna: 'k.id' })
    return { ...pagina, data: (await conFacturas(cliente, pagina.data)) as CastigoVista[] }
}

/**
 * Lo que falta recuperar de los castigos del cliente en la empresa (decisión g del líder): Σ castigado −
 * Σ recuperado en `4.2.03 Recuperación de cuentas incobrables` (movimientos con su `cliente_id`).
 */
export async function porRecuperar(
    cliente: QueryClientContract,
    empresaId: number,
    clienteId: number,
): Promise<Dec> {
    const r = (await cliente.rawQuery(
        `SELECT (SELECT coalesce(sum(k.monto), 0) FROM ledger.castigos k WHERE k.empresa_id = ? AND k.cliente_id = ?)
              - (SELECT coalesce(sum(m.haber - m.debe), 0) FROM ledger.movimientos m
                   JOIN ledger.asientos a ON a.id = m.asiento_id JOIN ledger.cuentas c ON c.id = m.cuenta_id
                  WHERE c.codigo = ? AND a.empresa_id = ? AND m.cliente_id = ?) AS falta`,
        [empresaId, clienteId, CUENTAS_GT.RECUPERACION_INCOBRABLES, empresaId, clienteId],
    )) as { rows: Array<{ falta: string }> }
    return dec(r.rows[0]!.falta)
}
