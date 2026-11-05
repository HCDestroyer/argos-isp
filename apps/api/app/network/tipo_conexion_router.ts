import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract, TransactionClientContract } from '@adonisjs/lucid/types/database'
import { ReglaNegocio } from '#shared/errores'
import { MENSAJE_PPPOE_LOCAL_REQUIERE_API } from '#network/modo_seguridad'
import { verRouter } from '#network/consultas/routers'
import type { TipoConexion } from '#core/consultas/servicios'

/**
 * Tipo de conexión por router (decisión del PM, 5 nov; `contratos/tipo-conexion-router.md`): todos los
 * servicios de un router usan su `tipo_conexion`. El alta toma el del router; un tipo distinto es 422
 * `tipo_conexion_del_router`. Mover un servicio de router adopta el del destino. Cambiar el del router
 * con servicios es `routers.cambiar_tipo_conexion`, servicio por servicio.
 */

export const ETIQUETA_TIPO: Record<TipoConexion, string> = {
    pppoe: 'PPPoE',
    ip_estatica: 'IP estática',
    dhcp_fija: 'DHCP fija',
}

/** Tipo de conexión del router (`FOR SHARE`: no se cruza con `routers.cambiar_tipo_conexion`). */
export async function tipoConexionRouter(
    trx: TransactionClientContract,
    routerId: number,
): Promise<TipoConexion | null> {
    const fila = (await trx
        .from('network.routers')
        .where('id', routerId)
        .forShare()
        .select('tipo_conexion')
        .first()) as { tipo_conexion: TipoConexion } | null
    return fila?.tipo_conexion ?? null
}

/** 422 `tipo_conexion_del_router` (`type` y `errors[0].rule`, field `tipo_conexion`) si se pidió un tipo distinto del del router. */
export function exigirTipoDelRouter(tipoRouter: TipoConexion, pedido: TipoConexion | undefined) {
    if (pedido === undefined || pedido === tipoRouter) return
    const mensaje =
        `El tipo de conexión lo define el router: este router es ${ETIQUETA_TIPO[tipoRouter]} y todos sus ` +
        `servicios usan ese tipo. No mandes tipo_conexion (o manda ${tipoRouter}); para usar ` +
        `${ETIQUETA_TIPO[pedido]}, elige un router de ese tipo o cambia el tipo del router`
    throw new ReglaNegocio(mensaje, 'tipo_conexion_del_router', [
        { field: 'tipo_conexion', rule: 'tipo_conexion_del_router', message: mensaje },
    ])
}

/** Lo que le falta a un servicio para pasar a otro tipo (no se completa solo: 422). */
export type FaltaTipo = 'mac' | 'ipv4' | 'plan'
/** Lo que el cambio completa o ajusta solo. */
export type CompletaTipo = 'credenciales' | 'ipv4' | 'ipv6_modo' | 'amarre_ip_mac'

export interface ServicioTipoConexion {
    servicio_id: number
    cliente_id: number
    cliente_nombre: string
    user_ppp: string | null
    estado: string
    tipo_conexion: TipoConexion
    /** el servicio no usa el tipo actual del router (dato anterior a la regla) */
    difiere_del_router: boolean
    /** pasa a `tipo` (su tipo es otro) */
    cambia: boolean
    /** lo que falta y bloquea el cambio; vacío = se puede */
    faltan: FaltaTipo[]
    /** lo que el cambio completa solo (credenciales PPPoE nuevas, IPv4 de las redes del router…) */
    se_completa: CompletaTipo[]
    /** detalle en español de cada falta */
    mensajes: string[]
}

export interface BloqueoTipoConexion {
    codigo: 'pppoe_local_requiere_api'
    mensaje: string
}

export interface VistaPreviaTipoConexion {
    router_id: number
    router_version: number
    tipo_actual: TipoConexion
    tipo: TipoConexion
    /** true si `POST /routers/:id/cambiar-tipo-conexion` con este tipo se aplicaría */
    aplicable: boolean
    bloqueos: BloqueoTipoConexion[]
    resumen: { servicios: number; cambian: number; con_faltantes: number; difieren_del_router: number }
    /** servicios no retirados del router (por id) */
    servicios: ServicioTipoConexion[]
}

interface FilaServicio {
    id: number
    cliente_id: number
    cliente_nombre: string
    user_ppp: string | null
    estado: string
    tipo_conexion: TipoConexion
    mac: string | null
    amarre_ip_mac: boolean
    ipv6_modo: string
    dual_stack: 'ambos' | 'v4' | 'v6'
    ipv4: string | null
}

/** Qué cambia y qué le falta a cada servicio no retirado del router si pasa a `tipo`. */
export async function analizarServiciosRouter(
    cliente: QueryClientContract,
    routerId: number,
    tipoActual: TipoConexion,
    tipo: TipoConexion,
): Promise<ServicioTipoConexion[]> {
    const filas = (await cliente
        .from('core.servicios as s')
        .join('core.clientes as c', 'c.id', 's.cliente_id')
        .join('network.planes as p', 'p.id', 's.plan_id')
        .where('s.router_id', routerId)
        .whereNot('s.estado', 'retirado')
        .orderBy('s.id')
        .select(
            's.id',
            's.cliente_id',
            'c.nombre as cliente_nombre',
            's.user_ppp',
            's.estado',
            's.tipo_conexion',
            cliente.raw('s.mac::text AS mac'),
            's.amarre_ip_mac',
            's.ipv6_modo',
            'p.dual_stack',
            cliente.raw(
                `(SELECT host(a.ip) FROM network.ipv4_asignaciones a
                   WHERE a.servicio_id = s.id AND a.fin IS NULL LIMIT 1) AS ipv4`,
            ),
        )) as FilaServicio[]
    const conRedes = Boolean(
        await cliente.from('network.redes_ipv4').where('router_id', routerId).select('id').first(),
    )
    return filas.map((f) => {
        const cambia = f.tipo_conexion !== tipo
        const faltan: FaltaTipo[] = []
        const seCompleta: CompletaTipo[] = []
        const mensajes: string[] = []
        if (cambia) {
            if (tipo === 'pppoe') {
                seCompleta.push('credenciales')
                if (f.amarre_ip_mac) seCompleta.push('amarre_ip_mac')
            } else {
                if (f.dual_stack === 'v6') {
                    faltan.push('plan')
                    mensajes.push(
                        'Su plan es solo IPv6 y un servicio sin PPPoE necesita IPv4: cámbiale el plan',
                    )
                }
                if (!f.ipv4) {
                    if (conRedes) seCompleta.push('ipv4')
                    else {
                        faltan.push('ipv4')
                        mensajes.push(
                            'No tiene IPv4 y el router no tiene redes IPv4 de las que asignarle una: agrega una red al router',
                        )
                    }
                }
                if (f.ipv6_modo === 'radius_servicio' || f.ipv6_modo === 'radius_pool') {
                    seCompleta.push('ipv6_modo')
                }
                if (tipo === 'dhcp_fija' && !f.mac) {
                    faltan.push('mac')
                    mensajes.push('DHCP fija necesita la MAC del equipo: complétala en el servicio')
                }
            }
        }
        return {
            servicio_id: Number(f.id),
            cliente_id: Number(f.cliente_id),
            cliente_nombre: f.cliente_nombre,
            user_ppp: f.user_ppp,
            estado: f.estado,
            tipo_conexion: f.tipo_conexion,
            difiere_del_router: f.tipo_conexion !== tipoActual,
            cambia,
            faltan,
            se_completa: seCompleta,
            mensajes,
        }
    })
}

/** El router admite PPPoE (`modo_seguridad = 'api'` necesita usuario y clave de la API). */
async function bloqueosRouter(
    cliente: QueryClientContract,
    routerId: number,
    tipo: TipoConexion,
): Promise<BloqueoTipoConexion[]> {
    if (tipo !== 'pppoe') return []
    const r = (await cliente
        .from('network.routers')
        .where('id', routerId)
        .select('modo_seguridad', 'api_usuario', 'api_password')
        .first()) as { modo_seguridad: string; api_usuario: string | null; api_password: string | null }
    if (r.modo_seguridad !== 'api' || (r.api_usuario && r.api_password)) return []
    return [{ codigo: 'pppoe_local_requiere_api', mensaje: MENSAJE_PPPOE_LOCAL_REQUIERE_API }]
}

/**
 * Vista previa de `routers.cambiar_tipo_conexion` (no escribe ni habla con el router). Sin `tipo`, el
 * actual: lista los servicios que difieren del router (lo que haría «unificar»).
 */
export async function vistaPreviaTipoConexion(
    routerId: number,
    tipo?: TipoConexion,
    cliente: QueryClientContract = db.connection(),
): Promise<VistaPreviaTipoConexion> {
    const router = await verRouter(routerId, cliente)
    const destino = tipo ?? router.tipo_conexion
    const servicios = await analizarServiciosRouter(cliente, routerId, router.tipo_conexion, destino)
    const bloqueos = await bloqueosRouter(cliente, routerId, destino)
    const cambian = servicios.filter((s) => s.cambia)
    const conFaltantes = cambian.filter((s) => s.faltan.length > 0).length
    return {
        router_id: routerId,
        router_version: router.version,
        tipo_actual: router.tipo_conexion,
        tipo: destino,
        aplicable: bloqueos.length === 0 && conFaltantes === 0,
        bloqueos,
        resumen: {
            servicios: servicios.length,
            cambian: cambian.length,
            con_faltantes: conFaltantes,
            difieren_del_router: servicios.filter((s) => s.difiere_del_router).length,
        },
        servicios,
    }
}
