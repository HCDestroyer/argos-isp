import db from '@adonisjs/lucid/services/db'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'

/**
 * Consultas de solo lectura sobre `audit.acciones` y `audit.cambios` (pantalla de bitácora).
 */

export interface FiltrosAcciones extends OpcionesPaginacion {
    actor_id?: number
    accion?: string
    entidad_tipo?: string
    entidad_id?: number
    request_id?: string
    desde?: Date
    hasta?: Date
    /** acciones sobre el cliente y sobre sus servicios, facturas, pagos y promesas */
    cliente_id?: number
    canal?: string
    excluir_canal?: string
}

/** Entidades que pertenecen a un cliente: tipo en `audit.acciones` → tabla con `cliente_id`. */
const ENTIDADES_DEL_CLIENTE: Record<string, string> = {
    servicio: 'core.servicios',
    factura: 'billing.facturas',
    pago: 'billing.pagos',
    promesa: 'billing.promesas',
}

export interface FiltrosCambios extends OpcionesPaginacion {
    entidad_tipo?: string
    entidad_id?: number
    request_id?: string
}

type Fila = Record<string, unknown> & { id: number }

export async function listarAcciones(filtros: FiltrosAcciones): Promise<Pagina<Fila>> {
    const consulta = db
        .from('audit.acciones as a')
        .leftJoin('core.usuarios as u_a', (j) =>
            j.on('u_a.id', '=', 'a.actor_id').andOnVal('a.actor_tipo', '<>', 'cliente'),
        )
        .leftJoin('core.clientes as cl_a', (j) =>
            j.on('cl_a.id', '=', 'a.actor_id').andOnVal('a.actor_tipo', '=', 'cliente'),
        )
        .select(
            'a.id',
            'a.actor_tipo',
            'a.actor_id',
            // tokens y agentes también son usuarios; un actor cliente, el nombre del cliente; el sistema, null
            db.raw('COALESCE(u_a.nombre, cl_a.nombre) AS actor_nombre'),
            'a.canal',
            'a.accion',
            'a.entidad_tipo',
            'a.entidad_id',
            'a.entrada',
            'a.resultado',
            'a.error',
            'a.request_id',
            'a.created_at',
        )
        .if(filtros.actor_id, (q) => q.where('a.actor_id', filtros.actor_id!))
        .if(filtros.accion, (q) => q.where('a.accion', filtros.accion!))
        .if(filtros.entidad_tipo, (q) => q.where('a.entidad_tipo', filtros.entidad_tipo!))
        .if(filtros.entidad_id, (q) => q.where('a.entidad_id', filtros.entidad_id!))
        .if(filtros.request_id, (q) => q.where('a.request_id', filtros.request_id!))
        .if(filtros.desde, (q) => q.where('a.created_at', '>=', filtros.desde!))
        .if(filtros.hasta, (q) => q.where('a.created_at', '<', filtros.hasta!))
        .if(filtros.canal, (q) => q.where('a.canal', filtros.canal!))
        .if(filtros.excluir_canal, (q) => q.whereNot('a.canal', filtros.excluir_canal!))

    if (filtros.cliente_id) {
        const clienteId = filtros.cliente_id
        consulta.where((w) => {
            w.where((c) => c.where('a.entidad_tipo', 'cliente').where('a.entidad_id', clienteId))
            for (const [tipo, tabla] of Object.entries(ENTIDADES_DEL_CLIENTE)) {
                w.orWhere((c) =>
                    c
                        .where('a.entidad_tipo', tipo)
                        .whereIn('a.entidad_id', db.from(tabla).where('cliente_id', clienteId).select('id')),
                )
            }
        })
    }

    return paginar<Fila>(consulta, filtros, { columna: 'a.id' })
}

export async function listarCambios(filtros: FiltrosCambios): Promise<Pagina<Fila>> {
    const consulta = db
        .from('audit.cambios as c')
        .leftJoin('core.usuarios as u_c', (j) =>
            j.on('u_c.id', '=', 'c.actor_id').andOnVal('c.actor_tipo', '<>', 'cliente'),
        )
        .leftJoin('core.clientes as cl_c', (j) =>
            j.on('cl_c.id', '=', 'c.actor_id').andOnVal('c.actor_tipo', '=', 'cliente'),
        )
        .select(
            'c.id',
            'c.entidad_tipo',
            'c.entidad_id',
            'c.campo',
            'c.antes',
            'c.despues',
            'c.actor_tipo',
            'c.actor_id',
            db.raw('COALESCE(u_c.nombre, cl_c.nombre) AS actor_nombre'),
            'c.request_id',
            'c.created_at',
        )
        .if(filtros.entidad_tipo, (q) => q.where('c.entidad_tipo', filtros.entidad_tipo!))
        .if(filtros.entidad_id, (q) => q.where('c.entidad_id', filtros.entidad_id!))
        .if(filtros.request_id, (q) => q.where('c.request_id', filtros.request_id!))

    return paginar<Fila>(consulta, filtros, { columna: 'c.id' })
}
