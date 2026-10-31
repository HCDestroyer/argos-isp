import db from '@adonisjs/lucid/services/db'
import type { Transaccion } from '#shared/domain_action'

/**
 * Desconexión manual de sesiones (`DesconectarSesion`, `DesconectarServicio`).
 *
 * La API no habla con el NAS: emite `sesion.desconexion_solicitada` por outbox en la misma
 * transacción que la auditoría, y `services/coa` (grupo `coa`) manda el Disconnect-Request al
 * `nas_ip` de la sesión y registra el envío y la respuesta en `audit.red` (`coa.fallido` si no hay
 * ACK). La fila de `network.sesiones` la cierra el Stop que manda el NAS al cortar, no esta acción.
 * Una sesión de sondeo (router sin RADIUS) lleva `origen: 'sondeo'`: la quita el dispatcher de
 * RouterOS (`/ppp active remove`) y la cierra el siguiente sondeo.
 */

export interface SesionDesconectable {
    id: number
    servicio_id: number | null
    nas_ip: string | null
    acct_session_id: string
    user_ppp: string
    fin: Date | null
    /** `sondeo`: router sin RADIUS; la desconexión la hace el dispatcher de RouterOS, no `coa` */
    origen: 'accounting' | 'sondeo'
}

const COLUMNAS = `id::int AS id, servicio_id::int AS servicio_id, host(nas_ip) AS nas_ip, acct_session_id,
    user_ppp, fin, origen`

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
        // Router sin RADIUS (`contratos/pppoe-local.md` §4): `coa` la ignora y la ejecuta el
        // dispatcher de RouterOS con `/ppp active remove`.
        ...(sesion.origen === 'sondeo' ? { origen: 'sondeo' as const } : {}),
    })
}

/**
 * Sesiones abiertas de un servicio ya eliminado (`servicio.eliminado`, `contratos/eliminar.md`).
 * La fila de `core.servicios` ya no existe y `network.sesiones.servicio_id` tiene FK, así que una
 * sesión viva solo puede ser una que el accounting abrió después del borrado: sin `servicio_id` y
 * con el `user_ppp` que tenía el servicio. Con `t`, bloqueadas para la transacción.
 */
export async function sesionesAbiertasDeEliminado(
    userPpp: string,
    t?: Transaccion,
): Promise<SesionDesconectable[]> {
    const sql = `SELECT ${COLUMNAS} FROM network.sesiones
        WHERE user_ppp = ? AND servicio_id IS NULL AND fin IS NULL ORDER BY inicio`
    const { rows } = (await (t
        ? t.trx.rawQuery(`${sql} FOR UPDATE`, [userPpp])
        : db.rawQuery(sql, [userPpp]))) as {
        rows: SesionDesconectable[]
    }
    return rows
}

/**
 * `user_ppp` que tenía un servicio eliminado: el del payload si viene (A1 puede agregarlo) o, si no,
 * el `antes` de `audit.cambios` que `EliminarServicio` deja por cada campo (`user_ppp` → null).
 * null si el servicio no era PPPoE.
 */
export async function userPppDeEliminado(servicioId: number, payload: Record<string, unknown>) {
    if (typeof payload.user_ppp === 'string' && payload.user_ppp !== '') return payload.user_ppp
    const fila = (await db
        .from('audit.cambios')
        .where({ entidad_tipo: 'servicio', entidad_id: servicioId, campo: 'user_ppp' })
        .whereRaw(`despues = 'null'::jsonb`)
        .orderBy('id', 'desc')
        .select(db.raw(`antes #>> '{}' AS user_ppp`))
        .first()) as { user_ppp: string | null } | null
    return fila?.user_ppp || null
}
