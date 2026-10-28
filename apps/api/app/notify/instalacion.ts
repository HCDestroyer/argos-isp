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
 *   instalación, `motivo: instalacion`): en vez de la plantilla del cambio de estado («Servicio
 *   reactivado… está activo de nuevo», que no es cierto para un servicio nuevo) se avisa con la
 *   bienvenida, `servicio.instalacion_activada` (decisión del PM, 28 oct). Mismo origen
 *   `outbox:<id>`: si el evento llega dos veces no se repite.
 * - El aviso de `factura.emitida` sí sale: el cargo único es una factura cobrable.
 */

export const ESTADO_PENDIENTE = 'pendiente_instalacion'
/** Plantilla de la bienvenida al activar la instalación. */
export const EVENTO_BIENVENIDA = 'servicio.instalacion_activada'

/** La activación de la instalación (`de: pendiente_instalacion`, `a: activo`). */
export function esActivacionInstalacion(evento: string, payload: Record<string, unknown>): boolean {
    return evento === 'servicio.estado_cambiado' && payload.de === ESTADO_PENDIENTE && payload.a === 'activo'
}

/** Plantilla con que se avisa el evento: la bienvenida en la activación de la instalación. */
export function eventoDelAviso(evento: string, payload: Record<string, unknown>): string {
    return esActivacionInstalacion(evento, payload) ? EVENTO_BIENVENIDA : evento
}

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
    if (!esMora(evento)) return false
    const servicioId = await servicioDelAviso(trx, payload)
    if (servicioId === null) return false
    const fila = (await trx.from('core.servicios').where('id', servicioId).select('estado').first()) as {
        estado: string
    } | null
    return fila?.estado === ESTADO_PENDIENTE
}
