import type { Transaccion } from '#shared/domain_action'
import type { RegistroAccounting } from '#network/sesiones/registro'

/**
 * Escritura de `network.sesiones` compartida por las acciones de accounting
 * (`actions/iniciar_sesion.ts`, `actualizar_sesion.ts`, `terminar_sesion.ts`, `cerrar_sesiones_nas.ts`).
 *
 * Reglas comunes:
 * - La sesión se identifica por `(nas_ip, acct_session_id)` (UNIQUE en la tabla).
 * - Los paquetes pueden llegar repetidos o desordenados (el NAS reintenta, el worker corre en
 *   paralelo): un Interim sin Start abre la sesión; un Stop sin Start la crea ya cerrada; un Start
 *   o Interim tardío sobre una sesión cerrada no la reabre.
 * - `sesion.iniciada` se emite una vez, cuando se crea la fila abierta; `sesion.terminada` una vez,
 *   cuando la fila pasa a cerrada.
 * - Prefijo delegado: RouterOS 7.24.5 no manda `Delegated-IPv6-Prefix` en accounting. En modo
 *   `radius_servicio` el prefijo es el que `aaa` entregó, así que se toma de la asignación vigente
 *   (`network.ipv6_asignaciones`); lo mismo con el /64 si el NAS no lo reporta. En `radius_pool`
 *   vale lo que reporte el NAS y, si no reporta el /56, lo completa `CompletarPrefijoDelegado`
 *   leyéndolo del router (`actions/completar_prefijo_delegado.ts`).
 */

export interface FilaSesion {
    id: number
    servicio_id: number | null
    router_id: number | null
    nas_ip: string
    acct_session_id: string
    user_ppp: string
    ipv4: string | null
    prefijo_enlace_v6: string | null
    prefijo_delegado_v6: string | null
    inicio: Date
    fin: Date | null
}

/** `rawQuery` con valores que pueden ser null (knex los acepta; sus tipos no). */
function consulta(t: Transaccion, sql: string, valores: unknown[]): Promise<unknown> {
    return t.trx.rawQuery(sql, valores as never)
}

const COLUMNAS = `id, servicio_id::int AS servicio_id, router_id::int AS router_id, host(nas_ip) AS nas_ip,
    acct_session_id, user_ppp, host(ipv4) AS ipv4, prefijo_enlace_v6::text AS prefijo_enlace_v6,
    prefijo_delegado_v6::text AS prefijo_delegado_v6, inicio, fin`

/** Causa con la que se cierra una sesión vieja del mismo usuario al abrir otra. */
export const CAUSA_REEMPLAZADA = 'Sesion-Reemplazada'

export interface Contexto {
    servicioId: number | null
    routerId: number | null
    prefijoEnlace: string | null
    prefijoDelegado: string | null
}

/** Servicio (por `user_ppp`), router (por `nas_ip`) y prefijos IPv6 con el respaldo de la asignación. */
export async function resolverContexto(t: Transaccion, r: RegistroAccounting): Promise<Contexto> {
    const servicio = (await t.trx
        .from('core.servicios')
        .where('user_ppp', r.user_ppp)
        .select('id', 'ipv6_modo')
        .first()) as { id: number | string; ipv6_modo: string } | null
    const router = (await t.trx
        .from('network.routers')
        .whereRaw('nas_ip = ?::inet', [r.nas_ip])
        .select('id')
        .first()) as { id: number | string } | null

    let prefijoEnlace = r.prefijo_enlace_v6
    let prefijoDelegado = r.prefijo_delegado_v6
    if (servicio && servicio.ipv6_modo === 'radius_servicio' && (!prefijoEnlace || !prefijoDelegado)) {
        const { rows } = (await consulta(
            t,
            `SELECT tipo, prefijo::text AS prefijo FROM network.ipv6_asignaciones
             WHERE servicio_id = ? AND fin IS NULL`,
            [servicio.id],
        )) as { rows: Array<{ tipo: 'enlace' | 'delegacion'; prefijo: string }> }
        prefijoEnlace ??= rows.find((f) => f.tipo === 'enlace')?.prefijo ?? null
        prefijoDelegado ??= rows.find((f) => f.tipo === 'delegacion')?.prefijo ?? null
    }
    return {
        servicioId: servicio ? Number(servicio.id) : null,
        routerId: router ? Number(router.id) : null,
        prefijoEnlace,
        prefijoDelegado,
    }
}

export async function buscarSesion(
    t: Transaccion,
    nasIp: string,
    acctSessionId: string,
): Promise<FilaSesion | null> {
    const { rows } = (await consulta(
        t,
        `SELECT ${COLUMNAS} FROM network.sesiones
         WHERE nas_ip = ?::inet AND acct_session_id = ? FOR UPDATE`,
        [nasIp, acctSessionId],
    )) as { rows: FilaSesion[] }
    return rows[0] ?? null
}

/** `inicio` de una sesión que se conoce a mitad (Interim) o al final (Stop): evento − duración. */
export function inicioEstimado(r: RegistroAccounting): string {
    const ms = new Date(r.evento_en).getTime() - (r.duracion_s ?? 0) * 1000
    return new Date(ms).toISOString()
}

/**
 * Inserta la sesión (abierta, o cerrada si `fin`). Si `(nas_ip, acct_session_id)` ya existe no
 * inserta y devuelve null. `network(...)` normaliza un prefijo con bits de host.
 */
export async function insertarSesion(
    t: Transaccion,
    r: RegistroAccounting,
    ctx: Contexto,
    datos: { inicio: string; fin?: string; causaFin?: string | null },
): Promise<FilaSesion | null> {
    const { rows } = (await consulta(
        t,
        `INSERT INTO network.sesiones (servicio_id, router_id, nas_ip, acct_session_id, user_ppp, ipv4,
             prefijo_enlace_v6, prefijo_delegado_v6, inicio, fin, bytes_in, bytes_out, causa_fin)
         VALUES (?, ?, ?::inet, ?, ?, ?::inet, network(?::inet)::cidr, network(?::inet)::cidr, ?, ?, ?, ?, ?)
         ON CONFLICT (nas_ip, acct_session_id) DO NOTHING
         RETURNING ${COLUMNAS}`,
        [
            ctx.servicioId,
            ctx.routerId,
            r.nas_ip,
            r.acct_session_id,
            r.user_ppp,
            r.ipv4,
            ctx.prefijoEnlace,
            ctx.prefijoDelegado,
            datos.inicio,
            datos.fin ?? null,
            r.bytes_in,
            r.bytes_out,
            datos.causaFin ?? null,
        ],
    )) as { rows: FilaSesion[] }
    return rows[0] ?? null
}

/**
 * Un `acct_session_id` que el NAS reutiliza (p. ej. tras reiniciar) choca con una sesión cerrada
 * vieja. Se le cambia el id a `<id>~<fila>` para conservar el historial y liberar la clave única.
 */
export async function archivarSesionCerrada(t: Transaccion, sesion: FilaSesion): Promise<void> {
    await consulta(
        t,
        `UPDATE network.sesiones SET acct_session_id = acct_session_id || '~' || id::text, updated_at = now()
         WHERE id = ?`,
        [sesion.id],
    )
}

/** Actualiza contadores y datos de red de una sesión abierta (los valores nulos no borran nada). */
export async function actualizarSesionAbierta(
    t: Transaccion,
    id: number,
    r: RegistroAccounting,
    ctx: Contexto,
    cierre?: { fin: string; causa: string | null },
): Promise<FilaSesion> {
    const { rows } = (await consulta(
        t,
        `UPDATE network.sesiones SET
             servicio_id = COALESCE(servicio_id, ?),
             router_id = COALESCE(router_id, ?),
             ipv4 = COALESCE(?::inet, ipv4),
             prefijo_enlace_v6 = COALESCE(network(?::inet)::cidr, prefijo_enlace_v6),
             prefijo_delegado_v6 = COALESCE(network(?::inet)::cidr, prefijo_delegado_v6),
             bytes_in = GREATEST(bytes_in, ?::bigint),
             bytes_out = GREATEST(bytes_out, ?::bigint),
             fin = CASE WHEN ?::timestamptz IS NULL THEN fin ELSE GREATEST(inicio, ?::timestamptz) END,
             causa_fin = COALESCE(?, causa_fin),
             updated_at = now()
         WHERE id = ?
         RETURNING ${COLUMNAS}`,
        [
            ctx.servicioId,
            ctx.routerId,
            r.ipv4,
            ctx.prefijoEnlace,
            ctx.prefijoDelegado,
            r.bytes_in,
            r.bytes_out,
            cierre?.fin ?? null,
            cierre?.fin ?? null,
            cierre?.causa ?? null,
            id,
        ],
    )) as { rows: FilaSesion[] }
    return rows[0]!
}

/**
 * Cierra las sesiones abiertas que cumplan `filtro` (SQL con `?`), con `fin` = `finEn` (nunca antes
 * de su `inicio`). Devuelve las filas cerradas para emitir `sesion.terminada`.
 */
export async function cerrarSesiones(
    t: Transaccion,
    filtro: { sql: string; valores: unknown[] },
    finEn: string,
    causa: string,
): Promise<FilaSesion[]> {
    const { rows } = (await consulta(
        t,
        `UPDATE network.sesiones SET fin = GREATEST(inicio, ?::timestamptz), causa_fin = ?, updated_at = now()
         WHERE fin IS NULL AND (${filtro.sql})
         RETURNING ${COLUMNAS}`,
        [finEn, causa, ...filtro.valores],
    )) as { rows: FilaSesion[] }
    return rows
}

/**
 * Al abrir una sesión, las otras abiertas del mismo usuario más viejas quedaron huérfanas (el NAS
 * perdió el Stop): se cierran para que `coa` y el portal vean una sola sesión activa.
 */
export async function cerrarReemplazadas(t: Transaccion, nueva: FilaSesion): Promise<void> {
    const cerradas = await cerrarSesiones(
        t,
        {
            sql: 'user_ppp = ? AND id <> ? AND inicio <= ?',
            valores: [nueva.user_ppp, nueva.id, nueva.inicio],
        },
        nueva.inicio.toISOString(),
        CAUSA_REEMPLAZADA,
    )
    for (const sesion of cerradas) await emitirTerminada(t, sesion)
}

function payload(sesion: FilaSesion) {
    return {
        servicio_id: sesion.servicio_id,
        nas_ip: sesion.nas_ip,
        acct_session_id: sesion.acct_session_id,
        ipv4: sesion.ipv4,
        prefijos_v6: [sesion.prefijo_enlace_v6, sesion.prefijo_delegado_v6].filter(
            (p): p is string => p !== null,
        ),
    }
}

export async function emitirIniciada(t: Transaccion, sesion: FilaSesion): Promise<void> {
    await t.emit('sesion.iniciada', payload(sesion))
}

export async function emitirTerminada(t: Transaccion, sesion: FilaSesion): Promise<void> {
    await t.emit('sesion.terminada', payload(sesion))
}

/** Resultado común de las acciones de accounting (para el log del worker y las pruebas). */
export interface ResultadoAccounting {
    sesionId: number | null
    /** qué pasó con la fila */
    efecto: 'abierta' | 'actualizada' | 'cerrada' | 'creada_cerrada' | 'ignorada'
    eventos: Array<'sesion.iniciada' | 'sesion.terminada'>
    /** El paquete trajo un prefijo IPv6 que la sesión no tenía (modo `radius_pool`) */
    prefijoNuevo?: boolean
}
