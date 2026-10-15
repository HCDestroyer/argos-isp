import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { esEvento, type NombreEvento, type PayloadEvento } from '#shared/eventos'

/**
 * Escritura en `audit.outbox`. Toda acción emite con `t.emit(evento, payload)`, que llama aquí
 * dentro de su transacción. El relay (tarea 10 de A1) publica las filas pendientes a Redis Streams
 * y marca `publicado_en`; nunca se borran.
 */
export async function insertarEvento<E extends NombreEvento>(
    cliente: QueryClientContract,
    evento: E,
    payload: PayloadEvento<E>,
    requestId: string | null,
): Promise<number> {
    // El tipo ya lo garantiza; esto protege a quien llame con un string armado en tiempo de ejecución.
    if (!esEvento(evento)) throw new Error(`Evento fuera del catálogo: ${String(evento)}`)
    const [fila] = (await cliente
        .insertQuery()
        .table('audit.outbox')
        .insert({ evento, payload: JSON.stringify(payload), request_id: requestId })
        .returning('id')) as Array<{ id: number }>
    return fila!.id
}
