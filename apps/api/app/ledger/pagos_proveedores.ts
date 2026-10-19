import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import { CERO, aTexto, dec } from '#ledger/dinero'
import { hoyGuatemala } from '#ledger/fechas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { sqlSaldoCompra } from '#ledger/compras'
import { verProveedor, type ProveedorVista } from '#ledger/proveedores'
import { armarReporte, COLUMNAS_EMPRESA, definirColumnas, type Reporte } from '#billing/reportes/definicion'
import type { MetodoEgreso } from '#ledger/egresos'

/**
 * Pagos a proveedores, auxiliar y antigüedad de proveedores (contrato de localización fiscal §3.4 y
 * §10.8, fase 5). Lectura; las acciones (`compras.pagar`, `compras.anular_pago`) viven en
 * `actions/`.
 *
 * - Un pago a proveedor es `2.1.03 Proveedores (auxiliar) / Caja | Banco`, aplicado a sus compras al
 *   crédito con saldo (la más antigua primero). Solo inserción; anular = fila en
 *   `pagos_proveedores_anulaciones` con el reverso.
 * - El saldo del proveedor es la suma de su auxiliar en `2.1.03` (haber − debe); la antigüedad
 *   reparte el saldo de cada compra pendiente por días desde su vencimiento y su total cuadra con
 *   `2.1.03` (check `cxp_antiguedad`, §10.5).
 */

export interface PagoProveedorVista {
    id: number
    empresa_id: number
    proveedor_id: number
    proveedor_nombre: string
    fecha: string
    metodo: MetodoEgreso
    caja_id: number | null
    turno_id: number | null
    banco_id: number | null
    cuenta_bancaria_id: number | null
    cuenta_id: number
    cuenta_codigo: string
    monto: string
    referencia: string | null
    descripcion: string | null
    asiento_id: number | null
    estado: 'registrado' | 'anulado'
    anulado_en: Date | null
    motivo_anulacion: string | null
    asiento_reverso_id: number | null
    registrado_por: number | null
    created_at: Date
    aplicaciones: Array<{ compra_id: number; documento: string; monto: string }>
}

function consultaPagos(cliente: QueryClientContract) {
    return cliente
        .from('ledger.pagos_proveedores as pp')
        .join('ledger.proveedores as p', 'p.id', 'pp.proveedor_id')
        .join('ledger.cuentas as c', 'c.id', 'pp.cuenta_id')
        .leftJoin('ledger.pagos_proveedores_anulaciones as an', 'an.pago_id', 'pp.id')
        .select(
            'pp.id',
            'pp.empresa_id',
            'pp.proveedor_id',
            'p.nombre as proveedor_nombre',
            cliente.raw(`to_char(pp.fecha, 'YYYY-MM-DD') as fecha`),
            'pp.metodo',
            'pp.caja_id',
            'pp.turno_id',
            'pp.banco_id',
            'pp.cuenta_bancaria_id',
            'pp.cuenta_id',
            'c.codigo as cuenta_codigo',
            'pp.monto',
            'pp.referencia',
            'pp.descripcion',
            cliente.raw(
                `(SELECT a.id FROM ledger.asientos a WHERE a.origen_tipo = 'pago_proveedor' AND a.origen_id = pp.id
                     AND a.reversa_de IS NULL ORDER BY a.id LIMIT 1) as asiento_id`,
            ),
            cliente.raw(`case when an.id is null then 'registrado' else 'anulado' end as estado`),
            'an.anulado_en',
            'an.motivo as motivo_anulacion',
            'an.asiento_id as asiento_reverso_id',
            'pp.registrado_por',
            'pp.created_at',
        )
}

type FilaPago = Omit<PagoProveedorVista, 'aplicaciones'>

async function completarPagos(
    cliente: QueryClientContract,
    filas: FilaPago[],
): Promise<PagoProveedorVista[]> {
    if (filas.length === 0) return []
    const aplicaciones = (await cliente
        .from('ledger.pagos_proveedores_aplicaciones as ap')
        .join('ledger.compras as c', 'c.id', 'ap.compra_id')
        .whereIn(
            'ap.pago_id',
            filas.map((f) => Number(f.id)),
        )
        .orderBy('ap.id')
        .select(
            'ap.pago_id',
            'ap.compra_id',
            'ap.monto',
            cliente.raw(
                `c.tipo_documento || ' ' || CASE WHEN c.serie = '' THEN '' ELSE c.serie || '-' END || c.numero as documento`,
            ),
        )) as Array<{ pago_id: number; compra_id: number; monto: string; documento: string }>
    const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
    return filas.map((f) => ({
        ...f,
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        proveedor_id: Number(f.proveedor_id),
        caja_id: n(f.caja_id),
        turno_id: n(f.turno_id),
        banco_id: n(f.banco_id),
        cuenta_bancaria_id: n(f.cuenta_bancaria_id),
        cuenta_id: Number(f.cuenta_id),
        asiento_id: n(f.asiento_id),
        asiento_reverso_id: n(f.asiento_reverso_id),
        aplicaciones: aplicaciones
            .filter((a) => Number(a.pago_id) === Number(f.id))
            .map((a) => ({ compra_id: Number(a.compra_id), documento: a.documento, monto: a.monto })),
    }))
}

export async function verPagoProveedor(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await consultaPagos(cliente).where('pp.id', id).first()) as FilaPago | null
    if (!fila) throw new NoEncontrado(`El pago a proveedor ${id} no existe`)
    const [vista] = await completarPagos(cliente, [fila])
    return vista!
}

export interface FiltrosPagosProveedores extends OpcionesPaginacion {
    proveedor_id?: number
    desde?: string
    hasta?: string
    estado?: 'registrado' | 'anulado'
}

export async function listarPagosProveedores(filtros: FiltrosPagosProveedores, empresas: number[] | null) {
    const consulta = consultaPagos(db.connection())
        .if(filtros.proveedor_id, (q) => q.where('pp.proveedor_id', filtros.proveedor_id!))
        .if(filtros.desde, (q) => q.where('pp.fecha', '>=', filtros.desde!))
        .if(filtros.hasta, (q) => q.where('pp.fecha', '<=', filtros.hasta!))
        .if(filtros.estado === 'anulado', (q) => q.whereNotNull('an.id'))
        .if(filtros.estado === 'registrado', (q) => q.whereNull('an.id'))
    filtrarPorEmpresa(consulta, empresas, (q, ids) => q.whereIn('pp.empresa_id', ids))
    const pagina = await paginar<FilaPago>(consulta, filtros, { columna: 'pp.id' })
    return { data: await completarPagos(db.connection(), pagina.data), nextCursor: pagina.nextCursor }
}

export async function empresaDePagoProveedor(
    id: number,
): Promise<{ empresa_id: number; caja: Array<number | null> }> {
    const fila = await db
        .from('ledger.pagos_proveedores')
        .where('id', id)
        .select('empresa_id', 'caja_id')
        .first()
    if (!fila) throw new NoEncontrado(`El pago a proveedor ${id} no existe`)
    return {
        empresa_id: Number(fila.empresa_id),
        caja: [fila.caja_id === null ? null : Number(fila.caja_id)],
    }
}

/** Compras al crédito con saldo de un proveedor, en orden de pago (vencimiento, documento, id). */
export async function comprasPendientes(cliente: QueryClientContract, proveedorId: number) {
    const filas = (await cliente
        .from('ledger.compras as c')
        .where('c.proveedor_id', proveedorId)
        .whereRaw(`${sqlSaldoCompra('c')} > 0`)
        .orderBy([
            { column: 'c.vence_en', order: 'asc' },
            { column: 'c.fecha_documento', order: 'asc' },
            { column: 'c.id', order: 'asc' },
        ])
        .select(
            'c.id',
            cliente.raw(`to_char(c.vence_en, 'YYYY-MM-DD') as vence_en`),
            cliente.raw(`to_char(c.fecha, 'YYYY-MM-DD') as fecha`),
            cliente.raw(`(${sqlSaldoCompra('c')})::numeric(14,2)::text as saldo`),
        )) as Array<{ id: number; vence_en: string; fecha: string; saldo: string }>
    return filas.map((f) => ({ id: Number(f.id), vence_en: f.vence_en, fecha: f.fecha, saldo: dec(f.saldo) }))
}

/** Efectivo pagado a proveedores en un turno de caja (pagos vigentes); baja el esperado del cierre. */
export async function pagosProveedoresDelTurno(
    cliente: QueryClientContract,
    turnoId: number,
): Promise<string> {
    const fila = (await cliente
        .from('ledger.pagos_proveedores as pp')
        .where('pp.turno_id', turnoId)
        .whereNotExists((q) =>
            q.from('ledger.pagos_proveedores_anulaciones as x').whereRaw('x.pago_id = pp.id'),
        )
        .select(cliente.raw('coalesce(sum(pp.monto), 0)::text as total'))
        .first()) as { total: string }
    return fila.total
}

/*
|--------------------------------------------------------------------------
| Estado de cuenta del proveedor (auxiliar de 2.1.03)
|--------------------------------------------------------------------------
*/

export interface MovimientoProveedor {
    asiento_id: number
    fecha: string
    tipo: 'compra' | 'nota_credito' | 'pago' | 'anulacion' | 'ajuste'
    documento: string
    descripcion: string
    debe: string
    haber: string
    saldo: string
}

export interface EstadoCuentaProveedor {
    proveedor: ProveedorVista
    desde: string | null
    hasta: string
    saldo_inicial: string
    movimientos: MovimientoProveedor[]
    saldo_final: string
    pendientes: Array<{
        compra_id: number
        documento: string
        vence_en: string
        saldo: string
        dias_vencida: number
    }>
}

/** Auxiliar del proveedor en `2.1.03`: saldo = Σ haber − debe; nunca una columna. */
export async function estadoCuentaProveedor(
    proveedorId: number,
    filtros: { desde?: string; hasta?: string },
): Promise<EstadoCuentaProveedor> {
    const proveedor = await verProveedor(proveedorId)
    const hasta = filtros.hasta ?? hoyGuatemala()
    const desde = filtros.desde ?? null
    const { rows } = (await db.rawQuery(
        `SELECT a.id AS asiento_id, to_char(a.fecha, 'YYYY-MM-DD') AS fecha, a.origen_tipo, a.reversa_de,
                a.descripcion, co.tipo_documento,
                coalesce(co.tipo_documento || ' ' || CASE WHEN co.serie = '' THEN '' ELSE co.serie || '-' END || co.numero,
                         'Pago ' || pp.id::text, a.origen_tipo) AS documento,
                m.debe::text AS debe, m.haber::text AS haber
           FROM ledger.movimientos m
           JOIN ledger.asientos a ON a.id = m.asiento_id
           JOIN ledger.cuentas c ON c.id = m.cuenta_id
           LEFT JOIN ledger.compras co ON a.origen_tipo = 'compra' AND co.id = a.origen_id
           LEFT JOIN ledger.pagos_proveedores pp ON a.origen_tipo = 'pago_proveedor' AND pp.id = a.origen_id
          WHERE m.proveedor_id = ? AND c.codigo = ? AND a.fecha <= ?
          ORDER BY a.fecha, a.id, m.id`,
        [proveedorId, CUENTAS_GT.PROVEEDORES, hasta],
    )) as {
        rows: Array<{
            asiento_id: number
            fecha: string
            origen_tipo: string
            reversa_de: number | null
            descripcion: string
            tipo_documento: string | null
            documento: string
            debe: string
            haber: string
        }>
    }
    let inicial = CERO
    let saldo = CERO
    const movimientos: MovimientoProveedor[] = []
    for (const fila of rows) {
        const efecto = dec(fila.haber).minus(fila.debe)
        if (desde && fila.fecha < desde) {
            inicial = inicial.plus(efecto)
            continue
        }
        if (movimientos.length === 0) saldo = inicial
        saldo = saldo.plus(efecto)
        const tipo: MovimientoProveedor['tipo'] =
            fila.reversa_de !== null
                ? 'anulacion'
                : fila.origen_tipo === 'pago_proveedor'
                  ? 'pago'
                  : fila.origen_tipo === 'compra'
                    ? fila.tipo_documento === 'NCRE'
                        ? 'nota_credito'
                        : 'compra'
                    : 'ajuste'
        movimientos.push({
            asiento_id: Number(fila.asiento_id),
            fecha: fila.fecha,
            tipo,
            documento: fila.documento,
            descripcion: fila.descripcion,
            debe: aTexto(fila.debe),
            haber: aTexto(fila.haber),
            saldo: aTexto(saldo),
        })
    }
    if (movimientos.length === 0) saldo = inicial
    const hoy = hoyGuatemala()
    const pendientes = (await db
        .from('ledger.compras as c')
        .where('c.proveedor_id', proveedorId)
        .whereRaw(`${sqlSaldoCompra('c')} > 0`)
        .orderBy('c.vence_en')
        .orderBy('c.id')
        .select(
            'c.id as compra_id',
            db.raw(
                `c.tipo_documento || ' ' || CASE WHEN c.serie = '' THEN '' ELSE c.serie || '-' END || c.numero as documento`,
            ),
            db.raw(`to_char(c.vence_en, 'YYYY-MM-DD') as vence_en`),
            db.raw(`(${sqlSaldoCompra('c')})::numeric(14,2)::text as saldo`),
            db.raw(`greatest(?::date - c.vence_en, 0)::int as dias_vencida`, [hoy]),
        )) as EstadoCuentaProveedor['pendientes']
    return {
        proveedor,
        desde,
        hasta,
        saldo_inicial: aTexto(inicial),
        movimientos,
        saldo_final: aTexto(saldo),
        pendientes: pendientes.map((p) => ({ ...p, compra_id: Number(p.compra_id) })),
    }
}

/*
|--------------------------------------------------------------------------
| Antigüedad de proveedores (GET /reportes/cuentas-por-pagar)
|--------------------------------------------------------------------------
*/

export const COLUMNAS_CXP = definirColumnas([
    { clave: 'proveedor_id', titulo: 'Proveedor', tipo: 'id' },
    { clave: 'proveedor', titulo: 'Nombre', tipo: 'texto' },
    { clave: 'nit', titulo: 'NIT', tipo: 'texto' },
    { clave: 'compras', titulo: 'Documentos', tipo: 'entero' },
    { clave: 'por_vencer', titulo: 'Por vencer', tipo: 'dinero' },
    { clave: 'dias_0_30', titulo: '1-30 días', tipo: 'dinero' },
    { clave: 'dias_31_60', titulo: '31-60 días', tipo: 'dinero' },
    { clave: 'dias_61_90', titulo: '61-90 días', tipo: 'dinero' },
    { clave: 'dias_mas_90', titulo: 'Más de 90 días', tipo: 'dinero' },
    { clave: 'vencido', titulo: 'Vencido', tipo: 'dinero' },
    { clave: 'total', titulo: 'Total', tipo: 'dinero' },
])

/**
 * Saldo pendiente de cada compra al crédito por días desde su vencimiento al `corte` (por defecto
 * hoy), agrupado por proveedor (tramos iguales a la cartera vencida). El total cuadra con `2.1.03`.
 * Con varias empresas (consolidado), una fila por empresa y proveedor con sus columnas de empresa.
 */
export async function cuentasPorPagar(
    filtros: { corte?: string; proveedor_id?: number },
    empresas: number[] | null,
    consolidado: boolean,
): Promise<Reporte> {
    const corte = filtros.corte ?? hoyGuatemala()
    const saldo = sqlSaldoCompra('c')
    const dias = `(?::date - c.vence_en)`
    const tramo = (condicion: string, alias: string) =>
        db.raw(
            `coalesce(sum(case when ${condicion} then ${saldo} else 0 end), 0)::numeric(14,2)::text as ${alias}`,
            [corte],
        )
    const consulta = db
        .from('ledger.compras as c')
        .join('ledger.proveedores as p', 'p.id', 'c.proveedor_id')
        .whereRaw(`${saldo} > 0`)
        .if(filtros.proveedor_id, (q) => q.where('c.proveedor_id', filtros.proveedor_id!))
        .groupBy('p.id', 'p.nombre', 'p.nit')
        .orderBy('p.nombre')
        .orderBy('p.id')
        .select(
            'p.id as proveedor_id',
            'p.nombre as proveedor',
            'p.nit',
            db.raw('count(*)::int as compras'),
            tramo(`${dias} <= 0`, 'por_vencer'),
            tramo(`${dias} between 1 and 30`, 'dias_0_30'),
            tramo(`${dias} between 31 and 60`, 'dias_31_60'),
            tramo(`${dias} between 61 and 90`, 'dias_61_90'),
            tramo(`${dias} > 90`, 'dias_mas_90'),
            tramo(`${dias} > 0`, 'vencido'),
            db.raw(`coalesce(sum(${saldo}), 0)::numeric(14,2)::text as total`),
        )
    if (empresas !== null) consulta.whereIn('c.empresa_id', empresas)
    if (consolidado) {
        consulta
            .groupBy('c.empresa_id')
            .select(
                'c.empresa_id',
                db.raw(
                    `(select e.nombre_comercial from core.empresas e where e.id = c.empresa_id) as empresa`,
                ),
            )
            .orderBy('c.empresa_id')
    }
    const filas = ((await consulta) as Array<Record<string, string | number | null>>).map((f) => ({
        ...f,
        proveedor_id: Number(f.proveedor_id),
        ...(consolidado ? { empresa_id: Number(f.empresa_id) } : {}),
    }))
    return armarReporte({
        reporte: 'cuentas-por-pagar',
        titulo: 'Antigüedad de proveedores (cuentas por pagar)',
        columnas: consolidado ? [...COLUMNAS_EMPRESA, ...COLUMNAS_CXP] : COLUMNAS_CXP,
        filas,
        filtros: { ...filtros, corte, empresas: consolidado ? 'todas' : (empresas ?? null) },
    })
}
