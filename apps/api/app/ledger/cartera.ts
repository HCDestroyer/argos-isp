import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import { CERO, aTexto, dec, redondear, type Dec } from '#ledger/dinero'
import type { LineaAsiento } from '#ledger/actions/registrar_asiento'
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

/** Lo recuperado de un castigo por pagos vigentes (`ledger.recuperaciones_castigo`, H17). */
const RECUPERADO_VIGENTE = `
    SELECT r.castigo_id, sum(r.monto) AS monto, sum(r.iva) AS iva
      FROM ledger.recuperaciones_castigo r JOIN billing.pagos p ON p.id = r.pago_id
     WHERE p.estado = 'registrado'
     GROUP BY 1`

/**
 * Lo que falta recuperar de los castigos del cliente en la empresa (decisión g del líder): Σ castigado −
 * Σ recuperado por pagos vigentes (`ledger.recuperaciones_castigo`; anular el pago lo devuelve).
 */
export async function porRecuperar(
    cliente: QueryClientContract,
    empresaId: number,
    clienteId: number,
): Promise<Dec> {
    const r = (await cliente.rawQuery(
        `SELECT coalesce(sum(k.monto - coalesce(r.monto, 0)), 0)::text AS falta
           FROM ledger.castigos k LEFT JOIN (${RECUPERADO_VIGENTE}) r ON r.castigo_id = k.id
          WHERE k.empresa_id = ? AND k.cliente_id = ?`,
        [empresaId, clienteId],
    )) as { rows: Array<{ falta: string }> }
    return dec(r.rows[0]!.falta)
}

export interface Recuperacion {
    castigo_id: number
    monto: Dec
    base: Dec
    iva: Dec
}

/**
 * H17 (decisión del líder): reparte hasta `disponible` entre los castigos del cliente con saldo por
 * recuperar (el más antiguo primero). Cada parte se divide en la proporción IVA / monto de su castigo:
 * la base es ingreso `4.2.03` y el IVA vuelve a `2.1.11` (de donde lo sacó el castigo de un aviso sin
 * DTE; un castigo sin IVA lo recupera todo como base). El IVA se calcula sobre lo acumulado para que,
 * recuperado todo, sume exactamente el del castigo.
 */
export async function repartirRecuperacion(
    cliente: QueryClientContract,
    empresaId: number,
    clienteId: number,
    disponible: Dec,
): Promise<Recuperacion[]> {
    if (disponible.lte(0)) return []
    const { rows } = (await cliente.rawQuery(
        `SELECT k.id, k.monto::text AS monto, k.iva::text AS iva,
                coalesce(r.monto, 0)::text AS recuperado, coalesce(r.iva, 0)::text AS iva_recuperado
           FROM ledger.castigos k LEFT JOIN (${RECUPERADO_VIGENTE}) r ON r.castigo_id = k.id
          WHERE k.empresa_id = ? AND k.cliente_id = ? AND k.monto > coalesce(r.monto, 0)
          ORDER BY k.id`,
        [empresaId, clienteId],
    )) as {
        rows: Array<{ id: number; monto: string; iva: string; recuperado: string; iva_recuperado: string }>
    }
    const partes: Recuperacion[] = []
    let resto = disponible
    for (const k of rows) {
        if (resto.lte(0)) break
        const falta = dec(k.monto).minus(k.recuperado)
        const monto = falta.lt(resto) ? falta : resto
        const ivaAcumulado = redondear(dec(k.recuperado).plus(monto).times(k.iva).div(k.monto))
        let iva = ivaAcumulado.minus(k.iva_recuperado)
        if (iva.lt(0)) iva = CERO
        if (iva.gt(monto)) iva = monto
        partes.push({ castigo_id: Number(k.id), monto, base: monto.minus(iva), iva })
        resto = resto.minus(monto)
    }
    return partes
}

/** Movimientos del asiento del pago por lo recuperado: base a 4.2.03 (con el cliente) e IVA a 2.1.11. */
export function movimientosRecuperacion(partes: Recuperacion[], clienteId: number): LineaAsiento[] {
    const base = partes.reduce((a, p) => a.plus(p.base), CERO)
    const iva = partes.reduce((a, p) => a.plus(p.iva), CERO)
    return [
        ...(base.gt(0)
            ? [{ cuenta: CUENTAS_GT.RECUPERACION_INCOBRABLES, haber: aTexto(base), cliente_id: clienteId }]
            : []),
        ...(iva.gt(0) ? [{ cuenta: CUENTAS_GT.IVA_POR_CERTIFICAR, haber: aTexto(iva) }] : []),
    ]
}

/** Guarda lo recuperado de cada castigo por el pago (insert-only). */
export async function guardarRecuperacion(
    trx: QueryClientContract,
    empresaId: number,
    pagoId: number,
    partes: Recuperacion[],
): Promise<void> {
    if (partes.length === 0) return
    await trx
        .insertQuery()
        .table('ledger.recuperaciones_castigo')
        .multiInsert(
            partes.map((p) => ({
                empresa_id: empresaId,
                castigo_id: p.castigo_id,
                pago_id: pagoId,
                monto: aTexto(p.monto),
                base: aTexto(p.base),
                iva: aTexto(p.iva),
            })),
        )
}
