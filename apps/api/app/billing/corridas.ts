import db from '@adonisjs/lucid/services/db'
import type { BloqueoCorrida } from '#billing/bloqueos_corrida'

/**
 * Última corrida de los crons de facturación (`facturas.generar`) y mora (`facturas.vencer_pendientes`)
 * por empresa (pedido de A4, fase 6): lo que quedó pendiente por un bloqueo del libro sin correr
 * nada. Lee la fila de `RegistrarCorrida` en `audit.acciones` (su `entrada`: parámetros, resultado
 * y bloqueos).
 *
 * Una corrida cuenta para una empresa si recorrió todas (cron, o un usuario con alcance global sin
 * empresa activa: `parametros.empresas` null o ausente) o si la incluyó. `resultado`, `bloqueos[]` y
 * `bloqueados` son solo de la empresa: los contadores salen de `resultado.por_empresa` que guarda la
 * corrida (A4: antes cada empresa mostraba el total de todas). Una corrida anterior sin
 * `por_empresa` solo da resultado si fue de esa sola empresa; si recorrió varias, `resultado` es null.
 */

export const PROCESOS_CORRIDA = ['facturas.generar', 'facturas.vencer_pendientes'] as const
export type ProcesoCorrida = (typeof PROCESOS_CORRIDA)[number]

export interface CorridaProceso {
    proceso: ProcesoCorrida
    /** null = el proceso no ha corrido para la empresa */
    corrida_en: Date | null
    actor_tipo: string | null
    canal: string | null
    hasta: string | null
    /** documentos de la empresa que no se contabilizaron por un bloqueo (se reintentan) */
    bloqueados: number
    bloqueos: BloqueoCorrida[]
    /**
     * contadores de la empresa (generar: generadas, omitidas, bonificadas, errores, bloqueados;
     * vencer: vencidas, moras, errores, bloqueados) y sus `bloqueos`; null si no se pueden separar
     */
    resultado: Record<string, unknown> | null
}

export interface CorridasEmpresa {
    empresa_id: number
    procesos: CorridaProceso[]
}

interface FilaCorrida {
    accion: ProcesoCorrida
    actor_tipo: string
    canal: string
    created_at: Date
    entrada: {
        parametros?: { hasta?: string; empresas?: number[] | null }
        resultado?: Record<string, unknown> & { por_empresa?: Record<string, Record<string, number>> }
        bloqueos?: BloqueoCorrida[]
    } | null
}

export async function ultimasCorridas(empresas: number[]): Promise<CorridasEmpresa[]> {
    const salida: CorridasEmpresa[] = []
    for (const empresaId of empresas) {
        const procesos: CorridaProceso[] = []
        for (const proceso of PROCESOS_CORRIDA) {
            const fila = (await db
                .from('audit.acciones')
                .where('accion', proceso)
                .where('resultado', 'ok')
                .whereRaw(
                    `(entrada->'parametros'->'empresas' IS NULL
                      OR jsonb_typeof(entrada->'parametros'->'empresas') = 'null'
                      OR entrada->'parametros'->'empresas' @> to_jsonb(?::bigint))`,
                    [empresaId],
                )
                .orderBy('created_at', 'desc')
                .orderBy('id', 'desc')
                .select('accion', 'actor_tipo', 'canal', 'created_at', 'entrada')
                .first()) as FilaCorrida | null
            const bloqueos = (fila?.entrada?.bloqueos ?? []).filter((b) => Number(b.empresa_id) === empresaId)
            const bloqueados = bloqueos.reduce((s, b) => s + Number(b.documentos), 0)
            procesos.push({
                proceso,
                corrida_en: fila?.created_at ?? null,
                actor_tipo: fila?.actor_tipo ?? null,
                canal: fila?.canal ?? null,
                hasta: fila?.entrada?.parametros?.hasta ?? null,
                bloqueados,
                bloqueos,
                resultado: fila ? resultadoDeEmpresa(fila, empresaId, bloqueos, bloqueados) : null,
            })
        }
        salida.push({ empresa_id: empresaId, procesos })
    }
    return salida
}

/** Contadores de la empresa en la corrida, con sus bloqueos. */
function resultadoDeEmpresa(
    fila: FilaCorrida,
    empresaId: number,
    bloqueos: BloqueoCorrida[],
    bloqueados: number,
): Record<string, unknown> | null {
    const resultado = fila.entrada?.resultado
    if (!resultado) return null
    const porEmpresa = resultado.por_empresa
    if (porEmpresa) {
        const ceros =
            fila.accion === 'facturas.generar'
                ? { generadas: 0, omitidas: 0, bonificadas: 0, errores: 0 }
                : { vencidas: 0, moras: 0, errores: 0 }
        return { ...ceros, ...(porEmpresa[String(empresaId)] ?? {}), bloqueados, bloqueos }
    }
    // corrida anterior a `por_empresa`: solo si fue de esta empresa sola
    const empresas = fila.entrada?.parametros?.empresas
    if (Array.isArray(empresas) && empresas.length === 1 && Number(empresas[0]) === empresaId) {
        const contadores = Object.fromEntries(
            Object.entries(resultado).filter(([clave]) => !['facturas', 'bonificaciones'].includes(clave)),
        )
        return { ...contadores, bloqueados, bloqueos }
    }
    return null
}
