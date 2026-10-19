import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import { CERO, aTexto, dec, redondear, type Dec } from '#ledger/dinero'

/**
 * Diferidos (contrato de localización fiscal §10.10, fase 5): gastos pagados por anticipado
 * (`1.1.13`, desde una compra: seguros, licencias anuales) e ingresos cobrados por anticipado
 * (`2.1.12`, desde una factura de varios meses). Lectura y cálculo; las acciones
 * (`libro.registrar_diferimiento`, `libro.amortizar_diferidos`) viven en `actions/`.
 *
 * - Cuota mensual = total / meses redondeada; la última completa el total.
 * - El IVA no se difiere: se causa con la factura o la compra.
 * - Saldo de `1.1.13` y `2.1.12` = Σ (total − cuotas) de los diferimientos vigentes.
 */

export function cuotaDiferida(total: Dec, meses: number, numero: number, acumulado: Dec): Dec {
    if (numero >= meses) return total.minus(acumulado)
    const cuota = redondear(total.div(meses))
    return cuota.gt(total.minus(acumulado)) ? total.minus(acumulado) : cuota
}

export interface DiferimientoVista {
    id: number
    empresa_id: number
    origen: 'factura' | 'compra'
    factura_id: number | null
    factura_linea_id: number | null
    compra_id: number | null
    compra_linea_id: number | null
    descripcion: string
    cuenta_diferida_codigo: string
    cuenta_destino_codigo: string
    total: string
    inicio: string
    meses: number
    amortizado: string
    pendiente: string
    cuotas: Array<{ mes: string; monto: string; asiento_id: number }>
    estado: 'vigente' | 'amortizado' | 'cancelado'
    registrado_por: number | null
    created_at: Date
}

function consulta(cliente: QueryClientContract) {
    return cliente
        .from('ledger.diferimientos as d')
        .join('ledger.cuentas as cd', 'cd.id', 'd.cuenta_diferida_id')
        .join('ledger.cuentas as cx', 'cx.id', 'd.cuenta_destino_id')
        .leftJoin('ledger.diferimientos_cancelaciones as x', 'x.diferimiento_id', 'd.id')
        .select(
            'd.id',
            'd.empresa_id',
            'd.origen',
            'd.factura_id',
            'd.factura_linea_id',
            'd.compra_id',
            'd.compra_linea_id',
            'd.descripcion',
            'cd.codigo as cuenta_diferida_codigo',
            'cx.codigo as cuenta_destino_codigo',
            'd.total',
            cliente.raw(`to_char(d.inicio, 'YYYY-MM-DD') as inicio`),
            'd.meses',
            cliente.raw('x.id is not null as cancelado'),
            'd.registrado_por',
            'd.created_at',
        )
}

async function completar(cliente: QueryClientContract, filas: Array<Record<string, unknown>>) {
    if (filas.length === 0) return []
    const cuotas = (await cliente
        .from('ledger.diferimientos_cuotas')
        .whereIn(
            'diferimiento_id',
            filas.map((f) => Number(f.id)),
        )
        .orderBy('mes')
        .select(
            'diferimiento_id',
            cliente.raw(`to_char(mes, 'YYYY-MM-DD') as mes`),
            'monto',
            'asiento_id',
        )) as Array<{
        diferimiento_id: number
        mes: string
        monto: string
        asiento_id: number
    }>
    const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
    return filas.map((f): DiferimientoVista => {
        const propias = cuotas.filter((c) => Number(c.diferimiento_id) === Number(f.id))
        const amortizado = propias.reduce((s, c) => s.plus(c.monto), CERO)
        const total = dec(String(f.total))
        return {
            id: Number(f.id),
            empresa_id: Number(f.empresa_id),
            origen: f.origen as 'factura' | 'compra',
            factura_id: n(f.factura_id),
            factura_linea_id: n(f.factura_linea_id),
            compra_id: n(f.compra_id),
            compra_linea_id: n(f.compra_linea_id),
            descripcion: String(f.descripcion),
            cuenta_diferida_codigo: String(f.cuenta_diferida_codigo),
            cuenta_destino_codigo: String(f.cuenta_destino_codigo),
            total: String(f.total),
            inicio: String(f.inicio),
            meses: Number(f.meses),
            amortizado: aTexto(amortizado),
            pendiente: aTexto(f.cancelado ? CERO : total.minus(amortizado)),
            cuotas: propias.map((c) => ({ mes: c.mes, monto: c.monto, asiento_id: Number(c.asiento_id) })),
            estado: f.cancelado ? 'cancelado' : amortizado.gte(total) ? 'amortizado' : 'vigente',
            registrado_por: n(f.registrado_por),
            created_at: f.created_at as Date,
        }
    })
}

export async function verDiferimiento(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await consulta(cliente).where('d.id', id).first()) as Record<string, unknown> | null
    if (!fila) throw new NoEncontrado(`El diferimiento ${id} no existe`)
    const [vista] = await completar(cliente, [fila])
    return vista!
}

export interface FiltrosDiferimientos extends OpcionesPaginacion {
    origen?: 'factura' | 'compra'
    factura_id?: number
    compra_id?: number
}

export async function listarDiferimientos(filtros: FiltrosDiferimientos, empresas: number[] | null) {
    const q = consulta(db.connection())
        .if(filtros.origen, (x) => x.where('d.origen', filtros.origen!))
        .if(filtros.factura_id, (x) => x.where('d.factura_id', filtros.factura_id!))
        .if(filtros.compra_id, (x) => x.where('d.compra_id', filtros.compra_id!))
    filtrarPorEmpresa(q, empresas, (x, ids) => x.whereIn('d.empresa_id', ids))
    const pagina = await paginar<Record<string, unknown>>(q, filtros, { columna: 'd.id' })
    return { data: await completar(db.connection(), pagina.data), nextCursor: pagina.nextCursor }
}

export async function empresaDeDiferimiento(id: number): Promise<{ empresa_id: number }> {
    const fila = await db.from('ledger.diferimientos').where('id', id).select('empresa_id').first()
    if (!fila) throw new NoEncontrado(`El diferimiento ${id} no existe`)
    return { empresa_id: Number(fila.empresa_id) }
}

/** Diferimiento vigente (sin cancelar) de una factura, o null. */
export async function diferimientoDeFactura(cliente: QueryClientContract, facturaId: number) {
    return cliente
        .from('ledger.diferimientos as d')
        .where('d.factura_id', facturaId)
        .whereNotExists((q) =>
            q.from('ledger.diferimientos_cancelaciones as x').whereRaw('x.diferimiento_id = d.id'),
        )
        .select('d.id')
        .first()
}
