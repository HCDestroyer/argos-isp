import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'

/**
 * Fecha de migración de un router al nuevo `aaa` (`network.routers_migracion_aaa`, tabla de A2).
 *
 * Decisión (semana 3, tanda 2, tarea 3): la fecha la **marca el operador** con la acción
 * `routers.marcar_migrado`; no se deriva del primer accounting del NAS. Motivos:
 *
 * - El primer accounting no es el corte: antes del cambio llegan pruebas (`radtest`, un PPPoE de
 *   laboratorio contra ese NAS, un `Accounting-On` al reiniciar con el `aaa` ya configurado como
 *   secundario) y la fecha quedaría antes de la migración real.
 * - Un piloto puede volver atrás y repetirse: con una marca explícita se desmarca (`desde: null`)
 *   y se vuelve a marcar; derivada, la primera prueba fallida la fijaría para siempre.
 * - Queda auditada (quién, cuándo, motivo, `audit.cambios` del valor anterior), como pide la
 *   regla 9 para todo lo que cambia la operación.
 *
 * El primer accounting se sigue mostrando como dato (`primer_accounting`) para que el operador
 * compare. La columna no va en `network.routers` (de A1): la tabla es propia de A2.
 */

export interface MigracionAaaVista {
    router_id: number
    /** Desde cuándo el router usa el nuevo `aaa`; null si no se marcó o se desmarcó */
    aaa_desde: string | null
    motivo: string | null
    /** 0 si nunca se marcó; se manda en `version` al marcar para detectar ediciones cruzadas */
    version: number
    updated_at: string | null
    /** Inicio de la primera sesión registrada de ese router (dato, no la fecha de migración) */
    primer_accounting: string | null
}

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null)

export async function verMigracionAaa(
    routerId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<MigracionAaaVista> {
    const fila = (await cliente
        .from('network.routers as r')
        .leftJoin('network.routers_migracion_aaa as m', 'm.router_id', 'r.id')
        .where('r.id', routerId)
        .select(
            'm.aaa_desde',
            'm.motivo',
            'm.version',
            'm.updated_at',
            cliente.raw(
                '(SELECT min(s.inicio) FROM network.sesiones s WHERE s.router_id = r.id) AS primer_accounting',
            ),
        )
        .first()) as {
        aaa_desde: Date | null
        motivo: string | null
        version: number | null
        updated_at: Date | null
        primer_accounting: Date | null
    } | null
    if (!fila) throw new NoEncontrado(`El router ${routerId} no existe`)
    return {
        router_id: routerId,
        aaa_desde: iso(fila.aaa_desde),
        motivo: fila.motivo,
        version: fila.version ?? 0,
        updated_at: iso(fila.updated_at),
        primer_accounting: iso(fila.primer_accounting),
    }
}
