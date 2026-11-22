import db from '@adonisjs/lucid/services/db'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'

/**
 * Alerta de caídas repetidas en Argos (decisión del PM 31): cada `servicio.caidas_repetidas` emitido
 * deja su fila en `network.caidas_repetidas`; el panel la muestra en la ficha del servicio y en Red.
 */
export interface CaidaRepetidaVista {
    id: number
    servicio_id: number
    empresa_id: number
    cliente_id: number
    sesion_id: number
    desde: string
    hasta: string
    sesiones: number
    umbral: number
    ventana_minutos: number
    causas: Record<string, number>
    created_at: string
}

export async function listarCaidasRepetidas(
    filtro: { empresas: number[] | null; servicio_id?: number },
    opciones: OpcionesPaginacion,
): Promise<Pagina<CaidaRepetidaVista>> {
    const consulta = db
        .from('network.caidas_repetidas as c')
        .join('core.servicios as s', 's.id', 'c.servicio_id')
        .select(
            'c.id',
            'c.servicio_id',
            'c.empresa_id',
            's.cliente_id',
            'c.sesion_id',
            'c.desde',
            'c.hasta',
            'c.sesiones',
            'c.umbral',
            'c.ventana_minutos',
            'c.causas',
            'c.created_at',
        )
    if (filtro.empresas) consulta.whereIn('c.empresa_id', filtro.empresas)
    if (filtro.servicio_id) consulta.where('c.servicio_id', filtro.servicio_id)
    const pagina = await paginar<Record<string, unknown>>(consulta, opciones, {
        columna: 'c.id',
        clave: (f) => Number(f.id),
    })
    const iso = (v: unknown) => new Date(v as Date).toISOString()
    return {
        ...pagina,
        data: pagina.data.map((f) => ({
            id: Number(f.id),
            servicio_id: Number(f.servicio_id),
            empresa_id: Number(f.empresa_id),
            cliente_id: Number(f.cliente_id),
            sesion_id: Number(f.sesion_id),
            desde: iso(f.desde),
            hasta: iso(f.hasta),
            sesiones: Number(f.sesiones),
            umbral: Number(f.umbral),
            ventana_minutos: Number(f.ventana_minutos),
            causas: f.causas as Record<string, number>,
            created_at: iso(f.created_at),
        })),
    }
}
