import db from '@adonisjs/lucid/services/db'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'

/**
 * Listas del panel: envíos a Horus y webhooks recibidos de Horus. Con empresas (empresa activa o
 * alcance del usuario) se ven los de esas empresas y los que no son de ninguna (routers,
 * clientes, eventos sin servicio).
 */

function porEmpresa<Q extends { where: (...a: any[]) => Q }>(consulta: Q, empresas: number[] | null): Q {
    if (empresas === null) return consulta
    return consulta.where((q: any) => q.whereIn('empresa_id', empresas).orWhereNull('empresa_id'))
}

export async function listarEnviosHorus(
    filtros: OpcionesPaginacion & { estado?: string; evento?: string },
    empresas: number[] | null,
) {
    const consulta = db
        .from('integraciones.horus_envios')
        .select(
            'id',
            'evento_id',
            'evento',
            'empresa_id',
            'estado',
            'intentos',
            'proximo_intento_en',
            'ultimo_status',
            'ultimo_error',
            'enviado_en',
            'created_at',
            'updated_at',
        )
        .if(filtros.estado, (q) => q.where('estado', filtros.estado!))
        .if(filtros.evento, (q) => q.where('evento', filtros.evento!))
    return paginar(porEmpresa(consulta, empresas), filtros)
}

export async function listarRecibidosHorus(
    filtros: OpcionesPaginacion & { servicio_id?: number; evento?: string },
    empresas: number[] | null,
) {
    const consulta = db
        .from('integraciones.horus_recibidos')
        .select(
            'id',
            'webhook_id',
            'evento',
            'ocurrido_en',
            'estado',
            'evento_interno',
            'empresa_id',
            'servicio_id',
            'created_at',
        )
        .if(filtros.servicio_id, (q) => q.where('servicio_id', filtros.servicio_id!))
        .if(filtros.evento, (q) => q.where('evento', filtros.evento!))
    return paginar(porEmpresa(consulta, empresas), filtros)
}
