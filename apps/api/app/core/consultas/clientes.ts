import { isIP } from 'node:net'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { DatabaseQueryBuilderContract } from '@adonisjs/lucid/types/querybuilder'
import { NoEncontrado } from '#shared/errores'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'
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
    'version',
    'created_at',
    'updated_at',
] as const

export type ClienteVista = Record<(typeof COLUMNAS_CLIENTE)[number], unknown> & {
    id: number
    version: number
}

export interface FiltrosClientes extends OpcionesPaginacion {
    q?: string
    zona_id?: number
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

export async function buscarClientes(
    filtros: FiltrosClientes,
    alcance?: Alcance,
): Promise<Pagina<ClienteVista>> {
    const consulta = db.from('core.clientes as c').select(COLUMNAS_CLIENTE.map((col) => `c.${col}`))
    if (filtros.zona_id) consulta.where('c.zona_id', filtros.zona_id)
    if (filtros.q) aplicarBusqueda(consulta, filtros.q)
    filtrarPorAlcance(consulta, alcance, dimensionesCliente)
    return paginar<ClienteVista>(consulta, filtros, { columna: 'c.id' })
}

export async function verCliente(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<ClienteVista> {
    const fila = (await cliente
        .from('core.clientes')
        .where('id', id)
        .select([...COLUMNAS_CLIENTE])
        .first()) as ClienteVista | null
    if (!fila) throw new NoEncontrado(`El cliente ${id} no existe`)
    return fila
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

export async function listarZonas() {
    return db
        .from('core.zonas')
        .orderBy('nombre')
        .select('id', 'nombre', 'version', 'created_at', 'updated_at')
}

export async function verZona(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = await cliente
        .from('core.zonas')
        .where('id', id)
        .select('id', 'nombre', 'version', 'created_at', 'updated_at')
        .first()
    if (!fila) throw new NoEncontrado(`La zona ${id} no existe`)
    return fila as { id: number; nombre: string; version: number }
}
