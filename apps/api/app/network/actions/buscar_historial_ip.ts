import { isIP } from 'node:net'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { ajusteEntero } from '#core/ajustes_operacion'

export interface EntradaBuscarHistorialIp {
    ip: string
    /** instante buscado (UTC) */
    en: Date
    /** empresas del alcance (null = todas) */
    empresas: number[] | null
    ahora?: Date
}

export interface ResultadoHistorialIp {
    fuente: 'sesion' | 'asignacion'
    servicio_id: number
    cliente_id: number
    cliente_nombre: string
    cliente_codigo: string | null
    empresa_id: number
    user_ppp: string | null
    /** sesión o asignación que contenía la IP, en CIDR */
    prefijo: string
    desde: string
    hasta: string | null
    sesion: {
        id: number
        nas_ip: string | null
        acct_session_id: string
        inicio: string
        fin: string | null
        causa_fin: string | null
    } | null
}

export interface HistorialIp {
    ip: string
    en: string
    retencion_dias: number
    resultados: ResultadoHistorialIp[]
}

/**
 * Quién tenía una IPv4 o un prefijo IPv6 en una fecha y hora (`ip.buscar_historial`, decisión del PM 28).
 *
 * Busca en `network.sesiones` (la sesión PPPoE abierta en ese instante: IPv4 igual, o la IPv6 dentro de
 * su /64 de enlace o su prefijo delegado) y en el historial de asignaciones (`network.ipv4_asignaciones`
 * y `network.ipv6_asignaciones` vigentes en ese instante). Ordena por prefijo más largo y la sesión
 * antes que la asignación. Solo servicios de las empresas del alcance.
 *
 * - Cada consulta queda en `audit.acciones` (con la IP, el instante y los servicios devueltos).
 * - Retención: no busca más atrás de `ip_historial.retencion_dias` (730 de fábrica; 422
 *   `fuera_de_retencion`) ni en el futuro (422 `fecha_futura`).
 * - Es una lectura: no emite eventos.
 */
export default class BuscarHistorialIp extends DomainAction<EntradaBuscarHistorialIp, HistorialIp> {
    readonly nombre = 'ip.buscar_historial'

    protected async handle(input: EntradaBuscarHistorialIp, t: Transaccion): Promise<HistorialIp> {
        const ip = input.ip.trim()
        if (isIP(ip) === 0) {
            throw new ValidacionFallida([{ field: 'ip', message: 'Debe ser una IPv4 o IPv6', rule: 'ip' }])
        }
        const ahora = input.ahora ?? new Date()
        const retencion = await ajusteEntero('ip_historial.retencion_dias', null, t.trx)
        if (input.en > ahora) {
            throw new ReglaNegocio('La fecha buscada todavía no llega', 'fecha_futura', [
                { field: 'en', message: 'Debe ser una fecha pasada', rule: 'pasada' },
            ])
        }
        if (input.en.getTime() < ahora.getTime() - retencion * 86_400_000) {
            throw new ReglaNegocio(
                `Solo se guardan ${retencion} días de historial de IPs`,
                'fuera_de_retencion',
                [{ field: 'en', message: `Más antigua que ${retencion} días`, rule: 'retencion' }],
            )
        }
        const { rows } = (await t.trx.rawQuery(
            `WITH q AS (SELECT ?::inet AS v, ?::timestamptz AS t),
             c AS (
                SELECT 'sesion' AS fuente, 0 AS orden, se.servicio_id,
                       CASE WHEN family(q.v) = 4 THEN set_masklen(se.ipv4, 32)::cidr
                            WHEN se.prefijo_delegado_v6 >>= q.v THEN se.prefijo_delegado_v6
                            ELSE se.prefijo_enlace_v6 END AS prefijo,
                       se.inicio AS desde, se.fin AS hasta, se.id AS sesion_id
                  FROM network.sesiones se, q
                 WHERE se.servicio_id IS NOT NULL AND se.inicio <= q.t AND (se.fin IS NULL OR se.fin > q.t)
                   AND ((family(q.v) = 4 AND se.ipv4 = q.v)
                        OR se.prefijo_enlace_v6 >>= q.v OR se.prefijo_delegado_v6 >>= q.v)
                UNION ALL
                SELECT 'asignacion', 1, a.servicio_id, set_masklen(a.ip, 32)::cidr, a.inicio, a.fin, NULL
                  FROM network.ipv4_asignaciones a, q
                 WHERE family(q.v) = 4 AND a.ip = q.v AND a.inicio <= q.t AND (a.fin IS NULL OR a.fin > q.t)
                UNION ALL
                SELECT 'asignacion', 1, a.servicio_id, a.prefijo, a.inicio, a.fin, NULL
                  FROM network.ipv6_asignaciones a, q
                 WHERE a.prefijo >>= q.v AND a.inicio <= q.t AND (a.fin IS NULL OR a.fin > q.t)
             )
             SELECT c.fuente, c.servicio_id, sv.cliente_id, cl.nombre AS cliente_nombre,
                    cl.codigo AS cliente_codigo, sv.empresa_id, sv.user_ppp, c.prefijo::text AS prefijo,
                    c.desde, c.hasta, se.id AS sesion_id, host(se.nas_ip) AS nas_ip, se.acct_session_id,
                    se.inicio AS sesion_inicio, se.fin AS sesion_fin, se.causa_fin
               FROM c
               JOIN core.servicios sv ON sv.id = c.servicio_id
               JOIN core.clientes cl ON cl.id = sv.cliente_id
               LEFT JOIN network.sesiones se ON se.id = c.sesion_id
              WHERE (?::bigint[] IS NULL OR sv.empresa_id = ANY (?::bigint[]))
              ORDER BY masklen(c.prefijo) DESC, c.orden, c.desde DESC
              LIMIT 50`,
            [ip, input.en.toISOString(), input.empresas, input.empresas] as never,
        )) as { rows: Array<Record<string, unknown>> }
        const iso = (v: unknown) => (v === null || v === undefined ? null : new Date(v as Date).toISOString())
        const resultados: ResultadoHistorialIp[] = rows.map((r) => ({
            fuente: r.fuente as 'sesion' | 'asignacion',
            servicio_id: Number(r.servicio_id),
            cliente_id: Number(r.cliente_id),
            cliente_nombre: String(r.cliente_nombre),
            cliente_codigo: (r.cliente_codigo as string | null) ?? null,
            empresa_id: Number(r.empresa_id),
            user_ppp: (r.user_ppp as string | null) ?? null,
            prefijo: String(r.prefijo),
            desde: iso(r.desde)!,
            hasta: iso(r.hasta),
            sesion:
                r.sesion_id === null
                    ? null
                    : {
                          id: Number(r.sesion_id),
                          nas_ip: (r.nas_ip as string | null) ?? null,
                          acct_session_id: String(r.acct_session_id),
                          inicio: iso(r.sesion_inicio)!,
                          fin: iso(r.sesion_fin),
                          causa_fin: (r.causa_fin as string | null) ?? null,
                      },
        }))
        if (resultados[0]) {
            t.fijarEntidad('servicio', resultados[0].servicio_id)
            t.fijarEmpresa(resultados[0].empresa_id)
        }
        t.anotarAuditoria({ servicios: [...new Set(resultados.map((r) => r.servicio_id))] })
        return { ip, en: input.en.toISOString(), retencion_dias: retencion, resultados }
    }
}
