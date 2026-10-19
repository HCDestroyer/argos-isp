import { DomainAction, type Transaccion } from '#shared/domain_action'
import { hoyGuatemala } from '#ledger/fechas'
import { bloquearClienteLealtad, vencerLote } from '#lealtad/puntos'

/**
 * `lealtad.vencer` (cron `lealtad:vencer`, §6.1): procesa **todo lo vencido hasta hoy** (no "lo de
 * hoy") de una empresa, por lotes de `limite`:
 *
 * - cada lote con `vence_en <= hoy` y puntos vivos sale con un movimiento `vencimiento` (clave
 *   `vencimiento:lote:<id>`, repetir no duplica) y, si tenía valor, el asiento `2.1.10 / 4.1.06`;
 *   evento `lealtad.puntos_vencidos`;
 * - cada lote vivo que vence dentro de `aviso_vencimiento_dias` de su programa y no se avisó emite
 *   `lealtad.puntos_por_vencer` una sola vez (`lealtad.avisos_vencimiento`).
 *
 * `pendientes` = quedó más por procesar (el cron vuelve a llamar hasta que sea false).
 */

export interface EntradaVencer {
    /**
     * una empresa por ejecución (así la usa `cronVencer`: un periodo cerrado en una no detiene a las
     * demás); sin ella, todas las empresas en la misma transacción
     */
    empresa_id?: number | null
    /** YYYY-MM-DD (Guatemala); por defecto hoy */
    hoy?: string
    limite?: number
}

export interface ResultadoVencer {
    hoy: string
    vencidos: number
    puntos_vencidos: number
    avisados: number
    pendientes: boolean
}

export default class VencerPuntos extends DomainAction<EntradaVencer, ResultadoVencer> {
    readonly nombre = 'lealtad.vencer'

    protected async handle(input: EntradaVencer, t: Transaccion): Promise<ResultadoVencer> {
        const hoy = input.hoy ?? hoyGuatemala()
        const limite = Math.min(Math.max(input.limite ?? 500, 1), 5000)
        const empresaId = input.empresa_id ?? null
        t.fijarEmpresa(empresaId)

        const vencidos = (await t.trx
            .from('lealtad.movimientos as l')
            .leftJoin('lealtad.consumos as c', 'c.lote_id', 'l.id')
            .if(empresaId !== null, (q) => q.where('l.empresa_id', empresaId!))
            .where('l.puntos', '>', 0)
            .whereNotNull('l.vence_en')
            .where('l.vence_en', '<=', hoy)
            .groupBy('l.id')
            .havingRaw('l.puntos - coalesce(sum(c.puntos), 0) > 0')
            .orderBy('l.vence_en', 'asc')
            .orderBy('l.id', 'asc')
            .limit(limite + 1)
            .select('l.id', 'l.empresa_id', 'l.programa_id', 'l.cliente_id', 'l.servicio_id')) as Array<{
            id: number
            empresa_id: number
            programa_id: number
            cliente_id: number
            servicio_id: number | null
        }>
        let procesados = 0
        let puntos = 0
        for (const lote of vencidos.slice(0, limite)) {
            await bloquearClienteLealtad(t.trx, Number(lote.cliente_id))
            const movimiento = await vencerLote(
                t,
                {
                    id: Number(lote.id),
                    empresa_id: Number(lote.empresa_id),
                    programa_id: Number(lote.programa_id),
                    cliente_id: Number(lote.cliente_id),
                    servicio_id: lote.servicio_id === null ? null : Number(lote.servicio_id),
                },
                hoy,
            )
            if (movimiento) {
                procesados++
                puntos += -movimiento.puntos
            }
        }

        const porAvisar = (await t.trx
            .from('lealtad.movimientos as l')
            .join('lealtad.programas as p', 'p.id', 'l.programa_id')
            .leftJoin('lealtad.consumos as c', 'c.lote_id', 'l.id')
            .if(empresaId !== null, (q) => q.where('l.empresa_id', empresaId!))
            .where('l.puntos', '>', 0)
            .whereNotNull('l.vence_en')
            .where('l.vence_en', '>', hoy)
            .whereRaw(`l.vence_en <= ?::date + p.aviso_vencimiento_dias`, [hoy])
            .whereNotExists((q) =>
                q.from('lealtad.avisos_vencimiento as a').whereRaw('a.lote_id = l.id').select(t.trx.raw('1')),
            )
            .groupBy('l.id')
            .havingRaw('l.puntos - coalesce(sum(c.puntos), 0) > 0')
            .orderBy('l.vence_en', 'asc')
            .orderBy('l.id', 'asc')
            .limit(limite + 1)
            .select(
                'l.id',
                'l.empresa_id',
                'l.cliente_id',
                t.trx.raw(`to_char(l.vence_en, 'YYYY-MM-DD') as vence_en`),
                t.trx.raw('(l.puntos - coalesce(sum(c.puntos), 0))::int as restante'),
            )) as Array<{
            id: number
            empresa_id: number
            cliente_id: number
            vence_en: string
            restante: number
        }>
        let avisados = 0
        for (const lote of porAvisar.slice(0, limite)) {
            const insertados = (await t.trx
                .insertQuery()
                .table('lealtad.avisos_vencimiento')
                .insert({
                    lote_id: lote.id,
                    empresa_id: lote.empresa_id,
                    puntos: lote.restante,
                    vence_en: lote.vence_en,
                })
                .knexQuery.onConflict('lote_id')
                .ignore()
                .returning('lote_id')) as Array<{ lote_id: number }>
            if (insertados.length === 0) continue
            await t.emit('lealtad.puntos_por_vencer', {
                empresa_id: Number(lote.empresa_id),
                cliente_id: Number(lote.cliente_id),
                puntos: Number(lote.restante),
                vence_en: lote.vence_en,
                lote_id: Number(lote.id),
            })
            avisados++
        }

        return {
            hoy,
            vencidos: procesados,
            puntos_vencidos: puntos,
            avisados,
            pendientes: vencidos.length > limite || porAvisar.length > limite,
        }
    }
}
