import { isIP } from 'node:net'
import { sqlExterno, type IdExterno } from '#core/ids_externos'
import type { TipoPlan } from '#network/tipos_plan'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { DatabaseQueryBuilderContract } from '@adonisjs/lucid/types/querybuilder'
import { NoEncontrado } from '#shared/errores'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'
import type { EstadoServicio } from '#shared/eventos'
import { filtrarPorAlcance, type Alcance, type DimensionesRecurso, type FiltrosDimension } from '#core/acl'
import { filtrarPorEmpresa } from '#shared/empresa_activa'

/**
 * Lecturas de servicios. La vista incluye la IPv4 y los prefijos IPv6 vigentes y la bandera
 * `promesa_activa`. `pass_ppp` nunca sale (ver `VerCredencialesServicio`).
 */

export type ModoIpv6 = 'radius_servicio' | 'radius_pool' | 'duid' | 'estatico' | 'ninguno'

/**
 * Cómo se conecta el servicio (`.claude/integration/contratos/routeros.md`): `pppoe` por RADIUS;
 * `ip_estatica` y `dhcp_fija` sin credenciales, controlados por la API REST de RouterOS (A2).
 */
export const TIPOS_CONEXION = ['pppoe', 'ip_estatica', 'dhcp_fija'] as const
export type TipoConexion = (typeof TIPOS_CONEXION)[number]

export interface ServicioVista {
    id: number
    cliente_id: number
    /** empresa (NIT) que factura el servicio (`core.empresas`) */
    empresa_id: number
    router_id: number
    plan_id: number
    plantilla_facturacion_id: number | null
    estado: EstadoServicio
    promesa_activa: boolean
    suspension_manual: boolean
    suspension_manual_motivo: string | null
    tipo_conexion: TipoConexion
    /** null fuera de `pppoe` */
    user_ppp: string | null
    /** ARP estático IP-MAC en el router (solo sin PPPoE) */
    amarre_ip_mac: boolean
    mac: string | null
    direccion: string | null
    coordenadas: string | null
    fecha_instalacion: string | null
    costo_override: string | null
    excluir_firewall: boolean
    ipv4: string | null
    prefijo_enlace_v6: string | null
    prefijo_delegado_v6: string | null
    ipv6_modo: ModoIpv6
    ipv6_duid: string | null
    cliente_nombre: string
    plan_nombre: string
    /** tipo del plan del servicio (solo lectura, derivado de `network.planes.tipo`) */
    plan_tipo: TipoPlan
    router_nombre: string
    zona_nombre: string | null
    /** excepciones a la plantilla de facturación `{ campo: valor }` (tarea 11) */
    excepciones: Record<string, unknown>
    /**
     * Plan temporal `programado` o `activo` (lealtad, `core.servicios_planes_temporales`), o null.
     * Activo: `plan_id` ya es el temporal y `plan_original_id` es el plan base al que vuelve.
     */
    plan_temporal: PlanTemporalResumen | null
    /** id en el sistema de origen (`core.ids_externos`, importador) o null */
    externo: IdExterno | null
    version: number
    created_at: string
    updated_at: string
}

export interface PlanTemporalResumen {
    id: number
    plan_id: number
    plan_original_id: number
    inicio: string
    fin: string
    estado: 'programado' | 'activo'
    origen: 'lealtad' | 'manual'
    origen_id: number | null
    version: number
}

function columnas(cliente: QueryClientContract) {
    return [
        's.id',
        's.cliente_id',
        's.empresa_id',
        's.router_id',
        's.plan_id',
        's.plantilla_facturacion_id',
        's.estado',
        's.suspension_manual',
        's.suspension_manual_motivo',
        cliente.raw(
            `EXISTS (SELECT 1 FROM billing.promesas p WHERE p.servicio_id = s.id AND p.estado = 'activa') AS promesa_activa`,
        ),
        's.tipo_conexion',
        's.user_ppp',
        's.amarre_ip_mac',
        cliente.raw('s.mac::text AS mac'),
        's.direccion',
        's.coordenadas',
        cliente.raw(`to_char(s.fecha_instalacion, 'YYYY-MM-DD') AS fecha_instalacion`),
        's.costo_override',
        's.excluir_firewall',
        cliente.raw(
            `(SELECT host(a.ip) FROM network.ipv4_asignaciones a WHERE a.servicio_id = s.id AND a.fin IS NULL LIMIT 1) AS ipv4`,
        ),
        cliente.raw(
            `(SELECT a.prefijo::text FROM network.ipv6_asignaciones a WHERE a.servicio_id = s.id AND a.fin IS NULL AND a.tipo = 'enlace' LIMIT 1) AS prefijo_enlace_v6`,
        ),
        cliente.raw(
            `(SELECT a.prefijo::text FROM network.ipv6_asignaciones a WHERE a.servicio_id = s.id AND a.fin IS NULL AND a.tipo = 'delegacion' LIMIT 1) AS prefijo_delegado_v6`,
        ),
        's.ipv6_modo',
        's.ipv6_duid',
        // nombres para pantallas sin permiso de ver routers, planes o zonas
        cliente.raw(
            `(SELECT c_n.nombre FROM core.clientes c_n WHERE c_n.id = s.cliente_id) AS cliente_nombre`,
        ),
        cliente.raw(`(SELECT p_n.nombre FROM network.planes p_n WHERE p_n.id = s.plan_id) AS plan_nombre`),
        cliente.raw(`(SELECT p_t.tipo FROM network.planes p_t WHERE p_t.id = s.plan_id) AS plan_tipo`),
        cliente.raw(
            `(SELECT r_n.nombre FROM network.routers r_n WHERE r_n.id = s.router_id) AS router_nombre`,
        ),
        cliente.raw(
            `(SELECT z_n.nombre FROM core.clientes c_z JOIN core.zonas z_n ON z_n.id = c_z.zona_id WHERE c_z.id = s.cliente_id) AS zona_nombre`,
        ),
        cliente.raw(
            `(SELECT coalesce(jsonb_object_agg(e.campo, e.valor ORDER BY e.campo), '{}'::jsonb) FROM core.servicios_excepciones e WHERE e.servicio_id = s.id) AS excepciones`,
        ),
        cliente.raw(
            `(SELECT jsonb_build_object('id', pt.id, 'plan_id', pt.plan_id, 'plan_original_id', pt.plan_original_id, 'inicio', pt.inicio, 'fin', pt.fin, 'estado', pt.estado, 'origen', pt.origen, 'origen_id', pt.origen_id, 'version', pt.version) FROM core.servicios_planes_temporales pt WHERE pt.servicio_id = s.id AND pt.estado IN ('programado', 'activo') LIMIT 1) AS plan_temporal`,
        ),
        cliente.raw(sqlExterno('servicio', 's.id')),
        's.version',
        's.created_at',
        's.updated_at',
    ]
}

/** Cómo se filtra `core.servicios as s` por alcance. */
export const dimensionesServicio: FiltrosDimension = {
    router: (q, ids) => q.whereIn('s.router_id', ids),
    zona: (q, ids) =>
        q.whereExists((c) =>
            c.from('core.clientes as c_al').whereRaw('c_al.id = s.cliente_id').whereIn('c_al.zona_id', ids),
        ),
}

export async function verServicio(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<ServicioVista> {
    const fila = (await cliente
        .from('core.servicios as s')
        .where('s.id', id)
        .select(columnas(cliente))
        .first()) as ServicioVista | null
    if (!fila) throw new NoEncontrado(`El servicio ${id} no existe`)
    return fila
}

export interface FiltrosServicios extends OpcionesPaginacion {
    q?: string
    cliente_id?: number
    router_id?: number
    plan_id?: number
    estado?: EstadoServicio
    tipo_conexion?: TipoConexion
    /** zona del cliente del servicio */
    zona_id?: number
    /** alguna factura del servicio en estado `vencida` (true) o ninguna (false) */
    con_deuda_vencida?: boolean
    /** tipo del plan del servicio */
    tipo?: TipoPlan
}

/**
 * `empresas`: filtro de `empresasDeLaLista` (multiempresa); null o ausente = todas.
 */
export async function listarServicios(
    filtros: FiltrosServicios,
    alcance?: Alcance,
    empresas: number[] | null = null,
): Promise<Pagina<ServicioVista>> {
    const cliente = db.connection()
    const consulta = cliente.from('core.servicios as s').select(columnas(cliente))
    if (filtros.cliente_id) consulta.where('s.cliente_id', filtros.cliente_id)
    if (filtros.router_id) consulta.where('s.router_id', filtros.router_id)
    if (filtros.plan_id) consulta.where('s.plan_id', filtros.plan_id)
    if (filtros.estado) consulta.where('s.estado', filtros.estado)
    if (filtros.tipo_conexion) consulta.where('s.tipo_conexion', filtros.tipo_conexion)
    if (filtros.tipo) {
        consulta.whereExists((c) =>
            c
                .from('network.planes as p_tf')
                .whereRaw('p_tf.id = s.plan_id')
                .where('p_tf.tipo', filtros.tipo!),
        )
    }
    if (filtros.zona_id) {
        consulta.whereExists((c) =>
            c
                .from('core.clientes as c_zf')
                .whereRaw('c_zf.id = s.cliente_id')
                .where('c_zf.zona_id', filtros.zona_id!),
        )
    }
    if (filtros.con_deuda_vencida !== undefined) {
        const deuda = (f: DatabaseQueryBuilderContract<any>) =>
            f
                .from('billing.facturas as f_v')
                .whereRaw('f_v.servicio_id = s.id')
                .where('f_v.estado', 'vencida')
        if (filtros.con_deuda_vencida) consulta.whereExists(deuda)
        else consulta.whereNotExists(deuda)
    }
    if (filtros.q) {
        const texto = filtros.q.trim()
        if (isIP(texto)) {
            consulta.where((w) =>
                w
                    .whereExists((a) =>
                        a
                            .from('network.ipv4_asignaciones as a4')
                            .whereRaw('a4.servicio_id = s.id')
                            .whereNull('a4.fin')
                            .whereRaw('a4.ip = ?::inet', [texto]),
                    )
                    .orWhereExists((a) =>
                        a
                            .from('network.ipv6_asignaciones as a6')
                            .whereRaw('a6.servicio_id = s.id')
                            .whereNull('a6.fin')
                            .whereRaw('a6.prefijo >>= ?::inet', [texto]),
                    ),
            )
        } else {
            const patron = `%${texto.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
            consulta.where((w) =>
                w
                    .whereILike('s.user_ppp', patron)
                    .orWhereExists((c) =>
                        c
                            .from('core.clientes as c_q')
                            .whereRaw('c_q.id = s.cliente_id')
                            .whereILike('c_q.nombre', patron),
                    ),
            )
        }
    }
    filtrarPorAlcance(consulta, alcance, dimensionesServicio)
    filtrarPorEmpresa(consulta, empresas, servicioEnEmpresas)
    return paginar<ServicioVista>(consulta, filtros, { columna: 's.id' })
}

/** Dimensiones de alcance de un servicio: su router y la zona de su cliente. */
export async function dimensionesDeServicio(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<DimensionesRecurso> {
    const fila = (await cliente
        .from('core.servicios as s')
        .join('core.clientes as c', 'c.id', 's.cliente_id')
        .where('s.id', id)
        .select('s.router_id', 'c.zona_id')
        .first()) as { router_id: number; zona_id: number | null } | null
    if (!fila) throw new NoEncontrado(`El servicio ${id} no existe`)
    return { router: [fila.router_id], zona: [fila.zona_id] }
}

/** `core.servicios as s` en alguna de esas empresas. */
export function servicioEnEmpresas(q: DatabaseQueryBuilderContract<any>, ids: number[]) {
    q.whereIn('s.empresa_id', ids)
}
