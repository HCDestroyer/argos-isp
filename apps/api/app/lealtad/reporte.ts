import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { dec } from '#ledger/dinero'
import { PAIS_PLAN } from '#ledger/plan_cuentas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { finDelDia, inicioDelDia } from '#lealtad/condiciones'

/**
 * Reporte `lealtad` (`GET /reportes/lealtad`, §6 y §11): por empresa, puntos emitidos, canjeados,
 * vencidos, revertidos y ajustados en el periodo (con su valor), y al día de hoy el pasivo: la
 * suma del valor vivo de los lotes contra el saldo acreedor de `2.1.10` en el libro. `cuadra` =
 * son iguales (el invariante del contrato; con `diferimiento = false` los dos quedan en cero).
 */

export interface FilaReporteLealtad {
    empresa_id: number
    emitidos: number
    valor_emitido: string
    canjeados: number
    vencidos: number
    revertidos: number
    ajustes_negativos: number
    valor_liberado: string
    /** saldo de puntos de todos los clientes de la empresa (Σ movimientos) */
    saldo_puntos: number
    /** puntos vivos en lotes (Σ restante) */
    puntos_vivos: number
    /** Σ valor vivo de los lotes */
    pasivo_lotes: string
    /** saldo acreedor de 2.1.10 en el libro de la empresa */
    pasivo_libro: string
    cuadra: boolean
}

export interface ReporteLealtad {
    desde: string | null
    hasta: string | null
    empresas: FilaReporteLealtad[]
}

/** Saldo de `2.1.10` (haber − debe) por empresa. */
export async function pasivoLibro(
    cliente: QueryClientContract,
    empresas: number[] | null,
): Promise<Map<number, string>> {
    const filas = (await cliente
        .from('ledger.movimientos as m')
        .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
        .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
        .where('c.pais', PAIS_PLAN)
        .where('c.codigo', CUENTAS_GT.PASIVO_LEALTAD)
        .if(empresas !== null, (q) => q.whereIn('a.empresa_id', empresas!))
        .groupBy('a.empresa_id')
        .select('a.empresa_id', cliente.raw('sum(m.haber - m.debe)::text as saldo'))) as Array<{
        empresa_id: number
        saldo: string
    }>
    return new Map(filas.map((f) => [Number(f.empresa_id), dec(f.saldo).toFixed(2)]))
}

/** Σ valor vivo de los lotes y Σ puntos vivos por empresa. */
export async function pasivoLotes(
    cliente: QueryClientContract,
    empresas: number[] | null,
): Promise<Map<number, { valor: string; puntos: number }>> {
    const filas = (await cliente
        .from(
            cliente
                .from('lealtad.movimientos as l')
                .leftJoin('lealtad.consumos as c', 'c.lote_id', 'l.id')
                .where('l.puntos', '>', 0)
                .if(empresas !== null, (q) => q.whereIn('l.empresa_id', empresas!))
                .groupBy('l.id')
                .select(
                    'l.empresa_id',
                    cliente.raw('l.valor - coalesce(sum(c.valor), 0) as vivo'),
                    cliente.raw('l.puntos - coalesce(sum(c.puntos), 0) as restante'),
                )
                .as('x'),
        )
        .groupBy('x.empresa_id')
        .select(
            'x.empresa_id',
            cliente.raw('sum(x.vivo)::text as valor'),
            cliente.raw('sum(x.restante)::int as puntos'),
        )) as Array<{ empresa_id: number; valor: string; puntos: number }>
    return new Map(
        filas.map((f) => [
            Number(f.empresa_id),
            { valor: dec(f.valor).toFixed(2), puntos: Number(f.puntos) },
        ]),
    )
}

export async function reporteLealtad(
    empresas: number[] | null,
    desde: string | null,
    hasta: string | null,
): Promise<ReporteLealtad> {
    const flujos = (await db
        .from('lealtad.movimientos as m')
        .if(empresas !== null, (q) => q.whereIn('m.empresa_id', empresas!))
        .if(desde !== null, (q) => q.where('m.created_at', '>=', inicioDelDia(desde!)))
        .if(hasta !== null, (q) => q.where('m.created_at', '<', finDelDia(hasta!)))
        .groupBy('m.empresa_id')
        .select(
            'm.empresa_id',
            db.raw('coalesce(sum(m.puntos) filter (where m.puntos > 0), 0)::int as emitidos'),
            db.raw('coalesce(sum(m.valor) filter (where m.puntos > 0), 0)::text as valor_emitido'),
            db.raw(`coalesce(-sum(m.puntos) filter (where m.tipo = 'canje'), 0)::int as canjeados`),
            db.raw(`coalesce(-sum(m.puntos) filter (where m.tipo = 'vencimiento'), 0)::int as vencidos`),
            db.raw(
                `coalesce(-sum(m.puntos) filter (where m.tipo = 'reverso' and m.puntos < 0), 0)::int as revertidos`,
            ),
            db.raw(
                `coalesce(-sum(m.puntos) filter (where m.tipo = 'ajuste' and m.puntos < 0), 0)::int as ajustes_negativos`,
            ),
            db.raw('coalesce(sum(m.valor) filter (where m.puntos < 0), 0)::text as valor_liberado'),
        )) as Array<Record<string, any>>
    const saldos = (await db
        .from('lealtad.movimientos')
        .if(empresas !== null, (q) => q.whereIn('empresa_id', empresas!))
        .groupBy('empresa_id')
        .select('empresa_id', db.raw('sum(puntos)::int as saldo'))) as Array<{
        empresa_id: number
        saldo: number
    }>
    const libro = await pasivoLibro(db.connection(), empresas)
    const lotes = await pasivoLotes(db.connection(), empresas)

    const ids = new Set<number>([
        ...flujos.map((f) => Number(f.empresa_id)),
        ...saldos.map((f) => Number(f.empresa_id)),
        ...libro.keys(),
    ])
    const porEmpresa = new Map(flujos.map((f) => [Number(f.empresa_id), f]))
    const saldoDe = new Map(saldos.map((s) => [Number(s.empresa_id), Number(s.saldo)]))
    const filas: FilaReporteLealtad[] = [...ids]
        .sort((a, b) => a - b)
        .map((empresaId) => {
            const f = porEmpresa.get(empresaId)
            const pasivo = lotes.get(empresaId)?.valor ?? '0.00'
            const enLibro = libro.get(empresaId) ?? '0.00'
            return {
                empresa_id: empresaId,
                emitidos: Number(f?.emitidos ?? 0),
                valor_emitido: dec(f?.valor_emitido ?? '0').toFixed(2),
                canjeados: Number(f?.canjeados ?? 0),
                vencidos: Number(f?.vencidos ?? 0),
                revertidos: Number(f?.revertidos ?? 0),
                ajustes_negativos: Number(f?.ajustes_negativos ?? 0),
                valor_liberado: dec(f?.valor_liberado ?? '0').toFixed(2),
                saldo_puntos: saldoDe.get(empresaId) ?? 0,
                puntos_vivos: lotes.get(empresaId)?.puntos ?? 0,
                pasivo_lotes: pasivo,
                pasivo_libro: enLibro,
                cuadra: dec(pasivo).equals(dec(enLibro)),
            }
        })
    return { desde, hasta, empresas: filas }
}
