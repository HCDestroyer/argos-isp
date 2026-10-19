import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import { CERO, aTexto, dec } from '#ledger/dinero'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'

/**
 * Fondos en tránsito (`1.1.11`, contrato de localización fiscal §10.3): depósitos de caja y
 * traslados entre cuentas propias, desde que salen hasta que el extracto del banco de destino
 * los concilia (`ledger.transitos_acreditados`). Lectura.
 *
 * Invariante (check `fondos_transito`): saldo de `1.1.11` de la empresa = Σ depósitos y traslados
 * sin acreditar.
 */

export type TipoTransito = 'deposito' | 'traslado'

export interface DepositoVista {
    id: number
    empresa_id: number
    caja_id: number
    caja_nombre: string
    turno_id: number
    cuenta_id: number
    cuenta_codigo: string
    cuenta_nombre: string
    cuenta_bancaria_id: number | null
    banco_id: number | null
    monto: string
    boleta: string
    fecha: string
    estado: 'en_transito' | 'acreditado'
    acreditado_en: string | null
    registrado_por: number | null
    created_at: Date
}

export interface TrasladoVista {
    id: number
    empresa_id: number
    cuenta_origen_id: number
    cuenta_origen_codigo: string
    cuenta_destino_id: number
    cuenta_destino_codigo: string
    monto: string
    fecha: string
    referencia: string
    estado: 'en_transito' | 'acreditado'
    acreditado_en: string | null
    registrado_por: number | null
    created_at: Date
}

function acreditado(cliente: QueryClientContract, tipo: TipoTransito, alias: string) {
    return cliente.raw(
        `(SELECT to_char(x.fecha, 'YYYY-MM-DD') FROM ledger.transitos_acreditados x
           WHERE x.tipo = '${tipo}' AND x.documento_id = ${alias}.id AND NOT EXISTS (SELECT 1 FROM ledger.transitos_reatribuciones rr WHERE rr.acreditado_id = x.id)) as acreditado_en`,
    )
}

function consultaDepositos(cliente: QueryClientContract) {
    return cliente
        .from('ledger.depositos as d')
        .join('ledger.cajas as cj', 'cj.id', 'd.caja_id')
        .join('ledger.cuentas as c', 'c.id', 'd.cuenta_id')
        .select(
            'd.id',
            'd.empresa_id',
            'd.caja_id',
            'cj.nombre as caja_nombre',
            'd.turno_id',
            'd.cuenta_id',
            'c.codigo as cuenta_codigo',
            'c.nombre as cuenta_nombre',
            'd.cuenta_bancaria_id',
            'd.banco_id',
            'd.monto',
            'd.boleta',
            cliente.raw(`to_char(d.fecha, 'YYYY-MM-DD') as fecha`),
            acreditado(cliente, 'deposito', 'd'),
            'd.registrado_por',
            'd.created_at',
        )
}

function consultaTraslados(cliente: QueryClientContract) {
    return cliente
        .from('ledger.traslados as t')
        .join('ledger.cuentas as co', 'co.id', 't.cuenta_origen_id')
        .join('ledger.cuentas as cd', 'cd.id', 't.cuenta_destino_id')
        .select(
            't.id',
            't.empresa_id',
            't.cuenta_origen_id',
            'co.codigo as cuenta_origen_codigo',
            't.cuenta_destino_id',
            'cd.codigo as cuenta_destino_codigo',
            't.monto',
            cliente.raw(`to_char(t.fecha, 'YYYY-MM-DD') as fecha`),
            't.referencia',
            acreditado(cliente, 'traslado', 't'),
            't.registrado_por',
            't.created_at',
        )
}

function conEstado<T extends { acreditado_en: string | null }>(fila: T) {
    return { ...fila, estado: fila.acreditado_en ? ('acreditado' as const) : ('en_transito' as const) }
}

export async function verDeposito(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = await consultaDepositos(cliente).where('d.id', id).first()
    if (!fila) throw new NoEncontrado(`El depósito ${id} no existe`)
    return conEstado(fila) as DepositoVista
}

export async function verTraslado(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = await consultaTraslados(cliente).where('t.id', id).first()
    if (!fila) throw new NoEncontrado(`El traslado ${id} no existe`)
    return conEstado(fila) as TrasladoVista
}

type FiltrosTransito = OpcionesPaginacion & { estado?: 'en_transito' | 'acreditado' }

function filtrarEstado(tipo: TipoTransito, alias: string, estado: FiltrosTransito['estado']) {
    return (q: { whereRaw: (sql: string) => unknown }) => {
        const existe = `EXISTS (SELECT 1 FROM ledger.transitos_acreditados x WHERE x.tipo = '${tipo}' AND x.documento_id = ${alias}.id AND NOT EXISTS (SELECT 1 FROM ledger.transitos_reatribuciones rr WHERE rr.acreditado_id = x.id))`
        if (estado === 'acreditado') q.whereRaw(existe)
        if (estado === 'en_transito') q.whereRaw(`NOT ${existe}`)
    }
}

export async function listarDepositos(
    filtros: FiltrosTransito & { caja_id?: number; turno_id?: number },
    empresas: number[] | null,
) {
    const consulta = consultaDepositos(db.connection())
    filtrarEstado('deposito', 'd', filtros.estado)(consulta)
    if (filtros.caja_id !== undefined) consulta.where('d.caja_id', filtros.caja_id)
    if (filtros.turno_id !== undefined) consulta.where('d.turno_id', filtros.turno_id)
    filtrarPorEmpresa(consulta, empresas, (q, ids) => q.whereIn('d.empresa_id', ids))
    const pagina = await paginar<DepositoVista>(consulta, filtros, { columna: 'd.id' })
    return { ...pagina, data: pagina.data.map(conEstado) }
}

export async function listarTraslados(filtros: FiltrosTransito, empresas: number[] | null) {
    const consulta = consultaTraslados(db.connection())
    filtrarEstado('traslado', 't', filtros.estado)(consulta)
    filtrarPorEmpresa(consulta, empresas, (q, ids) => q.whereIn('t.empresa_id', ids))
    const pagina = await paginar<TrasladoVista>(consulta, filtros, { columna: 't.id' })
    return { ...pagina, data: pagina.data.map(conEstado) }
}

/** Efectivo depositado al banco desde un turno; baja el esperado del cierre como un egreso. */
export async function depositosDelTurno(cliente: QueryClientContract, turnoId: number): Promise<string> {
    const fila = (await cliente
        .from('ledger.depositos')
        .where('turno_id', turnoId)
        .select(cliente.raw('coalesce(sum(monto), 0)::text as total'))
        .first()) as { total: string }
    return fila.total
}

export interface ResumenTransito {
    empresa_id: number
    /** saldo de 1.1.11 en el libro de la empresa */
    saldo_libro: string
    /** Σ depósitos y traslados sin acreditar */
    pendiente: string
    diferencia: string
    cuadra: boolean
    depositos: number
    traslados: number
}

/** Check `fondos_transito` por empresa (§10.5): 1.1.11 = depósitos y traslados sin conciliar. */
export async function resumenFondosEnTransito(
    empresas: number[] | null,
    cliente: QueryClientContract = db.connection(),
): Promise<ResumenTransito[]> {
    const ids =
        empresas ??
        ((await cliente.from('core.empresas').orderBy('id').select('id')) as Array<{ id: number }>).map((e) =>
            Number(e.id),
        )
    const salida: ResumenTransito[] = []
    for (const empresaId of ids) {
        const libro = (await cliente
            .from('ledger.movimientos as m')
            .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
            .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
            .where('c.codigo', CUENTAS_GT.FONDOS_EN_TRANSITO)
            .where('a.empresa_id', empresaId)
            .select(cliente.raw('coalesce(sum(m.debe - m.haber), 0)::text as saldo'))
            .first()) as { saldo: string }
        const pendientes = (await cliente.rawQuery(
            `SELECT tipo, count(*)::int AS n, coalesce(sum(monto), 0)::text AS monto FROM (
                 SELECT 'deposito' AS tipo, d.monto FROM ledger.depositos d
                  WHERE d.empresa_id = ? AND NOT EXISTS (SELECT 1 FROM ledger.transitos_acreditados x WHERE x.tipo = 'deposito' AND x.documento_id = d.id AND NOT EXISTS (SELECT 1 FROM ledger.transitos_reatribuciones rr WHERE rr.acreditado_id = x.id))
                 UNION ALL
                 SELECT 'traslado', t.monto FROM ledger.traslados t
                  WHERE t.empresa_id = ? AND NOT EXISTS (SELECT 1 FROM ledger.transitos_acreditados x WHERE x.tipo = 'traslado' AND x.documento_id = t.id AND NOT EXISTS (SELECT 1 FROM ledger.transitos_reatribuciones rr WHERE rr.acreditado_id = x.id))
             ) p GROUP BY tipo`,
            [empresaId, empresaId],
        )) as { rows: Array<{ tipo: TipoTransito; n: number; monto: string }> }
        const pendiente = pendientes.rows.reduce((s, f) => s.plus(f.monto), CERO)
        const diferencia = dec(libro.saldo).minus(pendiente)
        if (pendiente.isZero() && dec(libro.saldo).isZero() && empresas === null) continue
        salida.push({
            empresa_id: empresaId,
            saldo_libro: aTexto(libro.saldo),
            pendiente: aTexto(pendiente),
            diferencia: aTexto(diferencia),
            cuadra: diferencia.isZero(),
            depositos: pendientes.rows.find((f) => f.tipo === 'deposito')?.n ?? 0,
            traslados: pendientes.rows.find((f) => f.tipo === 'traslado')?.n ?? 0,
        })
    }
    return salida
}
