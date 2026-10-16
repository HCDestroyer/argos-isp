import type { Transaccion } from '#shared/domain_action'

/**
 * Desconexión manual de sesiones (`DesconectarSesion`, `DesconectarServicio`).
 *
 * La API no habla con el NAS: emite `sesion.desconexion_solicitada` por outbox en la misma
 * transacción que la auditoría, y `services/coa` (grupo `coa`) manda el Disconnect-Request al
 * `nas_ip` de la sesión y registra el envío y la respuesta en `audit.red` (`coa.fallido` si no hay
 * ACK). La fila de `network.sesiones` la cierra el Stop que manda el NAS al cortar, no esta acción.
 */

export interface SesionDesconectable {
    id: number
    servicio_id: number | null
    nas_ip: string
    acct_session_id: string
    user_ppp: string
    fin: Date | null
}

const COLUMNAS = `id::int AS id, servicio_id::int AS servicio_id, host(nas_ip) AS nas_ip, acct_session_id,
    user_ppp, fin`

/** Sesión bloqueada para la transacción (dos desconexiones simultáneas se serializan). */
export async function bloquearSesion(t: Transaccion, id: number): Promise<SesionDesconectable | null> {
    const { rows } = (await t.trx.rawQuery(
        `SELECT ${COLUMNAS} FROM network.sesiones WHERE id = ? FOR UPDATE`,
        [id],
    )) as { rows: SesionDesconectable[] }
    return rows[0] ?? null
}

/** Sesiones abiertas de un servicio, bloqueadas. */
export async function bloquearSesionesAbiertas(
    t: Transaccion,
    servicioId: number,
): Promise<SesionDesconectable[]> {
    const { rows } = (await t.trx.rawQuery(
        `SELECT ${COLUMNAS} FROM network.sesiones WHERE servicio_id = ? AND fin IS NULL
         ORDER BY inicio FOR UPDATE`,
        [servicioId],
    )) as { rows: SesionDesconectable[] }
    return rows
}

export async function solicitarDesconexion(
    t: Transaccion,
    sesion: SesionDesconectable,
    motivo: string,
): Promise<void> {
    await t.emit('sesion.desconexion_solicitada', {
        sesion_id: sesion.id,
        servicio_id: sesion.servicio_id,
        nas_ip: sesion.nas_ip,
        acct_session_id: sesion.acct_session_id,
        user_ppp: sesion.user_ppp,
        motivo,
    })
}
