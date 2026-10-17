import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado, ValidacionFallida } from '#shared/errores'
import { verMigracionAaa } from '#network/sesiones/migracion_aaa'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'
import { filtrarPorAlcance, type Alcance, type DimensionesRecurso, type FiltrosDimension } from '#core/acl'

/**
 * Lecturas de `network.sesiones` para el panel (`GET /sesiones`, contrato `Sesion` del OpenAPI).
 *
 * - Orden: la más reciente primero (`id` descendente), paginación por cursor.
 * - Alcance: router de la sesión y zona del cliente del servicio (las mismas dimensiones que un
 *   servicio). Una sesión de un `user_ppp` desconocido no tiene zona: solo la ve quien no está
 *   acotado por zona.
 * - Contadores como número (`float8`): exactos hasta 2^53 octetos (8 PiB), más que suficiente para
 *   una sesión.
 */

export interface SesionVista {
    id: number
    servicio_id: number | null
    router_id: number | null
    nas_ip: string
    acct_session_id: string
    user_ppp: string
    ipv4: string | null
    prefijo_enlace_v6: string | null
    prefijo_delegado_v6: string | null
    inicio: string
    fin: string | null
    bytes_in: number
    bytes_out: number
    causa_fin: string | null
}

export interface FiltrosSesiones extends OpcionesPaginacion {
    servicio_id?: number
    router_id?: number
    activa?: boolean
    /** Sesiones vivas en o después de `desde`: abiertas o con `fin >= desde`. */
    desde?: Date
    /** Sesiones iniciadas antes de `hasta` (exclusive). */
    hasta?: Date
}

function columnas(cliente: QueryClientContract) {
    return [
        cliente.raw('ses.id::int AS id'),
        cliente.raw('ses.servicio_id::int AS servicio_id'),
        cliente.raw('ses.router_id::int AS router_id'),
        cliente.raw('host(ses.nas_ip) AS nas_ip'),
        'ses.acct_session_id',
        'ses.user_ppp',
        cliente.raw('host(ses.ipv4) AS ipv4'),
        cliente.raw('ses.prefijo_enlace_v6::text AS prefijo_enlace_v6'),
        cliente.raw('ses.prefijo_delegado_v6::text AS prefijo_delegado_v6'),
        'ses.inicio',
        'ses.fin',
        cliente.raw('ses.bytes_in::float8 AS bytes_in'),
        cliente.raw('ses.bytes_out::float8 AS bytes_out'),
        'ses.causa_fin',
    ]
}

export const dimensionesSesion: FiltrosDimension = {
    router: (q, ids) => q.whereIn('ses.router_id', ids),
    zona: (q, ids) =>
        q.whereExists((c) =>
            c
                .from('core.servicios as s_al')
                .join('core.clientes as c_al', 'c_al.id', 's_al.cliente_id')
                .whereRaw('s_al.id = ses.servicio_id')
                .whereIn('c_al.zona_id', ids),
        ),
}

export async function listarSesiones(
    filtros: FiltrosSesiones,
    alcance?: Alcance,
): Promise<Pagina<SesionVista>> {
    const cliente = db.connection()
    const consulta = cliente.from('network.sesiones as ses').select(columnas(cliente))
    if (filtros.servicio_id !== undefined) consulta.where('ses.servicio_id', filtros.servicio_id)
    if (filtros.router_id !== undefined) consulta.where('ses.router_id', filtros.router_id)
    if (filtros.activa === true) consulta.whereNull('ses.fin')
    if (filtros.activa === false) consulta.whereNotNull('ses.fin')
    // Solapamiento con [desde, hasta): la sesión estuvo viva en algún momento del intervalo.
    if (filtros.desde) {
        const desde = filtros.desde
        consulta.where((q) => q.whereNull('ses.fin').orWhere('ses.fin', '>=', desde))
    }
    if (filtros.hasta) consulta.where('ses.inicio', '<', filtros.hasta)
    filtrarPorAlcance(consulta, alcance, dimensionesSesion)
    return paginar<SesionVista>(consulta, filtros, { columna: 'ses.id' })
}

export async function verSesion(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<SesionVista> {
    const fila = (await cliente
        .from('network.sesiones as ses')
        .where('ses.id', id)
        .select(columnas(cliente))
        .first()) as SesionVista | null
    if (!fila) throw new NoEncontrado(`La sesión ${id} no existe`)
    return fila
}

/** Dimensiones de alcance de una sesión: su router y la zona del cliente de su servicio. */
export async function dimensionesDeSesion(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<DimensionesRecurso> {
    const fila = (await cliente
        .from('network.sesiones as ses')
        .leftJoin('core.servicios as s', 's.id', 'ses.servicio_id')
        .leftJoin('core.clientes as c', 'c.id', 's.cliente_id')
        .where('ses.id', id)
        .select('ses.router_id', 'c.zona_id')
        .first()) as { router_id: number | string | null; zona_id: number | string | null } | null
    if (!fila) throw new NoEncontrado(`La sesión ${id} no existe`)
    const numero = (v: number | string | null) => (v === null ? null : Number(v))
    return { router: [numero(fila.router_id)], zona: [numero(fila.zona_id)] }
}

export interface ServicioSinSesion {
    servicio_id: number
    cliente_id: number
    cliente_nombre: string
    user_ppp: string
    estado: string
    /** Inicio de la última sesión registrada del servicio (de cualquier fecha) o null si nunca hubo */
    ultima_sesion_inicio: string | null
    ultima_sesion_fin: string | null
}

export interface ResumenSesionesRouter {
    router_id: number
    /** El `desde` usado: el de la consulta o, si no vino, `aaa_desde` del router */
    desde: string
    /** Fecha de migración marcada (`routers.marcar_migrado`), null si no está marcada */
    aaa_desde: string | null
    /** Servicios PPPoE no retirados del router (dentro del alcance de quien consulta) */
    servicios: number
    /** De esos, cuántos tienen una sesión abierta ahora */
    con_sesion_activa: number
    /** Sesiones abiertas en el router (incluye `user_ppp` desconocidos; sin acotar por zona) */
    sesiones_activas: number
    /** De esos servicios, cuántos tuvieron sesión viva en o después de `desde` */
    con_sesion_desde: number
    /** Los que no: ninguna sesión abierta ni terminada en o después de `desde` */
    sin_sesion_desde: ServicioSinSesion[]
}

const dimensionesServicio: FiltrosDimension = {
    router: (q, ids) => q.whereIn('s.router_id', ids),
    zona: (q, ids) => q.whereIn('c.zona_id', ids),
}

/**
 * Resumen de sesiones de un router para la pantalla "Migración de router" (A4): servicios PPPoE,
 * cuántos tienen sesión abierta y cuáles no tuvieron ninguna desde `desde`. Una sesión cuenta si
 * estuvo viva en o después de `desde` (abierta, o `fin >= desde`), igual que `GET /sesiones?desde=`.
 * Las sesiones se buscan por `servicio_id` (no por el router de la sesión): un servicio que acaba
 * de cambiar de router cuenta con la sesión que tenga. Sin `desde`, usa la fecha de migración
 * marcada (`routers.marcar_migrado`); si no hay, 422.
 */
export async function resumenSesionesRouter(
    routerId: number,
    desdeConsulta: Date | undefined,
    alcance?: Alcance,
): Promise<ResumenSesionesRouter> {
    const cliente = db.connection()
    const migracion = await verMigracionAaa(routerId, cliente)
    const desde = desdeConsulta ?? (migracion.aaa_desde ? new Date(migracion.aaa_desde) : null)
    if (!desde) {
        throw new ValidacionFallida([
            {
                field: 'desde',
                message: 'Falta desde: el router no está marcado como migrado al nuevo aaa',
                rule: 'required',
            },
        ])
    }

    const consulta = cliente
        .from('core.servicios as s')
        .join('core.clientes as c', 'c.id', 's.cliente_id')
        .where('s.router_id', routerId)
        .where('s.tipo_conexion', 'pppoe')
        .whereNot('s.estado', 'retirado')
        .select(
            cliente.raw('s.id::int AS servicio_id'),
            cliente.raw('s.cliente_id::int AS cliente_id'),
            'c.nombre as cliente_nombre',
            's.user_ppp',
            's.estado',
            cliente.raw(
                'EXISTS (SELECT 1 FROM network.sesiones a WHERE a.servicio_id = s.id AND a.fin IS NULL) AS activa',
            ),
            cliente.raw(
                `EXISTS (SELECT 1 FROM network.sesiones d WHERE d.servicio_id = s.id
                    AND (d.fin IS NULL OR d.fin >= ?)) AS con_sesion_desde`,
                [desde],
            ),
            cliente.raw(
                `(SELECT u.inicio FROM network.sesiones u WHERE u.servicio_id = s.id
                    ORDER BY u.inicio DESC, u.id DESC LIMIT 1) AS ultima_sesion_inicio`,
            ),
            cliente.raw(
                `(SELECT u.fin FROM network.sesiones u WHERE u.servicio_id = s.id
                    ORDER BY u.inicio DESC, u.id DESC LIMIT 1) AS ultima_sesion_fin`,
            ),
        )
        .orderBy('s.id', 'asc')
    filtrarPorAlcance(consulta, alcance, dimensionesServicio)
    const filas = (await consulta) as Array<{
        servicio_id: number
        cliente_id: number
        cliente_nombre: string
        user_ppp: string
        estado: string
        activa: boolean
        con_sesion_desde: boolean
        ultima_sesion_inicio: Date | null
        ultima_sesion_fin: Date | null
    }>

    const abiertas = (await cliente
        .from('network.sesiones')
        .where('router_id', routerId)
        .whereNull('fin')
        .count('* as n')
        .first()) as { n: number | string }

    const iso = (d: Date | null) => (d === null ? null : new Date(d).toISOString())
    return {
        router_id: routerId,
        desde: desde.toISOString(),
        aaa_desde: migracion.aaa_desde,
        servicios: filas.length,
        con_sesion_activa: filas.filter((f) => f.activa).length,
        sesiones_activas: Number(abiertas.n),
        con_sesion_desde: filas.filter((f) => f.con_sesion_desde).length,
        sin_sesion_desde: filas
            .filter((f) => !f.con_sesion_desde)
            .map((f) => ({
                servicio_id: f.servicio_id,
                cliente_id: f.cliente_id,
                cliente_nombre: f.cliente_nombre,
                user_ppp: f.user_ppp,
                estado: f.estado,
                ultima_sesion_inicio: iso(f.ultima_sesion_inicio),
                ultima_sesion_fin: iso(f.ultima_sesion_fin),
            })),
    }
}
