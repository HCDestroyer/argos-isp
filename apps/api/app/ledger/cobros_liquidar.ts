import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import { CERO, aTexto, dec } from '#ledger/dinero'
import { hoyGuatemala } from '#ledger/fechas'
import { valorParametro } from '#fiscal/parametros'

/**
 * Cobros por liquidar (contrato de localización fiscal §10.3): lectura.
 *
 * Un pago por pasarela, agente o débito de un proveedor configurado (`ledger.proveedores_cobro`,
 * con su fecha de corte `desde`) debita la subcuenta `1.1.10.NN` del proveedor por el **bruto**. La
 * liquidación del proveedor (`cobros.liquidar`) la limpia: `Banco (neto) + 5.1.02 Comisiones /
 * 1.1.10.NN (bruto)`. Un pago liquidado que después se anula deja un **contracargo** pendiente
 * (el reverso del pago acredita 1.1.10.NN), que la siguiente liquidación descuenta.
 *
 * Invariante (check `cobros_por_liquidar`): saldo de cada `1.1.10.NN` = Σ pagos vigentes sin
 * liquidar − Σ contracargos pendientes. Un pago sin liquidar más antiguo que
 * `cobros_liquidar_dias` (parámetro de la empresa, 7 por defecto) es anomalía.
 */

export const METODOS_POR_LIQUIDAR = ['pasarela', 'agente', 'debito'] as const
export type MetodoPorLiquidar = (typeof METODOS_POR_LIQUIDAR)[number]

export function esMetodoPorLiquidar(metodo: string): metodo is MetodoPorLiquidar {
    return (METODOS_POR_LIQUIDAR as readonly string[]).includes(metodo)
}

/**
 * Código del proveedor de un pago: el nombre de la pasarela (`falsa`, `recurrente`…) normalizado,
 * o el método para agente y débito.
 */
export function codigoProveedor(metodo: MetodoPorLiquidar, pasarela?: string | null): string {
    if (metodo !== 'pasarela') return metodo
    const limpio = (pasarela ?? '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40)
    return limpio || 'pasarela'
}

export interface ProveedorCobroVista {
    id: number
    empresa_id: number
    metodo: MetodoPorLiquidar
    codigo: string
    nombre: string
    cuenta_id: number
    cuenta_codigo: string
    cuenta_liquidacion_id: number
    cuenta_liquidacion_codigo: string
    cuenta_liquidacion_nombre: string
    desde: string
    activo: boolean
    version: number
    created_at: Date
    updated_at: Date
}

function consultaProveedores(cliente: QueryClientContract) {
    return cliente
        .from('ledger.proveedores_cobro as p')
        .join('ledger.cuentas as c', 'c.id', 'p.cuenta_id')
        .join('ledger.cuentas as cl', 'cl.id', 'p.cuenta_liquidacion_id')
        .select(
            'p.id',
            'p.empresa_id',
            'p.metodo',
            'p.codigo',
            'p.nombre',
            'p.cuenta_id',
            'c.codigo as cuenta_codigo',
            'p.cuenta_liquidacion_id',
            'cl.codigo as cuenta_liquidacion_codigo',
            'cl.nombre as cuenta_liquidacion_nombre',
            cliente.raw(`to_char(p.desde, 'YYYY-MM-DD') as desde`),
            'p.activo',
            'p.version',
            'p.created_at',
            'p.updated_at',
        )
}

function normalizarProveedor(f: ProveedorCobroVista): ProveedorCobroVista {
    return {
        ...f,
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        cuenta_id: Number(f.cuenta_id),
        cuenta_liquidacion_id: Number(f.cuenta_liquidacion_id),
    }
}

export async function listarProveedoresCobro(
    empresas: number[] | null,
    cliente: QueryClientContract = db.connection(),
): Promise<ProveedorCobroVista[]> {
    const consulta = consultaProveedores(cliente).orderBy('p.empresa_id').orderBy('p.id')
    filtrarPorEmpresa(consulta, empresas, (q, ids) => q.whereIn('p.empresa_id', ids))
    return ((await consulta) as ProveedorCobroVista[]).map(normalizarProveedor)
}

export async function verProveedorCobro(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<ProveedorCobroVista> {
    const fila = (await consultaProveedores(cliente).where('p.id', id).first()) as ProveedorCobroVista | null
    if (!fila) throw new NoEncontrado(`El proveedor de cobro ${id} no existe`)
    return normalizarProveedor(fila)
}

/** Empresa del proveedor (para exigir el acceso en la ruta). */
export async function empresaDeProveedorCobro(id: number): Promise<{ empresa_id: number }> {
    const fila = await db.from('ledger.proveedores_cobro').where('id', id).select('empresa_id').first()
    if (!fila) throw new NoEncontrado(`El proveedor de cobro ${id} no existe`)
    return { empresa_id: Number(fila.empresa_id) }
}

/**
 * Proveedor activo cuya fecha de corte ya llegó para un pago de la empresa con ese método (null =
 * el pago va al banco como antes de la fase 4).
 */
export async function proveedorParaPago(
    trx: QueryClientContract,
    empresaId: number,
    metodo: string,
    pasarela: string | null | undefined,
    fecha: string,
): Promise<{ id: number; cuenta_id: number; codigo: string } | null> {
    if (!esMetodoPorLiquidar(metodo)) return null
    const fila = (await trx
        .from('ledger.proveedores_cobro')
        .where('empresa_id', empresaId)
        .where('metodo', metodo)
        .where('codigo', codigoProveedor(metodo, pasarela))
        .where('activo', true)
        .where('desde', '<=', fecha)
        .select('id', 'cuenta_id', 'codigo')
        .first()) as { id: number; cuenta_id: number; codigo: string } | null
    return fila ? { id: Number(fila.id), cuenta_id: Number(fila.cuenta_id), codigo: fila.codigo } : null
}

export interface PagoPorLiquidar {
    pago_id: number
    tipo: 'cobro' | 'contracargo'
    cliente_id: number
    monto: string
    referencia: string | null
    fecha: string
    dias: number
}

/**
 * Pagos del proveedor pendientes de liquidar: los vigentes sin liquidar (`cobro`) y los anulados
 * después de liquidarse sin contracargo (`contracargo`, restan).
 */
export async function pendientesDeProveedor(
    cliente: QueryClientContract,
    proveedorId: number,
    hoy: string = hoyGuatemala(),
): Promise<PagoPorLiquidar[]> {
    const filas = (await cliente.rawQuery(
        `SELECT p.id AS pago_id,
                CASE WHEN p.estado = 'anulado' THEN 'contracargo' ELSE 'cobro' END AS tipo,
                p.cliente_id, p.monto::text AS monto, p.referencia,
                to_char((p.created_at AT TIME ZONE 'America/Guatemala')::date, 'YYYY-MM-DD') AS fecha,
                (?::date - (p.created_at AT TIME ZONE 'America/Guatemala')::date) AS dias
           FROM billing.pagos p
          WHERE p.proveedor_cobro_id = ?
            AND ((p.estado = 'registrado'
                  AND NOT EXISTS (SELECT 1 FROM ledger.liquidaciones_pagos l WHERE l.pago_id = p.id AND l.tipo = 'cobro'))
              OR (p.estado = 'anulado'
                  AND EXISTS (SELECT 1 FROM ledger.liquidaciones_pagos l WHERE l.pago_id = p.id AND l.tipo = 'cobro')
                  AND NOT EXISTS (SELECT 1 FROM ledger.liquidaciones_pagos l WHERE l.pago_id = p.id AND l.tipo = 'contracargo')))
          ORDER BY p.id`,
        [hoy, proveedorId],
    )) as { rows: Array<PagoPorLiquidar & { pago_id: string | number; cliente_id: string | number }> }
    return filas.rows.map((f) => ({
        ...f,
        pago_id: Number(f.pago_id),
        cliente_id: Number(f.cliente_id),
        dias: Number(f.dias),
    }))
}

export interface ResumenProveedorPorLiquidar {
    proveedor_cobro_id: number
    empresa_id: number
    metodo: MetodoPorLiquidar
    codigo: string
    nombre: string
    cuenta_codigo: string
    /** saldo de la subcuenta 1.1.10.NN en el libro de la empresa */
    saldo_libro: string
    /** Σ pagos sin liquidar − Σ contracargos pendientes */
    pendiente: string
    /** saldo_libro − pendiente: distinto de 0 = el puente no cuadra */
    diferencia: string
    cuadra: boolean
    dias_limite: number
    pagos: PagoPorLiquidar[]
    /** pagos sin liquidar más antiguos que `cobros_liquidar_dias` */
    anomalias: PagoPorLiquidar[]
}

/** Resumen por proveedor: el puente cuadra con lo pendiente y la antigüedad (§10.3). */
export async function resumenCobrosPorLiquidar(
    empresas: number[] | null,
    cliente: QueryClientContract = db.connection(),
    hoy: string = hoyGuatemala(),
): Promise<ResumenProveedorPorLiquidar[]> {
    const proveedores = await listarProveedoresCobro(empresas, cliente)
    const salida: ResumenProveedorPorLiquidar[] = []
    for (const p of proveedores) {
        const saldo = (await cliente
            .from('ledger.movimientos as m')
            .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
            .where('m.cuenta_id', p.cuenta_id)
            .where('a.empresa_id', p.empresa_id)
            .select(cliente.raw('coalesce(sum(m.debe - m.haber), 0)::text as saldo'))
            .first()) as { saldo: string }
        const pagos = await pendientesDeProveedor(cliente, p.id, hoy)
        const pendiente = pagos.reduce(
            (s, x) => (x.tipo === 'cobro' ? s.plus(x.monto) : s.minus(x.monto)),
            CERO,
        )
        const dias = Number(await valorParametro<number>(p.empresa_id, 'cobros_liquidar_dias', hoy, cliente))
        const diferencia = dec(saldo.saldo).minus(pendiente)
        salida.push({
            proveedor_cobro_id: p.id,
            empresa_id: p.empresa_id,
            metodo: p.metodo,
            codigo: p.codigo,
            nombre: p.nombre,
            cuenta_codigo: p.cuenta_codigo,
            saldo_libro: aTexto(saldo.saldo),
            pendiente: aTexto(pendiente),
            diferencia: aTexto(diferencia),
            cuadra: diferencia.isZero(),
            dias_limite: dias,
            pagos,
            anomalias: pagos.filter((x) => x.tipo === 'cobro' && x.dias > dias),
        })
    }
    return salida
}

export interface LiquidacionVista {
    id: number
    empresa_id: number
    proveedor_cobro_id: number
    proveedor_codigo: string
    proveedor_nombre: string
    fecha: string
    referencia: string
    bruto: string
    comision: string
    neto: string
    cuenta_id: number
    cuenta_codigo: string
    asiento_id: number
    archivo: string | null
    sha256: string | null
    nota: string | null
    registrado_por: number | null
    created_at: Date
    pagos: Array<{ pago_id: number; tipo: 'cobro' | 'contracargo'; monto: string }>
}

function consultaLiquidaciones(cliente: QueryClientContract) {
    return cliente
        .from('ledger.liquidaciones_cobro as l')
        .join('ledger.proveedores_cobro as p', 'p.id', 'l.proveedor_cobro_id')
        .join('ledger.cuentas as c', 'c.id', 'l.cuenta_id')
        .select(
            'l.id',
            'l.empresa_id',
            'l.proveedor_cobro_id',
            'p.codigo as proveedor_codigo',
            'p.nombre as proveedor_nombre',
            cliente.raw(`to_char(l.fecha, 'YYYY-MM-DD') as fecha`),
            'l.referencia',
            'l.bruto',
            'l.comision',
            'l.neto',
            'l.cuenta_id',
            'c.codigo as cuenta_codigo',
            cliente.raw(
                `(SELECT a.id FROM ledger.asientos a WHERE a.origen_tipo = 'liquidacion_cobro' AND a.origen_id = l.id
                   AND a.reversa_de IS NULL ORDER BY a.id LIMIT 1) as asiento_id`,
            ),
            'l.archivo',
            'l.sha256',
            'l.nota',
            'l.registrado_por',
            'l.created_at',
        )
}

async function conPagos(
    cliente: QueryClientContract,
    filas: Array<Omit<LiquidacionVista, 'pagos'>>,
): Promise<LiquidacionVista[]> {
    if (filas.length === 0) return []
    const pagos = (await cliente
        .from('ledger.liquidaciones_pagos')
        .whereIn(
            'liquidacion_id',
            filas.map((f) => f.id),
        )
        .orderBy('id')
        .select('liquidacion_id', 'pago_id', 'tipo', 'monto')) as Array<{
        liquidacion_id: number
        pago_id: number
        tipo: 'cobro' | 'contracargo'
        monto: string
    }>
    return filas.map((f) => ({
        ...f,
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        proveedor_cobro_id: Number(f.proveedor_cobro_id),
        cuenta_id: Number(f.cuenta_id),
        asiento_id: Number(f.asiento_id),
        pagos: pagos
            .filter((p) => Number(p.liquidacion_id) === Number(f.id))
            .map((p) => ({ pago_id: Number(p.pago_id), tipo: p.tipo, monto: p.monto })),
    }))
}

export async function verLiquidacion(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<LiquidacionVista> {
    const fila = await consultaLiquidaciones(cliente).where('l.id', id).first()
    if (!fila) throw new NoEncontrado(`La liquidación ${id} no existe`)
    const [vista] = await conPagos(cliente, [fila])
    return vista!
}

export async function listarLiquidaciones(
    filtros: OpcionesPaginacion & { proveedor_cobro_id?: number; desde?: string; hasta?: string },
    empresas: number[] | null,
) {
    const cliente = db.connection()
    const consulta = consultaLiquidaciones(cliente)
        .if(filtros.proveedor_cobro_id, (q) => q.where('l.proveedor_cobro_id', filtros.proveedor_cobro_id!))
        .if(filtros.desde, (q) => q.where('l.fecha', '>=', filtros.desde!))
        .if(filtros.hasta, (q) => q.where('l.fecha', '<=', filtros.hasta!))
    filtrarPorEmpresa(consulta, empresas, (q, ids) => q.whereIn('l.empresa_id', ids))
    const pagina = await paginar<Omit<LiquidacionVista, 'pagos'>>(consulta, filtros, { columna: 'l.id' })
    return { ...pagina, data: await conPagos(cliente, pagina.data) }
}
