import type { ContextoAccion } from '#shared/contexto'
import { hoyGuatemala } from '#ledger/fechas'
import OtorgarAntiguedad from '#lealtad/actions/otorgar_antiguedad'
import VencerPuntos from '#lealtad/actions/vencer_puntos'
import db from '@adonisjs/lucid/services/db'

/**
 * Crons del programa de lealtad (`contratos/lealtad.md` §4 y §6.1). Los agenda y les pone lock el
 * worker de facturación (`#billing/jobs`, `node ace billing:worker`); aquí solo se recorre lo
 * pendiente hasta hoy por lotes y se llaman las acciones (regla 1).
 */

/** `lealtad:vencer`: vence lo vencido hasta hoy y avisa lo que vence pronto, por lotes de 500. */
export async function cronVencer(ctx: ContextoAccion, ahora: Date = new Date()) {
    const hoy = hoyGuatemala(ahora)
    let vencidos = 0
    let avisados = 0
    for (let vuelta = 0; vuelta < 1000; vuelta++) {
        const salida = await new VencerPuntos().execute({ hoy, limite: 500 }, ctx)
        vencidos += salida.vencidos
        avisados += salida.avisados
        if (!salida.pendientes) break
    }
    return { hoy, vencidos, avisados }
}

/** `lealtad:antiguedad`: aniversarios pendientes hasta hoy de cada empresa con programa activo. */
export async function cronAntiguedad(ctx: ContextoAccion, ahora: Date = new Date()) {
    const hoy = hoyGuatemala(ahora)
    const empresas = (await db
        .from('lealtad.programas')
        .where('activo', true)
        .orderBy('empresa_id', 'asc')
        .select('empresa_id')) as Array<{ empresa_id: number }>
    let otorgados = 0
    for (const { empresa_id: empresaId } of empresas) {
        let despuesDe = 0
        for (let vuelta = 0; vuelta < 10_000; vuelta++) {
            const salida = await new OtorgarAntiguedad().execute(
                { empresa_id: Number(empresaId), hoy, despues_de: despuesDe, limite: 500 },
                ctx,
            )
            otorgados += salida.otorgados.length
            if (!salida.pendientes) break
            despuesDe = salida.ultimo_servicio_id
        }
    }
    return { hoy, empresas: empresas.length, otorgados }
}
