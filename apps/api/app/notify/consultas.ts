import db from '@adonisjs/lucid/services/db'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'

/**
 * Consultas de solo lectura del módulo notify (panel).
 */

type Fila = Record<string, unknown> & { id: number }

export async function listarPlantillas(): Promise<Fila[]> {
    return (await db
        .from('notify.plantillas')
        .select('id', 'evento', 'canal', 'asunto', 'cuerpo', 'activa', 'version', 'created_at', 'updated_at')
        .orderBy('evento')
        .orderBy('canal')) as Fila[]
}

export interface FiltrosEnvios extends OpcionesPaginacion {
    cliente_id?: number
    evento?: string
    canal?: string
    estado?: string
}

export async function listarEnvios(filtros: FiltrosEnvios): Promise<Pagina<Fila>> {
    const consulta = db
        .from('notify.envios')
        .select(
            'id',
            'cliente_id',
            'origen',
            'evento',
            'canal',
            'destino',
            'asunto',
            'cuerpo',
            'estado',
            'error',
            'intentos',
            'proveedor_id',
            'fallback_de',
            'enviado_en',
            'created_at',
            'updated_at',
        )
        .if(filtros.cliente_id, (q) => q.where('cliente_id', filtros.cliente_id!))
        .if(filtros.evento, (q) => q.where('evento', filtros.evento!))
        .if(filtros.canal, (q) => q.where('canal', filtros.canal!))
        .if(filtros.estado, (q) => q.where('estado', filtros.estado!))

    return paginar<Fila>(consulta, filtros)
}
