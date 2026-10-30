import type { Transaccion } from '#shared/domain_action'
import type { RegistroAccounting } from '#network/sesiones/registro'
import { detectarCaidasRepetidas } from '#network/sesiones/caidas'

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
    causa_fin: string | null
}

/** `rawQuery` con valores que pueden ser null (knex los acepta; sus tipos no). */
function consulta(t: Transaccion, sql: string, valores: unknown[]): Promise<unknown> {
    return t.trx.rawQuery(sql, valores as never)
}

const COLUMNAS = `id, servicio_id::int AS servicio_id, router_id::int AS router_id, host(nas_ip) AS nas_ip,
    acct_session_id, user_ppp, host(ipv4) AS ipv4, prefijo_enlace_v6::text AS prefijo_enlace_v6,
    prefijo_delegado_v6::text AS prefijo_delegado_v6, inicio, fin, causa_fin`

/** `COLUMNAS` con alias `s.` (UPDATE … FROM). */
const COLUMNAS_S = `s.id, s.servicio_id::int AS servicio_id, s.router_id::int AS router_id, host(s.nas_ip) AS nas_ip,
    s.acct_session_id, s.user_ppp, host(s.ipv4) AS ipv4, s.prefijo_enlace_v6::text AS prefijo_enlace_v6,
    s.prefijo_delegado_v6::text AS prefijo_delegado_v6, s.inicio, s.fin, s.causa_fin`

/** Causa con la que se cierra una sesión vieja del mismo usuario al abrir otra. */
export const CAUSA_REEMPLAZADA = 'Sesion-Reemplazada'

/**
 * Causa con la que el cron cierra una sesión sin Stop ni Interim-Update en N intervalos
 * (`actions/cerrar_sesiones_colgadas.ts`). Un Interim posterior la reabre y un Stop posterior
 * corrige su `fin` y su causa: el NAS demostró que la sesión seguía viva o cuándo terminó.
 */
export const CAUSA_SIN_INTERIM = 'sin_interim'

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
             prefijo_enlace_v6, prefijo_delegado_v6, inicio, fin, bytes_in, bytes_out, causa_fin,
             estrategia_velocidad)
         VALUES (?, ?, ?::inet, ?, ?, ?::inet, network(?::inet)::cidr, network(?::inet)::cidr, ?, ?, ?, ?, ?,
             -- Con qué estrategia de velocidad entró (contratos/control-velocidad.md §4): la conserva
             -- hasta reconectar aunque cambie la del router o la del plan.
             (SELECT jsonb_build_object('router', r.estrategia_velocidad, 'control', r.control_velocidad,
                                        'plan', pr.estrategia_velocidad)
                FROM core.servicios s
                JOIN network.routers r ON r.id = s.router_id
                LEFT JOIN network.planes_routers pr ON pr.plan_id = s.plan_id AND pr.router_id = s.router_id
               WHERE s.id = ?))
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
            ctx.servicioId,
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

/**
 * `motivo` = `causa_fin` de la sesión (Acct-Terminate-Cause, `NAS-Reboot`, `Sesion-Reemplazada`, `sin_interim`).
 * Después revisa las caídas repetidas del servicio (`caidas.ts`). Devuelve los eventos emitidos.
 */
export async function emitirTerminada(
    t: Transaccion,
    sesion: FilaSesion,
): Promise<Array<'sesion.terminada' | 'servicio.caidas_repetidas'>> {
    await t.emit('sesion.terminada', { ...payload(sesion), motivo: sesion.causa_fin })
    return (await detectarCaidasRepetidas(t, sesion))
        ? ['sesion.terminada', 'servicio.caidas_repetidas']
        : ['sesion.terminada']
}

/** Quita el cierre `sin_interim` de una sesión (llegó un Interim-Update: seguía viva). */
export async function reabrirSesion(t: Transaccion, id: number): Promise<void> {
    await consulta(
        t,
        `UPDATE network.sesiones SET fin = NULL, causa_fin = NULL, updated_at = now()
         WHERE id = ? AND causa_fin = ?`,
        [id, CAUSA_SIN_INTERIM],
    )
}

/** Hay otra sesión abierta del mismo `user_ppp` (entonces una cerrada por `sin_interim` no se reabre). */
export async function hayOtraAbierta(t: Transaccion, sesion: FilaSesion): Promise<boolean> {
    const { rows } = (await consulta(
        t,
        `SELECT 1 FROM network.sesiones WHERE user_ppp = ? AND id <> ? AND fin IS NULL LIMIT 1`,
        [sesion.user_ppp, sesion.id],
    )) as { rows: unknown[] }
    return rows.length > 0
}

/** Corrige `fin`, causa y contadores de una sesión cerrada por `sin_interim` con el Stop real. */
export async function corregirCierre(
    t: Transaccion,
    id: number,
    r: RegistroAccounting,
    causa: string,
): Promise<FilaSesion> {
    const { rows } = (await consulta(
        t,
        `UPDATE network.sesiones SET
             fin = GREATEST(inicio, ?::timestamptz),
             causa_fin = ?,
             bytes_in = GREATEST(bytes_in, ?::bigint),
             bytes_out = GREATEST(bytes_out, ?::bigint),
             updated_at = now()
         WHERE id = ?
         RETURNING ${COLUMNAS}`,
        [r.evento_en, causa, r.bytes_in, r.bytes_out, id],
    )) as { rows: FilaSesion[] }
    return rows[0]!
}

/**
 * Cierra (como mucho `limite`) sesiones abiertas sin accounting desde `corte`: `fin` = su último
 * accounting (`updated_at`, nunca antes de `inicio`), causa `sin_interim`.
 *
 * Salvaguarda: solo de NAS que siguen mandando accounting (alguna sesión abierta suya se
 * actualizó o empezó después de `corte`). Si `aaa`, Redis o el worker se cayeron, ningún NAS
 * tiene accounting reciente y no se cierra nada; un NAS que se apagó cierra las suyas con su
 * `Accounting-On` al volver. `SKIP LOCKED`: una sesión que el worker está actualizando se deja
 * para la próxima corrida.
 */
export async function cerrarColgadas(
    t: Transaccion,
    corte: Date,
    limite: number,
): Promise<{ cerradas: FilaSesion[]; nasSilenciosos: string[] }> {
    const { rows } = (await consulta(
        t,
        `WITH nas_vivos AS (
             SELECT DISTINCT nas_ip FROM network.sesiones
             WHERE fin IS NULL AND (updated_at >= ?::timestamptz OR inicio >= ?::timestamptz)
         ), candidatas AS (
             SELECT s.id FROM network.sesiones s
             WHERE s.fin IS NULL AND s.updated_at < ?::timestamptz
               AND s.nas_ip IN (SELECT nas_ip FROM nas_vivos)
             ORDER BY s.id
             LIMIT ?
             FOR UPDATE OF s SKIP LOCKED
         )
         UPDATE network.sesiones s
            SET fin = GREATEST(s.inicio, s.updated_at), causa_fin = ?, updated_at = now()
           FROM candidatas c
          WHERE s.id = c.id AND s.fin IS NULL
         RETURNING ${COLUMNAS_S}`,
        [corte, corte, corte, limite, CAUSA_SIN_INTERIM],
    )) as { rows: FilaSesion[] }
    const { rows: silenciosos } = (await consulta(
        t,
        `SELECT DISTINCT host(nas_ip) AS nas_ip FROM network.sesiones s
         WHERE s.fin IS NULL AND s.updated_at < ?::timestamptz
           AND NOT EXISTS (
               SELECT 1 FROM network.sesiones o
               WHERE o.nas_ip = s.nas_ip AND o.fin IS NULL
                 AND (o.updated_at >= ?::timestamptz OR o.inicio >= ?::timestamptz)
           )
         ORDER BY 1`,
        [corte, corte, corte],
    )) as { rows: Array<{ nas_ip: string }> }
    return { cerradas: rows, nasSilenciosos: silenciosos.map((f) => f.nas_ip) }
}

/** Resultado común de las acciones de accounting (para el log del worker y las pruebas). */
export interface ResultadoAccounting {
    sesionId: number | null
    /** qué pasó con la fila */
    efecto: 'abierta' | 'actualizada' | 'cerrada' | 'creada_cerrada' | 'ignorada' | 'reabierta' | 'corregida'
    eventos: Array<'sesion.iniciada' | 'sesion.terminada' | 'servicio.caidas_repetidas'>
    /** El paquete trajo un prefijo IPv6 que la sesión no tenía (modo `radius_pool`) */
    prefijoNuevo?: boolean
}
