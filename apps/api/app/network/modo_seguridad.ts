import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { ReglaNegocio, type ErrorCampo } from '#shared/errores'

/**
 * Modo de seguridad del router (`network.routers.modo_seguridad`, README «Modo de seguridad»):
 *
 * - `radius` (por defecto): los servicios `pppoe` autentican por RADIUS (`aaa`) y se limitan y cortan
 *   por CoA (`coa`); los `ip_estatica` y `dhcp_fija` del mismo router van por la API REST. `nas_ip`
 *   obligatoria.
 * - `api`: router sin RADIUS. Todo por la API REST (`app/network/routeros`): `ip_estatica` y
 *   `dhcp_fija` con colas y listas, y `pppoe` con un `/ppp/secret` local por servicio
 *   (`contratos/pppoe-local.md`, pedido del PM del 30 oct). No es cliente de FreeRADIUS ni recibe CoA;
 *   `nas_ip` y `radius_secret` son opcionales. PPPoE exige las credenciales de la API (422
 *   `pppoe_local_requiere_api`): sin ellas no hay cómo crear el secret.
 */
export type ModoSeguridad = 'radius' | 'api'

export const MENSAJE_PPPOE_LOCAL_REQUIERE_API =
    'Este router no usa RADIUS: los clientes PPPoE se crean como secrets por su API REST, y el router no ' +
    'tiene usuario y contraseña de la API. Complétalos en el router o usa uno con RADIUS'

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

/**
 * 422 `pppoe_local_requiere_api` si un servicio `pppoe` quedaría en un router `api` sin credenciales
 * de la API REST (PPPoE sin RADIUS necesita crear el secret en el equipo).
 */
export async function exigirPppoeAdmitido(
    trx: TransactionClientContract,
    routerId: number,
    tipoConexion: string,
): Promise<void> {
    if (tipoConexion !== 'pppoe') return
    if ((await modoSeguridadRouter(trx, routerId)) !== 'api') return
    const router = (await trx
        .from('network.routers')
        .where('id', routerId)
        .select('api_usuario', 'api_password')
        .first()) as { api_usuario: string | null; api_password: string | null } | null
    if (router?.api_usuario && router.api_password) return
    throw new ReglaNegocio(MENSAJE_PPPOE_LOCAL_REQUIERE_API, 'pppoe_local_requiere_api', [
        { field: 'router_id', rule: 'pppoe_local_requiere_api', message: MENSAJE_PPPOE_LOCAL_REQUIERE_API },
    ])
}

/** Cuántos servicios se nombran en `errors[]`; el `detail` lleva el total. */
export const MAXIMO_SERVICIOS_LISTADOS = 50

/**
 * 422 `servicios_pppoe_en_router` al pasar un router de `radius` a `api` si tiene servicios `pppoe` no
 * retirados. Se mantiene bloqueado aun con PPPoE sin RADIUS (`contratos/pppoe-local.md` §9): el
 * cambio sacaría al router de FreeRADIUS (evento) antes de que el dispatcher cree los secrets (otro
 * consumidor, otro equipo que puede no responder); en ese hueco ningún cliente puede reconectar, y las
 * sesiones RADIUS vivas quedan sin accounting ni CoA. El camino seguro es mover los servicios a un
 * router `api` (cada uno con su secret) o retirarlos. `errors[]` lleva uno por servicio
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
        rule: 'servicios_pppoe_en_router',
        message: `Servicio ${Number(s.id)} (PPPoE${s.user_ppp ? ` ${s.user_ppp}` : ''}, ${s.estado})`,
    }))
    const total = servicios.length
    throw new ReglaNegocio(
        `El router tiene ${total} ${total === 1 ? 'servicio PPPoE' : 'servicios PPPoE'} sin retirar que hoy ` +
            'autentican por RADIUS. Pasar el router a «api» con clientes conectados no es seguro (se quedarían ' +
            'sin autenticar hasta tener sus secrets): muévelos a un router sin RADIUS, pásalos a IP estática o ' +
            'DHCP fija, o retíralos antes de cambiarlo',
        'servicios_pppoe_en_router',
        errores,
    )
}
