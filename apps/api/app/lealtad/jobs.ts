import db from '@adonisjs/lucid/services/db'
import type { ContextoAccion } from '#shared/contexto'
import { hoyGuatemala } from '#ledger/fechas'
import RegistrarCorrida from '#billing/actions/registrar_corrida'
import OtorgarAntiguedad from '#lealtad/actions/otorgar_antiguedad'
import VencerPuntos from '#lealtad/actions/vencer_puntos'

/**
 * Crons del programa de lealtad (`contratos/lealtad.md` §4 y §6.1). Los agenda y les pone lock el
 * worker de facturación (`#billing/jobs`, `node ace billing:worker`); aquí solo se recorre lo
 * pendiente hasta hoy por empresa y por lotes, y se llaman las acciones (regla 1).
 *
 * Una empresa que falla (p. ej. su asiento cae en un periodo cerrado: 422 `periodo_cerrado`) no
 * detiene la corrida: su error queda auditado por la acción, la empresa se anota en `fallidas` y se
 * sigue con las demás. La corrida completa queda en `audit.acciones` (`RegistrarCorrida`, con el
 * nombre del cron) y se vuelve a intentar en el siguiente disparo.
 */

export interface FallaEmpresa {
    empresa_id: number
    error: string
}

function describir(error: unknown): string {
    if (error instanceof Error) {
        const codigo = (error as { code?: unknown }).code
        return typeof codigo === 'string' ? `${codigo}: ${error.message}` : error.message
    }
    return String(error)
}

/** `lealtad:vencer`: vence lo vencido hasta hoy y avisa lo que vence pronto, por empresa y lotes de 500. */
export async function cronVencer(ctx: ContextoAccion, ahora: Date = new Date()) {
    const hoy = hoyGuatemala(ahora)
    const empresas = (await db
        .from('lealtad.movimientos')
        .where('puntos', '>', 0)
        .whereNotNull('vence_en')
        .distinct('empresa_id')
        .orderBy('empresa_id', 'asc')) as Array<{ empresa_id: number }>
    const porEmpresa: Array<{ empresa_id: number; vencidos: number; avisados: number }> = []
    const fallidas: FallaEmpresa[] = []
    for (const { empresa_id: id } of empresas) {
        const empresaId = Number(id)
        const fila = { empresa_id: empresaId, vencidos: 0, avisados: 0 }
        try {
            for (let vuelta = 0; vuelta < 1000; vuelta++) {
                const salida = await new VencerPuntos().execute(
                    { empresa_id: empresaId, hoy, limite: 500 },
                    ctx,
                )
                fila.vencidos += salida.vencidos
                fila.avisados += salida.avisados
                if (!salida.pendientes) break
            }
            porEmpresa.push(fila)
        } catch (error) {
            fallidas.push({ empresa_id: empresaId, error: describir(error) })
        }
    }
    const resultado = {
        hoy,
        vencidos: porEmpresa.reduce((n, f) => n + f.vencidos, 0),
        avisados: porEmpresa.reduce((n, f) => n + f.avisados, 0),
        empresas: porEmpresa,
        fallidas,
    }
    await new RegistrarCorrida('lealtad.vencer').execute({ parametros: { hoy }, resultado }, ctx)
    return resultado
}

/** `lealtad:antiguedad`: aniversarios pendientes hasta hoy de cada empresa con programa activo. */
export async function cronAntiguedad(ctx: ContextoAccion, ahora: Date = new Date()) {
    const hoy = hoyGuatemala(ahora)
    const empresas = (await db
        .from('lealtad.programas')
        .where('activo', true)
        .orderBy('empresa_id', 'asc')
        .select('empresa_id')) as Array<{ empresa_id: number }>
    const porEmpresa: Array<{ empresa_id: number; otorgados: number }> = []
    const fallidas: FallaEmpresa[] = []
    for (const { empresa_id: id } of empresas) {
        const empresaId = Number(id)
        let otorgados = 0
        let despuesDe = 0
        try {
            for (let vuelta = 0; vuelta < 10_000; vuelta++) {
                const salida = await new OtorgarAntiguedad().execute(
                    { empresa_id: empresaId, hoy, despues_de: despuesDe, limite: 500 },
                    ctx,
                )
                otorgados += salida.otorgados.length
                if (!salida.pendientes) break
                despuesDe = salida.ultimo_servicio_id
            }
            porEmpresa.push({ empresa_id: empresaId, otorgados })
        } catch (error) {
            fallidas.push({ empresa_id: empresaId, error: describir(error) })
        }
    }
    const resultado = {
        hoy,
        otorgados: porEmpresa.reduce((n, f) => n + f.otorgados, 0),
        empresas: porEmpresa,
        fallidas,
    }
    await new RegistrarCorrida('lealtad.otorgar_antiguedad').execute({ parametros: { hoy }, resultado }, ctx)
    return resultado
}
