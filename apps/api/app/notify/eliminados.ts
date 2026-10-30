import type { QueryClientContract } from '@adonisjs/lucid/types/database'

/**
 * Servicios eliminados (`contratos/eliminar.md`, A1): un servicio sin historial se borra y su fila
 * de `core.servicios` deja de existir. Un evento `servicio.*` atrasado de ese servicio (por ejemplo
 * un `servicio.estado_cambiado` que el bus entrega después del `servicio.eliminado`) no se avisa
 * al cliente: hablaría de un servicio que ya no tiene. No es un error (el consumidor no reintenta)
 * y no deja envío. Las alertas internas (`routeros.fallido`, `coa.fallido` de la limpieza del
 * router) sí salen: nombran el servicio por su id (`#812`).
 */
export async function servicioEliminado(
    trx: QueryClientContract,
    evento: string,
    payload: Record<string, unknown>,
): Promise<boolean> {
    if (!evento.startsWith('servicio.')) return false
    const id = Number(payload.servicio_id)
    if (!Number.isInteger(id) || id <= 0) return false
    const fila = await trx.from('core.servicios').where('id', id).select('id').first()
    return !fila
}
