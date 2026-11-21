import db from '@adonisjs/lucid/services/db'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'

/**
 * Reporte de cambios de titular que llegaron por Iris (contrato Iris 0.10.0, ajuste aj; decisión 9
 * del PM): sobre todo los `existente: true` (el servicio se asignó al momento a un cliente que ya
 * existía), para que caja o supervisión los revise. Sale de `servicio.titular_cambiado` en el outbox.
 */
export interface CambioTitularIris {
    id: number
    servicio_id: number
    empresa_id: number
    de_cliente_id: number
    a_cliente_id: number
    existente: boolean
    posible_duplicado: boolean
    de_cliente_eliminado: boolean
    motivo_codigo: string
    origen_tipo: string | null
    origen_id: string | null
    ocurrido_en: string
}

export async function listarCambiosTitularIris(
    filtros: OpcionesPaginacion & { existente?: boolean; posible_duplicado?: boolean },
    empresas: number[] | null,
): Promise<Pagina<CambioTitularIris>> {
    const consulta = db
        .from('audit.outbox as o')
        .where('o.evento', 'servicio.titular_cambiado')
        .select(
            'o.id',
            db.raw(`(o.payload->>'servicio_id')::bigint AS servicio_id`),
            db.raw(`(o.payload->>'empresa_id')::bigint AS empresa_id`),
            db.raw(`(o.payload->>'de_cliente_id')::bigint AS de_cliente_id`),
            db.raw(`(o.payload->>'a_cliente_id')::bigint AS a_cliente_id`),
            db.raw(`(o.payload->>'existente')::boolean AS existente`),
            db.raw(`(o.payload->>'posible_duplicado')::boolean AS posible_duplicado`),
            db.raw(`(o.payload->>'de_cliente_eliminado')::boolean AS de_cliente_eliminado`),
            db.raw(`o.payload->>'motivo_codigo' AS motivo_codigo`),
            db.raw(`o.payload->>'origen_tipo' AS origen_tipo`),
            db.raw(`o.payload->>'origen_id' AS origen_id`),
            'o.created_at as ocurrido_en',
        )
    if (filtros.existente !== undefined) {
        consulta.whereRaw(`(o.payload->>'existente')::boolean = ?`, [filtros.existente])
    }
    if (filtros.posible_duplicado !== undefined) {
        consulta.whereRaw(`(o.payload->>'posible_duplicado')::boolean = ?`, [filtros.posible_duplicado])
    }
    if (empresas !== null) {
        consulta.whereRaw(`(o.payload->>'empresa_id')::bigint = ANY(CAST(? AS bigint[]))`, [
            `{${empresas.join(',')}}`,
        ])
    }
    return paginar<CambioTitularIris>(consulta, filtros, { columna: 'o.id' })
}
