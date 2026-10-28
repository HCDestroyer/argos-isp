import type { QueryClientContract } from '@adonisjs/lucid/types/database'

/**
 * Servicio `pendiente_instalacion` (`contratos/instalacion.md` §3, «Corte, mora y recordatorios
 * (A3/A6): no aplican mientras está pendiente»; pedido de A3 en `a3.md`).
 *
 * - Recordatorios de pago (`recordatorio.<n>`) y aviso de factura vencida (`factura.vencida`): no
 *   se programan para una factura de un servicio pendiente (p. ej. el cargo único anticipado de la
 *   instalación). `ProgramarRecordatorios` ya los excluye en su consulta; esto cubre además un
 *   evento que llegue igual.
 * - `servicio.estado_cambiado` de `pendiente_instalacion` a `activo` (la activación de la
 *   instalación): la plantilla del cambio de estado diría «Servicio reactivado… está activo de
 *   nuevo», que no es cierto para un servicio nuevo; no se avisa con ella.
 * - El aviso de `factura.emitida` sí sale: el cargo único es una factura cobrable.
 */

export const ESTADO_PENDIENTE = 'pendiente_instalacion'

function esMora(evento: string): boolean {
    return evento === 'factura.vencida' || /^recordatorio\.\d+$/.test(evento)
}

async function servicioDelAviso(
    trx: QueryClientContract,
    payload: Record<string, unknown>,
): Promise<number | null> {
    const directo = Number(payload.servicio_id)
    if (Number.isInteger(directo) && directo > 0) return directo
    const facturaId = Number(payload.factura_id)
    if (!Number.isInteger(facturaId) || facturaId <= 0) return null
    const fila = (await trx
        .from('billing.facturas')
        .where('id', facturaId)
        .select('servicio_id')
        .first()) as {
        servicio_id: number | null
    } | null
    return fila?.servicio_id ? Number(fila.servicio_id) : null
}

/** true si el aviso no aplica porque el servicio está (o estaba) pendiente de instalación. */
export async function avisoNoAplicaPorInstalacion(
    trx: QueryClientContract,
    evento: string,
    payload: Record<string, unknown>,
): Promise<boolean> {
    if (evento === 'servicio.estado_cambiado') {
        return payload.de === ESTADO_PENDIENTE && payload.a === 'activo'
    }
    if (!esMora(evento)) return false
    const servicioId = await servicioDelAviso(trx, payload)
    if (servicioId === null) return false
    const fila = (await trx.from('core.servicios').where('id', servicioId).select('estado').first()) as {
        estado: string
    } | null
    return fila?.estado === ESTADO_PENDIENTE
}
