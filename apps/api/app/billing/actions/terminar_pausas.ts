import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import type { ContextoAccion } from '#shared/contexto'
import RegistrarCorrida from '#billing/actions/registrar_corrida'
import { hoyGuatemala } from '#ledger/fechas'
import TerminarPausa from '#billing/actions/terminar_pausa'

/**
 * `servicios.terminar_pausas` (cron `pausas` del `billing:worker`, decisión del PM 16): procesa **todo
 * lo pendiente hasta ahora**, por lotes de 500:
 *
 * - pausas activas con `hasta` ≤ hoy (Guatemala) → `TerminarPausa` (`vencida`): el servicio se
 *   reactiva solo y `evaluarEstadoServicio` decide si vuelve a limitarse o cortarse por deuda;
 * - pausas activas de servicios que alguien reactivó o retiró por otro camino → se cierran
 *   (`reactivado` / `retirado`), así dejan de saltarse periodos.
 *
 * Como `IncumplirPromesas`, no abre una transacción propia: cada pausa va en la suya (`TerminarPausa`,
 * auditada) y una que falla no detiene las demás. Solo deja su corrida (`RegistrarCorrida`) si terminó
 * alguna o hubo errores.
 */

export interface EntradaTerminarPausas {
    /** día de Guatemala que cuenta como hoy (pruebas); por defecto el real */
    hoy?: string
}

export interface ResultadoTerminarPausas {
    hoy: string
    terminadas: number[]
    errores: number
}

const LOTE = 500

export default class TerminarPausas {
    readonly nombre = 'servicios.terminar_pausas'

    async execute(input: EntradaTerminarPausas, ctx: ContextoAccion): Promise<ResultadoTerminarPausas> {
        const hoy = input.hoy ?? hoyGuatemala()
        const resultado: ResultadoTerminarPausas = { hoy, terminadas: [], errores: 0 }
        let cursor = 0
        for (;;) {
            const lote = (await db
                .from('billing.pausas_servicio as p')
                .join('core.servicios as s', 's.id', 'p.servicio_id')
                .where('p.estado', 'activa')
                .where('p.id', '>', cursor)
                .where((q) =>
                    q
                        .where('p.hasta', '<=', hoy)
                        .orWhere('s.suspension_manual', false)
                        .orWhere('s.estado', 'retirado'),
                )
                .orderBy('p.id', 'asc')
                .limit(LOTE)
                .select('p.id', 'p.servicio_id', db.raw(`(p.hasta <= ?::date) as vencida`, [hoy]))) as Array<{
                id: number
                servicio_id: number
                vencida: boolean
            }>
            if (lote.length === 0) break
            cursor = Number(lote.at(-1)!.id)
            for (const fila of lote) {
                try {
                    const pausa = await new TerminarPausa().execute(
                        {
                            servicio_id: Number(fila.servicio_id),
                            fin_motivo: fila.vencida ? 'vencida' : 'manual',
                        },
                        ctx,
                    )
                    resultado.terminadas.push(pausa.id)
                } catch (error) {
                    resultado.errores += 1
                    logger.warn(
                        { err: error, pausaId: fila.id, requestId: ctx.requestId },
                        'No se pudo terminar la pausa sin cobro',
                    )
                }
            }
        }
        if (resultado.terminadas.length > 0 || resultado.errores > 0) {
            await new RegistrarCorrida(this.nombre).execute(
                { parametros: { hoy }, resultado: { ...resultado } },
                ctx,
            )
        }
        return resultado
    }
}
