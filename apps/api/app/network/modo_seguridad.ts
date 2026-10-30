import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { ReglaNegocio, type ErrorCampo } from '#shared/errores'

/**
 * Modo de seguridad del router (`network.routers.modo_seguridad`, README «Modo de seguridad»):
 *
 * - `radius` (por defecto): los servicios `pppoe` autentican por RADIUS (`aaa`) y se limitan y cortan
 *   por CoA (`coa`); los `ip_estatica` y `dhcp_fija` del mismo router van por la API REST. `nas_ip`
 *   obligatoria.
 * - `api`: router sin RADIUS. Solo `ip_estatica` y `dhcp_fija`, aprovisionados, limitados y cortados
 *   por la API REST (`app/network/routeros`). No es cliente de FreeRADIUS ni recibe CoA; `nas_ip` y
 *   `radius_secret` son opcionales. PPPoE no se admite (422 `pppoe_requiere_radius`).
 */
export type ModoSeguridad = 'radius' | 'api'

export const MENSAJE_PPPOE_REQUIERE_RADIUS =
    'Este router no usa RADIUS: PPPoE necesita RADIUS. Usa IP estática o DHCP fija, o cambia el router a RADIUS'

/**
 * Lee el modo del router con `FOR SHARE`: una edición que lo pase a `api` (que toma la fila con
 * `FOR UPDATE` y revisa sus servicios) no se cruza con el alta o el cambio de un servicio PPPoE.
 */
export async function modoSeguridadRouter(
    trx: TransactionClientContract,
    routerId: number,
): Promise<ModoSeguridad | null> {
    const fila = (await trx
        .from('network.routers')
        .where('id', routerId)
        .forShare()
        .select('modo_seguridad')
        .first()) as { modo_seguridad: ModoSeguridad } | null
    return fila?.modo_seguridad ?? null
}

/** 422 `pppoe_requiere_radius` si un servicio `pppoe` quedaría en un router `api`. */
export async function exigirRadiusParaPppoe(
    trx: TransactionClientContract,
    routerId: number,
    tipoConexion: string,
): Promise<void> {
    if (tipoConexion !== 'pppoe') return
    if ((await modoSeguridadRouter(trx, routerId)) !== 'api') return
    throw new ReglaNegocio(MENSAJE_PPPOE_REQUIERE_RADIUS, 'pppoe_requiere_radius', [
        { field: 'tipo_conexion', rule: 'pppoe_requiere_radius', message: MENSAJE_PPPOE_REQUIERE_RADIUS },
    ])
}

/** Cuántos servicios se nombran en `errors[]`; el `detail` lleva el total. */
export const MAXIMO_SERVICIOS_LISTADOS = 50

/**
 * 422 `servicios_pppoe_en_router` al pasar un router a `api` si tiene servicios `pppoe` no retirados:
 * se quedarían sin RADIUS (sin autenticar, sin CoA). `errors[]` lleva uno por servicio
 * (`field = servicios.<id>`), hasta `MAXIMO_SERVICIOS_LISTADOS`. Quien llama ya tiene la fila del
 * router con `FOR UPDATE`.
 */
export async function exigirSinPppoe(trx: TransactionClientContract, routerId: number): Promise<void> {
    const servicios = (await trx
        .from('core.servicios')
        .where('router_id', routerId)
        .where('tipo_conexion', 'pppoe')
        .whereNot('estado', 'retirado')
        .orderBy('id')
        .select('id', 'user_ppp', 'estado')) as Array<{ id: number; user_ppp: string | null; estado: string }>
    if (servicios.length === 0) return
    const errores: ErrorCampo[] = servicios.slice(0, MAXIMO_SERVICIOS_LISTADOS).map((s) => ({
        field: `servicios.${Number(s.id)}`,
        rule: 'pppoe_requiere_radius',
        message: `Servicio ${Number(s.id)} (PPPoE${s.user_ppp ? ` ${s.user_ppp}` : ''}, ${s.estado})`,
    }))
    const total = servicios.length
    throw new ReglaNegocio(
        `El router tiene ${total} ${total === 1 ? 'servicio PPPoE' : 'servicios PPPoE'} sin retirar, y PPPoE ` +
            'necesita RADIUS. Pásalos a IP estática o DHCP fija, muévelos a un router con RADIUS o retíralos ' +
            'antes de cambiar el router a «api»',
        'servicios_pppoe_en_router',
        errores,
    )
}
