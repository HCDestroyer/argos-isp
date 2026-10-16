import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
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
