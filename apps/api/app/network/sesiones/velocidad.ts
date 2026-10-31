import type { Transaccion } from '#shared/domain_action'
import { rateLimitServicio } from '#network/velocidad'
import {
    estrategiaDeCopia,
    mismaEstrategia,
    velocidadConExtras,
    velocidadPorCoa,
    type Estrategia,
} from '#network/estrategia_velocidad'
import type { ServicioRed } from '#network/routeros/estado_deseado'

/**
 * Cambio de velocidad de sesiones PPPoE vivas sin desconectar (`contratos/control-velocidad.md` §5):
 * `planes.sincronizar`, `plan.velocidad_cambiada` y el cambio de estrategia emiten
 * `sesion.velocidad_solicitada` por outbox y `coa` manda el CoA con el `Mikrotik-Rate-Limit` nuevo.
 *
 * Solo para sesiones que entraron con `radius_rate_limit` o `perfil_ppp` y cuya estrategia vigente
 * también lo es (las de `pcq_plan` o `arbol_pcq` no tienen cola por sesión: cambia el PCQ del plan),
 * y solo con el servicio `activo` o `limitado` (el suspendido conserva su rate-limit mínimo).
 * RouterOS no reasigna el perfil PPP a una sesión viva: en `perfil_ppp` el CoA le pone la misma
 * velocidad que el perfil nuevo. Una sesión de sondeo (router sin RADIUS, `contratos/pppoe-local.md`)
 * no recibe CoA: toma el perfil `plan-<id>` nuevo al reconectar.
 */

export interface ResultadoVelocidadSesiones {
    /** Sesiones a las que se pidió CoA */
    coa: number
    /** Sesiones que siguen con la estrategia con que entraron hasta reconectar (otra estructura) */
    conservan: number
    /** Sesiones abiertas del servicio */
    abiertas: number
}

interface FilaSesion {
    id: number
    nas_ip: string
    acct_session_id: string
    user_ppp: string
    estrategia_velocidad: unknown
}

/** Sesiones abiertas del servicio con la estrategia con la que entraron (bloqueadas). */
export async function sesionesConEstrategia(
    t: Transaccion,
    servicioId: number,
): Promise<Array<FilaSesion & { estrategia: Estrategia | null }>> {
    const { rows } = (await t.trx.rawQuery(
        `SELECT id::int AS id, host(nas_ip) AS nas_ip, acct_session_id, user_ppp, estrategia_velocidad
           FROM network.sesiones WHERE servicio_id = ? AND fin IS NULL AND origen = 'accounting'
          ORDER BY inicio FOR UPDATE`,
        [servicioId],
    )) as { rows: FilaSesion[] }
    return rows.map((r) => ({ ...r, estrategia: estrategiaDeCopia(r.estrategia_velocidad) }))
}

/**
 * Pide CoA de velocidad a las sesiones vivas del servicio que lo admiten. `solo_contar` calcula lo
 * mismo sin emitir (vista previa).
 */
export async function solicitarVelocidad(
    t: Transaccion,
    servicio: ServicioRed,
    motivo: string,
    opciones: { solo_contar?: boolean } = {},
): Promise<ResultadoVelocidadSesiones> {
    const salida: ResultadoVelocidadSesiones = { coa: 0, conservan: 0, abiertas: 0 }
    if (servicio.tipo_conexion !== 'pppoe') return salida
    const actual = servicio.estrategia
    for (const sesion of await sesionesConEstrategia(t, servicio.servicio_id)) {
        salida.abiertas++
        const conQueEntro = sesion.estrategia ?? actual
        if (!mismaEstrategia(conQueEntro, actual)) salida.conservan++
        if (servicio.estado !== 'activo' && servicio.estado !== 'limitado') continue
        if (!velocidadPorCoa(conQueEntro) || !velocidadPorCoa(actual)) continue
        salida.coa++
        if (opciones.solo_contar) continue
        await t.emit('sesion.velocidad_solicitada', {
            sesion_id: sesion.id,
            servicio_id: servicio.servicio_id,
            nas_ip: sesion.nas_ip,
            acct_session_id: sesion.acct_session_id,
            user_ppp: sesion.user_ppp,
            estado: servicio.estado,
            rate_limit: rateLimitServicio(
                velocidadConExtras(servicio.velocidad, actual.extras),
                servicio.estado,
            ),
            motivo,
        })
    }
    return salida
}
