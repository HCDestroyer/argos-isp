import { isIP } from 'node:net'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { DatabaseQueryBuilderContract } from '@adonisjs/lucid/types/querybuilder'
import { NoEncontrado } from '#shared/errores'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'
import type { EstadoServicio } from '#shared/eventos'
import { filtrarPorAlcance, type Alcance, type DimensionesRecurso, type FiltrosDimension } from '#core/acl'

/**
 * Lecturas de clientes y zonas. `buscarClientes` busca por nombre, nombre fiscal, NIT/CUI,
 * teléfono o móvil, correo, user_ppp de alguno de sus servicios o una IP (IPv4 vigente o IPv6
 * dentro de un prefijo vigente).
 */

export const COLUMNAS_CLIENTE = [
    'id',
    'nombre',
    'tipo',
    'nit_cui',
    'nombre_fiscal',
    'direccion_fiscal',
    'email',
    'telefono',
    'movil',
    'direccion',
    'coordenadas',
    'zona_id',
    'campos_personalizados',
    'canal_preferido',
    'telegram_chat_id',
    'responsable_pago_id',
    'version',
    'created_at',
    'updated_at',
] as const

export type ClienteVista = Record<(typeof COLUMNAS_CLIENTE)[number], unknown> & {
    id: number
    version: number
    responsable_pago_id: number | null
    /** nombre del responsable de pago (lectura; no es columna) */
    responsable_pago_nombre: string | null
}

/** Nombre del responsable de pago de `core.clientes as c` (subconsulta escalar). */
const NOMBRE_RESPONSABLE =
    '(SELECT r.nombre FROM core.clientes r WHERE r.id = c.responsable_pago_id) AS responsable_pago_nombre'

function columnasVista(cliente: QueryClientContract) {
    return [...COLUMNAS_CLIENTE.map((col) => `c.${col}`), cliente.raw(NOMBRE_RESPONSABLE)]
}

export interface FiltrosClientes extends OpcionesPaginacion {
    q?: string
    zona_id?: number
    /** cliente con al menos un servicio que cumpla a la vez estado, router y plan */
    estado_servicio?: EstadoServicio
    router_id?: number
    plan_id?: number
    /** alguna `billing.facturas` en estado `vencida` (true) o ninguna (false) */
    con_deuda_vencida?: boolean
    /** alguna `billing.promesas` en estado `activa` (true) o ninguna (false) */
    con_promesa_activa?: boolean
    /** dependientes de este responsable de pago */
    responsable_pago_id?: number
}

/** Cómo se filtra `core.clientes as c` por alcance. */
export const dimensionesCliente: FiltrosDimension = {
    zona: (q, ids) => q.whereIn('c.zona_id', ids),
    router: (q, ids) =>
        q.whereExists((s) =>
            s
                .from('core.servicios as s_al')
                .whereRaw('s_al.cliente_id = c.id')
                .whereIn('s_al.router_id', ids),
        ),
}

function escaparLike(texto: string): string {
    return texto.replace(/[\\%_]/g, (c) => `\\${c}`)
}

function aplicarBusqueda(consulta: DatabaseQueryBuilderContract<any>, q: string) {
    const texto = q.trim()
    if (texto === '') return

    if (isIP(texto)) {
        consulta.whereExists((s) =>
            s
                .from('core.servicios as s_ip')
                .whereRaw('s_ip.cliente_id = c.id')
                .where((w) =>
                    w
                        .whereExists((a) =>
                            a
                                .from('network.ipv4_asignaciones as a4')
                                .whereRaw('a4.servicio_id = s_ip.id')
                                .whereNull('a4.fin')
                                .whereRaw('a4.ip = ?::inet', [texto]),
                        )
                        .orWhereExists((a) =>
                            a
                                .from('network.ipv6_asignaciones as a6')
                                .whereRaw('a6.servicio_id = s_ip.id')
                                .whereNull('a6.fin')
                                .whereRaw('a6.prefijo >>= ?::inet', [texto]),
                        ),
                ),
        )
        return
    }

    const patron = `%${escaparLike(texto)}%`
    const digitos = texto.replace(/\D/g, '')
    const nit = texto.replace(/[\s-]/g, '').toUpperCase()
    consulta.where((w) => {
        w.whereILike('c.nombre', patron)
            .orWhereILike('c.nombre_fiscal', patron)
            .orWhereILike('c.email', patron)
            .orWhere('c.nit_cui', nit)
            .orWhereExists((s) =>
                s
                    .from('core.servicios as s_q')
                    .whereRaw('s_q.cliente_id = c.id')
                    .whereILike('s_q.user_ppp', patron),
            )
        if (digitos.length >= 4) {
            // teléfonos guardados con espacios o guiones: se comparan solo los dígitos
            const tel = `%${digitos}%`
            w.orWhereRaw(`regexp_replace(coalesce(c.telefono, ''), '\\D', '', 'g') LIKE ?`, [tel]).orWhereRaw(
                `regexp_replace(coalesce(c.movil, ''), '\\D', '', 'g') LIKE ?`,
                [tel],
            )
        }
    })
}

/**
 * Filtros del listado (pedido del PM): estado, router y plan se exigen sobre el MISMO servicio;
 * deuda vencida y promesa activa son solo lectura sobre `billing` (A3 es dueño de esas tablas).
 */
function aplicarFiltrosAvanzados(consulta: DatabaseQueryBuilderContract<any>, filtros: FiltrosClientes) {
    if (filtros.estado_servicio || filtros.router_id || filtros.plan_id) {
        consulta.whereExists((s) => {
            s.from('core.servicios as s_f').whereRaw('s_f.cliente_id = c.id')
            if (filtros.estado_servicio) s.where('s_f.estado', filtros.estado_servicio)
            if (filtros.router_id) s.where('s_f.router_id', filtros.router_id)
            if (filtros.plan_id) s.where('s_f.plan_id', filtros.plan_id)
        })
    }
    if (filtros.con_deuda_vencida !== undefined) {
        const deuda = (s: DatabaseQueryBuilderContract<any>) =>
            s.from('billing.facturas as f_v').whereRaw('f_v.cliente_id = c.id').where('f_v.estado', 'vencida')
        if (filtros.con_deuda_vencida) consulta.whereExists(deuda)
        else consulta.whereNotExists(deuda)
    }
    if (filtros.con_promesa_activa !== undefined) {
        const promesa = (s: DatabaseQueryBuilderContract<any>) =>
            s.from('billing.promesas as p_a').whereRaw('p_a.cliente_id = c.id').where('p_a.estado', 'activa')
        if (filtros.con_promesa_activa) consulta.whereExists(promesa)
        else consulta.whereNotExists(promesa)
    }
}

export async function buscarClientes(
    filtros: FiltrosClientes,
    alcance?: Alcance,
): Promise<Pagina<ClienteVista>> {
    const consulta = db.from('core.clientes as c').select(columnasVista(db.connection()))
    if (filtros.zona_id) consulta.where('c.zona_id', filtros.zona_id)
    if (filtros.responsable_pago_id) consulta.where('c.responsable_pago_id', filtros.responsable_pago_id)
    if (filtros.q) aplicarBusqueda(consulta, filtros.q)
    aplicarFiltrosAvanzados(consulta, filtros)
    filtrarPorAlcance(consulta, alcance, dimensionesCliente)
    return paginar<ClienteVista>(consulta, filtros, { columna: 'c.id' })
}

export async function verCliente(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<ClienteVista> {
    const fila = (await cliente
        .from('core.clientes as c')
        .where('c.id', id)
        .select(columnasVista(cliente))
        .first()) as ClienteVista | null
    if (!fila) throw new NoEncontrado(`El cliente ${id} no existe`)
    return fila
}

/** Fila de `GET /clientes/:id/dependientes`. */
export interface DependienteVista {
    id: number
    nombre: string
    nit_cui: string | null
    /** servicios no retirados */
    servicios: number
    /**
     * Estado resumido de sus servicios: el más grave entre los no retirados
     * (`suspendido` > `limitado` > `activo`); `retirado` si todos lo están; null sin servicios.
     */
    estado_servicio: EstadoServicio | null
}

const RESUMEN_SERVICIOS = `
    (SELECT count(*) FILTER (WHERE s.estado <> 'retirado')::int
       FROM core.servicios s WHERE s.cliente_id = c.id) AS servicios,
    (SELECT CASE
                WHEN bool_or(s.estado = 'suspendido') THEN 'suspendido'
                WHEN bool_or(s.estado = 'limitado') THEN 'limitado'
                WHEN bool_or(s.estado = 'activo') THEN 'activo'
                WHEN count(*) > 0 THEN 'retirado'
            END
       FROM core.servicios s WHERE s.cliente_id = c.id) AS estado_servicio`

/**
 * Clientes de los que `responsableId` es responsable de pago (A4 los muestra debajo del pagador
 * en el cobro). 404 si el responsable no existe. Paginado por cursor sobre `c.id`.
 */
export async function listarDependientes(
    responsableId: number,
    opciones: OpcionesPaginacion,
    alcance?: Alcance,
): Promise<Pagina<DependienteVista>> {
    const existe = await db.from('core.clientes').where('id', responsableId).select('id').first()
    if (!existe) throw new NoEncontrado(`El cliente ${responsableId} no existe`)
    const consulta = db
        .from('core.clientes as c')
        .where('c.responsable_pago_id', responsableId)
        .select('c.id', 'c.nombre', 'c.nit_cui', db.raw(RESUMEN_SERVICIOS))
    filtrarPorAlcance(consulta, alcance, dimensionesCliente)
    return paginar<DependienteVista>(consulta, opciones, { columna: 'c.id', direccion: 'asc' })
}

/** Dimensiones de alcance de un cliente: su zona y los routers de sus servicios. */
export async function dimensionesDeCliente(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<DimensionesRecurso> {
    const fila = (await cliente.from('core.clientes').where('id', id).select('zona_id').first()) as {
        zona_id: number | null
    } | null
    if (!fila) throw new NoEncontrado(`El cliente ${id} no existe`)
    const routers = (await cliente
        .from('core.servicios')
        .where('cliente_id', id)
        .distinct('router_id')) as Array<{ router_id: number }>
    return { zona: [fila.zona_id], router: routers.map((r) => r.router_id) }
}

const COLUMNAS_ZONA = ['id', 'nombre', 'empresa_sugerida_id', 'version', 'created_at', 'updated_at']

export async function listarZonas() {
    return db.from('core.zonas').orderBy('nombre').select(COLUMNAS_ZONA)
}

export async function verZona(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = await cliente.from('core.zonas').where('id', id).select(COLUMNAS_ZONA).first()
    if (!fila) throw new NoEncontrado(`La zona ${id} no existe`)
    return fila as { id: number; nombre: string; empresa_sugerida_id: number | null; version: number }
}
