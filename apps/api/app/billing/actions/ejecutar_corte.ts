import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import type { ContextoAccion } from '#shared/contexto'
import { ZONA_NEGOCIO } from '#ledger/fechas'
import EvaluarEstadoServicio from '#billing/actions/evaluar_estado_servicio'
import VencerFacturas, { type ResultadoVencimiento } from '#billing/actions/vencer_facturas'
import RegistrarCorrida from '#billing/actions/registrar_corrida'
import { TAMANO_LOTE } from '#billing/actions/generar_facturas'
import { HORA_CORTE_EFECTIVA, serviciosConHoraCorte } from '#billing/cortes'

/**
 * `servicios.corte` (cron de corte, cada minuto, y `POST /facturas/corte`): a la `hora_corte`
 * de cada plantilla (o de la excepción del servicio) evalúa todos sus servicios con
 * `evaluarEstadoServicio`.
 *
 * - "Todo lo pendiente hasta ahora": procesa cada hora de corte del día que ya pasó y no está en
 *   `billing.cortes_ejecutados`. Si el worker estuvo caído a las 08:00, corre al volver.
 * - Antes de evaluar, vence lo pendiente del día (`vencerFacturas`), así el corte nunca usa un
 *   vencimiento atrasado.
 * - Con `servicio_id` (o `ignorar_hora`) es un corte manual: evalúa sin mirar ni registrar
 *   `cortes_ejecutados`. `ignorar_hora` además deja bajar de estado antes de la hora.
 */

export interface EntradaCorte {
    ahora?: Date
    servicio_id?: number
    ignorar_hora?: boolean
}

export interface ResultadoCorte {
    /** horas de corte procesadas (HH:MM) */
    horas: string[]
    evaluados: number
    cambiados: number
    errores: number
    vencimiento: ResultadoVencimiento | null
}

export default class EjecutarCorte {
    readonly nombre = 'servicios.corte'

    async execute(input: EntradaCorte, ctx: ContextoAccion): Promise<ResultadoCorte> {
        const ahora = input.ahora ?? new Date()
        const local = DateTime.fromJSDate(ahora).setZone(ZONA_NEGOCIO)
        const hoy = local.toISODate()!
        const hora = local.toFormat('HH:mm')
        const manual = Boolean(input.servicio_id) || Boolean(input.ignorar_hora)

        const horas = manual ? ['*'] : await this.horasPendientes(hoy, hora)
        const resultado: ResultadoCorte = {
            horas: [],
            evaluados: 0,
            cambiados: 0,
            errores: 0,
            vencimiento: null,
        }
        if (horas.length === 0) return resultado

        resultado.vencimiento = await new VencerFacturas().execute(
            { hasta: hoy, servicio_id: input.servicio_id },
            ctx,
        )

        for (const horaCorte of horas) {
            const antes = { evaluados: resultado.evaluados, cambiados: resultado.cambiados }
            let cursor = 0
            for (;;) {
                const lote = (await serviciosConHoraCorte()
                    .where('s.id', '>', cursor)
                    .if(horaCorte !== '*', (q) => q.whereRaw(`${HORA_CORTE_EFECTIVA} = ?`, [horaCorte]))
                    .if(input.servicio_id, (q) => q.where('s.id', input.servicio_id!))
                    .orderBy('s.id', 'asc')
                    .limit(TAMANO_LOTE)
                    .select('s.id')) as Array<{ id: number }>
                for (const { id } of lote) {
                    try {
                        const r = await new EvaluarEstadoServicio().execute(
                            { servicio_id: id, ahora, ignorarHoraCorte: input.ignorar_hora ?? false },
                            ctx,
                        )
                        resultado.evaluados += 1
                        if (r.cambiado) resultado.cambiados += 1
                    } catch (error) {
                        resultado.errores += 1
                        logger.error(
                            { err: error, servicioId: id, requestId: ctx.requestId },
                            'Falló el corte',
                        )
                    }
                }
                if (lote.length < TAMANO_LOTE) break
                cursor = lote.at(-1)!.id
            }
            resultado.horas.push(horaCorte)
            if (!manual) {
                await db
                    .knexQuery()
                    .table('billing.cortes_ejecutados')
                    .insert({
                        clave: `${hoy} ${horaCorte}`,
                        evaluados: resultado.evaluados - antes.evaluados,
                        cambiados: resultado.cambiados - antes.cambiados,
                    })
                    .onConflict('clave')
                    .ignore()
            }
        }

        await new RegistrarCorrida(this.nombre).execute(
            {
                parametros: {
                    ahora: ahora.toISOString(),
                    servicio_id: input.servicio_id ?? null,
                    ignorar_hora: input.ignorar_hora ?? false,
                },
                resultado: { ...resultado },
            },
            ctx,
        )
        return resultado
    }

    /** Horas de corte de hoy que ya llegaron y no se han procesado. */
    private async horasPendientes(hoy: string, hora: string): Promise<string[]> {
        const filas = (await serviciosConHoraCorte()
            .whereRaw(`${HORA_CORTE_EFECTIVA} <= ?`, [hora])
            .whereRaw(
                `NOT EXISTS (SELECT 1 FROM billing.cortes_ejecutados c WHERE c.clave = ? || ' ' || ${HORA_CORTE_EFECTIVA})`,
                [hoy],
            )
            .select(db.raw(`${HORA_CORTE_EFECTIVA} as hora`))
            .groupByRaw(HORA_CORTE_EFECTIVA)
            .orderBy('hora', 'asc')) as Array<{ hora: string }>
        return filas.map((f) => f.hora)
    }
}
