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
}

export interface FiltrosCambios extends OpcionesPaginacion {
    entidad_tipo?: string
    entidad_id?: number
    request_id?: string
}

type Fila = Record<string, unknown> & { id: number }

export async function listarAcciones(filtros: FiltrosAcciones): Promise<Pagina<Fila>> {
    const consulta = db
        .from('audit.acciones')
        .select(
            'id',
            'actor_tipo',
            'actor_id',
            'canal',
            'accion',
            'entidad_tipo',
            'entidad_id',
            'entrada',
            'resultado',
            'error',
            'request_id',
            'created_at',
        )
        .if(filtros.actor_id, (q) => q.where('actor_id', filtros.actor_id!))
        .if(filtros.accion, (q) => q.where('accion', filtros.accion!))
        .if(filtros.entidad_tipo, (q) => q.where('entidad_tipo', filtros.entidad_tipo!))
        .if(filtros.entidad_id, (q) => q.where('entidad_id', filtros.entidad_id!))
        .if(filtros.request_id, (q) => q.where('request_id', filtros.request_id!))
        .if(filtros.desde, (q) => q.where('created_at', '>=', filtros.desde!))
        .if(filtros.hasta, (q) => q.where('created_at', '<', filtros.hasta!))

    return paginar<Fila>(consulta, filtros)
}

export async function listarCambios(filtros: FiltrosCambios): Promise<Pagina<Fila>> {
    const consulta = db
        .from('audit.cambios')
        .select(
            'id',
            'entidad_tipo',
            'entidad_id',
            'campo',
            'antes',
            'despues',
            'actor_tipo',
            'actor_id',
            'request_id',
            'created_at',
        )
        .if(filtros.entidad_tipo, (q) => q.where('entidad_tipo', filtros.entidad_tipo!))
        .if(filtros.entidad_id, (q) => q.where('entidad_id', filtros.entidad_id!))
        .if(filtros.request_id, (q) => q.where('request_id', filtros.request_id!))

    return paginar<Fila>(consulta, filtros)
}
