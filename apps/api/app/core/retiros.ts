import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'

/**
 * Retiro de un servicio y su equipo en comodato (decisión del PM 17). De fábrica, al retirar se pide a
 * Iris la orden de retiro y los equipos quedan «por recuperar». No se pide con la casilla «el equipo
 * ya se entregó» (`equipo_entregado`) ni con el ajuste global `retiro.orden_iris` apagado. La decisión
 * se guarda en `core.servicios_retiros` y viaja en `servicio.estado_cambiado` (`recuperar_equipo`).
 */

export interface RetiroServicio {
    servicio_id: number
    motivo: string
    equipo_entregado: boolean
    recuperar_equipo: boolean
    creado_por: number | null
    created_at: string
}

/**
 * Interfaz pública para inventario (A3, `inventario.revisar_comodatos`) y la integración con Iris (A6):
 * el último retiro del servicio, o null si nunca se retiró (o se retiró antes de esta decisión: entonces
 * se recupera, como siempre).
 */
export async function ultimoRetiro(
    servicioId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<RetiroServicio | null> {
    const fila = (await cliente
        .from('core.servicios_retiros')
        .where('servicio_id', servicioId)
        .orderBy('id', 'desc')
        .select('servicio_id', 'motivo', 'equipo_entregado', 'recuperar_equipo', 'creado_por', 'created_at')
        .first()) as Record<string, unknown> | null
    if (!fila) return null
    return {
        servicio_id: Number(fila.servicio_id),
        motivo: String(fila.motivo),
        equipo_entregado: Boolean(fila.equipo_entregado),
        recuperar_equipo: Boolean(fila.recuperar_equipo),
        creado_por: fila.creado_por === null ? null : Number(fila.creado_por),
        created_at: new Date(fila.created_at as Date).toISOString(),
    }
}

/** ¿Hay que recuperar el equipo del servicio retirado? true si no hay registro (comportamiento de antes). */
export async function recuperarEquipoAlRetirar(
    servicioId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<boolean> {
    const retiro = await ultimoRetiro(servicioId, cliente)
    return retiro?.recuperar_equipo ?? true
}
