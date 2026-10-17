import db from '@adonisjs/lucid/services/db'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'
import { filtrarPorAlcance, type Alcance, type FiltrosDimension } from '#core/acl'
import { esCampoSensible, MASCARA } from '#shared/enmascarar'

/**
 * Lectura de `audit.red` para el panel (`GET /red/eventos`, contrato `EventoRed`): cada CoA,
 * Disconnect-Request y escritura en RouterOS con la respuesta del equipo.
 *
 * - Orden: el más reciente primero por `id` descendente (la secuencia de `audit.red`, orden de
 *   inserción), cursor opaco.
 * - `desde` inclusive, `hasta` exclusive (igual que la bitácora).
 * - Alcance: router de la fila y zona del cliente del servicio. Una fila sin router (NAS no dado de
 *   alta) solo la ve quien no está acotado por router.
 * - Credenciales: `comando` y `respuesta` pasan por `limpiarCredenciales`, aunque hoy ni `coa` ni
 *   el cliente de RouterOS guardan secretos ahí. Defensa en profundidad: una propiedad de
 *   RouterOS (`password` de `/ppp/secret`, `secret` de `/radius`, `private-key`) o un atributo
 *   RADIUS (`User-Password`) que llegara a guardarse sale como `***`.
 */

export const TIPOS_EVENTO_RED = ['coa', 'disconnect', 'routeros'] as const
export const RESULTADOS_EVENTO_RED = ['ok', 'error'] as const

export interface EventoRedVista {
    id: number
    tipo: (typeof TIPOS_EVENTO_RED)[number]
    router_id: number | null
    router_nombre: string | null
    servicio_id: number | null
    ok: boolean
    comando: Record<string, unknown>
    respuesta: Record<string, unknown> | null
    created_at: string
}

export interface FiltrosEventosRed extends OpcionesPaginacion {
    router_id?: number
    servicio_id?: number
    tipo?: (typeof TIPOS_EVENTO_RED)[number]
    resultado?: (typeof RESULTADOS_EVENTO_RED)[number]
    desde?: Date
    hasta?: Date
}

// Además de los campos sensibles de la auditoría: nombres de RouterOS con guion y cabeceras.
const SENSIBLE_RED = /(^|_)(private_key|preshared_key|psk|authorization|auth|credenciales?)($|_|[0-9])/

export function esClaveSensibleRed(clave: string): boolean {
    const normal = clave.replace(/[\s-]+/g, '_')
    return esCampoSensible(normal) || SENSIBLE_RED.test(normal.toLowerCase())
}

/** Copia de un JSON con cada clave sensible (a cualquier profundidad) como `***`. */
export function limpiarCredenciales(valor: unknown): unknown {
    if (Array.isArray(valor)) return valor.map(limpiarCredenciales)
    if (valor !== null && typeof valor === 'object') {
        const salida: Record<string, unknown> = {}
        for (const [clave, interno] of Object.entries(valor)) {
            salida[clave] =
                esClaveSensibleRed(clave) && interno !== null && interno !== ''
                    ? MASCARA
                    : limpiarCredenciales(interno)
        }
        return salida
    }
    return valor
}

const dimensionesRed: FiltrosDimension = {
    router: (q, ids) => q.whereIn('r.router_id', ids),
    zona: (q, ids) =>
        q.whereExists((c) =>
            c
                .from('core.servicios as s_al')
                .join('core.clientes as c_al', 'c_al.id', 's_al.cliente_id')
                .whereRaw('s_al.id = r.servicio_id')
                .whereIn('c_al.zona_id', ids),
        ),
}

interface FilaRed {
    id: number
    tipo: EventoRedVista['tipo']
    router_id: number | null
    router_nombre: string | null
    servicio_id: number | null
    ok: boolean
    comando: Record<string, unknown>
    respuesta: Record<string, unknown> | null
    created_at: Date | string
}

export async function listarEventosRed(
    filtros: FiltrosEventosRed,
    alcance?: Alcance,
): Promise<Pagina<EventoRedVista>> {
    const consulta = db
        .from('audit.red as r')
        .leftJoin('network.routers as ro', 'ro.id', 'r.router_id')
        .select(
            db.raw('r.id::int AS id'),
            'r.tipo',
            db.raw('r.router_id::int AS router_id'),
            'ro.nombre as router_nombre',
            db.raw('r.servicio_id::int AS servicio_id'),
            'r.ok',
            'r.comando',
            'r.respuesta',
            'r.created_at',
        )
    if (filtros.router_id !== undefined) consulta.where('r.router_id', filtros.router_id)
    if (filtros.servicio_id !== undefined) consulta.where('r.servicio_id', filtros.servicio_id)
    if (filtros.tipo !== undefined) consulta.where('r.tipo', filtros.tipo)
    if (filtros.resultado !== undefined) consulta.where('r.ok', filtros.resultado === 'ok')
    if (filtros.desde) consulta.where('r.created_at', '>=', filtros.desde)
    if (filtros.hasta) consulta.where('r.created_at', '<', filtros.hasta)
    filtrarPorAlcance(consulta, alcance, dimensionesRed)

    const pagina = await paginar<FilaRed>(consulta, filtros, { columna: 'r.id' })
    return {
        nextCursor: pagina.nextCursor,
        data: pagina.data.map((f) => ({
            id: f.id,
            tipo: f.tipo,
            router_id: f.router_id,
            router_nombre: f.router_nombre,
            servicio_id: f.servicio_id,
            ok: f.ok,
            comando: limpiarCredenciales(f.comando ?? {}) as Record<string, unknown>,
            respuesta:
                f.respuesta === null ? null : (limpiarCredenciales(f.respuesta) as Record<string, unknown>),
            created_at: f.created_at instanceof Date ? f.created_at.toISOString() : String(f.created_at),
        })),
    }
}
