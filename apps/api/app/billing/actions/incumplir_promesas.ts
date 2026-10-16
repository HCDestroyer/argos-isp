import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import type { ContextoAccion } from '#shared/contexto'
import IncumplirPromesa from '#billing/actions/incumplir_promesa'
import RegistrarCorrida from '#billing/actions/registrar_corrida'
import { TAMANO_LOTE } from '#billing/actions/generar_facturas'

/**
 * `promesas.incumplir_vencidas` = cron `incumplirPromesas` (cada minuto, con lock): todas las
 * promesas `activa` o `pendiente_aprobacion` con `vence_en <= ahora`, por lotes de 500, cada una
 * en su transacción con `IncumplirPromesa` (activa sin pagar → `incumplida` + `promesa.incumplida`
 * + re-evaluación; pagada → `cumplida`; pendiente → `cancelada`). Repetirla no duplica nada.
 */

export interface EntradaIncumplirPromesas {
    ahora?: Date
    servicio_id?: number
}

export interface ResultadoIncumplirPromesas {
    revisadas: number
    incumplidas: number
    cumplidas: number
    canceladas: number
    errores: number
}

export default class IncumplirPromesas {
    readonly nombre = 'promesas.incumplir_vencidas'

    async execute(input: EntradaIncumplirPromesas, ctx: ContextoAccion): Promise<ResultadoIncumplirPromesas> {
        const ahora = input.ahora ?? new Date()
        const resultado: ResultadoIncumplirPromesas = {
            revisadas: 0,
            incumplidas: 0,
            cumplidas: 0,
            canceladas: 0,
            errores: 0,
        }
        let cursor = 0
        for (;;) {
            const lote = (await db
                .from('billing.promesas')
                .whereIn('estado', ['activa', 'pendiente_aprobacion'])
                .where('vence_en', '<=', ahora)
                .where('id', '>', cursor)
                .if(input.servicio_id, (q) => q.where('servicio_id', input.servicio_id!))
                .orderBy('id', 'asc')
                .limit(TAMANO_LOTE)
                .select('id')) as Array<{ id: number }>
            for (const { id } of lote) {
                resultado.revisadas += 1
                try {
                    const r = await new IncumplirPromesa().execute({ promesa_id: id, ahora }, ctx)
                    if (r.estado === 'incumplida') resultado.incumplidas += 1
                    if (r.estado === 'cumplida') resultado.cumplidas += 1
                    if (r.estado === 'cancelada') resultado.canceladas += 1
                } catch (error) {
                    resultado.errores += 1
                    logger.error(
                        { err: error, promesaId: id, requestId: ctx.requestId },
                        'No se pudo cerrar la promesa',
                    )
                }
            }
            if (lote.length < TAMANO_LOTE) break
            cursor = lote.at(-1)!.id
        }
        // corre cada minuto: solo deja resumen cuando hubo algo que revisar
        if (resultado.revisadas > 0) {
            await new RegistrarCorrida(this.nombre).execute(
                { parametros: { ahora: ahora.toISOString() }, resultado: { ...resultado } },
                ctx,
            )
        }
        return resultado
    }
}
