import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'

/**
 * Horas de corte: la `hora_corte` de la plantilla de cada servicio, o la de su excepción
 * (`core.servicios_excepciones`, campo `hora_corte`). Fuente única para `EjecutarCorte` (A3) y la
 * vigilancia de crons de notify (A6).
 */

/** Hora de corte efectiva (HH:MM, Guatemala) del servicio `s` con plantilla `p` y excepción `e`. */
export const HORA_CORTE_EFECTIVA = `coalesce(left(e.valor #>> '{}', 5), to_char(p.hora_corte, 'HH24:MI'))`

/** Servicios vigentes (activo, limitado, suspendido) con su plantilla y excepción de hora. */
export function serviciosConHoraCorte(cliente: QueryClientContract = db.connection()) {
    return cliente
        .from('core.servicios as s')
        .join('billing.plantillas_facturacion as p', 'p.id', 's.plantilla_facturacion_id')
        .joinRaw(`LEFT JOIN core.servicios_excepciones e ON e.servicio_id = s.id AND e.campo = 'hora_corte'`)
        .whereIn('s.estado', ['activo', 'limitado', 'suspendido'])
}

/**
 * Horas de corte distintas (HH:MM, ordenadas) de los servicios vigentes que ya llegaron, es decir
 * `<= hasta` (HH:MM de Guatemala). Con `hasta = '23:59'`, todas las del día. Solo lectura.
 */
export async function horasDeCorte(
    hasta: string,
    cliente: QueryClientContract = db.connection(),
): Promise<string[]> {
    const filas = (await serviciosConHoraCorte(cliente)
        .whereRaw(`${HORA_CORTE_EFECTIVA} <= ?`, [hasta])
        .select(cliente.raw(`${HORA_CORTE_EFECTIVA} as hora`))
        .groupByRaw(HORA_CORTE_EFECTIVA)
        .orderBy('hora', 'asc')) as Array<{ hora: string }>
    return filas.map((f) => f.hora)
}
