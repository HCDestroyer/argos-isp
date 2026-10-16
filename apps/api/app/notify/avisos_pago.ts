import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { plantillasActivas } from '#notify/envios'

/**
 * Reglas de los avisos de pago (día 4, tanda 2). Las usa `ProgramarNotificacion` dentro de su
 * transacción.
 *
 * **Un solo aviso de pago por pago y cliente.** Al aprobar un comprobante, A3 emite en la misma
 * transacción `pago.registrado` y `comprobante.aprobado` del mismo pago. El pagador recibe el de
 * `comprobante.aprobado` ("Verificamos tu comprobante… por Q 300.00"): cierra el hilo que abrió
 * `comprobante.recibido` ("Recibimos tu comprobante, lo revisaremos"), y es el que el cliente
 * espera. `pago.registrado` se omite para el pagador cuando el pago tiene un comprobante en
 * `billing.comprobantes.pago_id` (escrito en la misma transacción que el evento, así que la regla
 * no depende del orden de entrega) y `comprobante.aprobado` tiene plantilla activa; si esa
 * plantilla está desactivada, el aviso sale por `pago.registrado`. Además, antes de programar
 * cualquiera de los dos, se bloquea `pago:<id>` y se busca un aviso ya programado de ese pago para
 * el cliente desde otro origen: si existe, no se crea otro.
 *
 * **Pago de terceros.** `pago.registrado` trae `clientes[]` (pagador y dueños de las facturas). Cada
 * dueño distinto del pagador recibe `pago.registrado.tercero` ("Recibimos el pago de tu factura N,
 * hecho por <pagador>"), con el mismo origen `outbox:<id>`: es idempotente por (evento, cliente).
 * Los dueños reciben este aviso aunque el pago venga de un comprobante.
 */

export const EVENTO_PAGO_TERCERO = 'pago.registrado.tercero'

/** Eventos que avisan al pagador de un pago: a lo sumo uno por pago y cliente. */
export const EVENTOS_AVISO_PAGO: ReadonlySet<string> = new Set(['pago.registrado', 'comprobante.aprobado'])

function entero(valor: unknown): number | null {
    if (typeof valor === 'number' && Number.isInteger(valor) && valor > 0) return valor
    if (typeof valor === 'string' && /^\d+$/.test(valor)) return Number(valor)
    return null
}

/** Dueños de facturas distintos del pagador (`clientes ?? [cliente_id]`, sin repetir). */
export function tercerosDelPago(payload: Record<string, unknown>, pagadorId: number): number[] {
    const clientes = Array.isArray(payload.clientes) ? payload.clientes : []
    const ids = clientes.map(entero).filter((id): id is number => id !== null && id !== pagadorId)
    return [...new Set(ids)]
}

/** Serializa los avisos de un mismo pago (dos eventos del pago procesados a la vez). */
export async function bloquearAvisoDePago(
    trx: TransactionClientContract,
    payload: Record<string, unknown>,
): Promise<number | null> {
    const pagoId = entero(payload.pago_id)
    if (pagoId === null) return null
    await trx.rawQuery('SELECT pg_advisory_xact_lock(hashtext(?))', [`notify:pago:${pagoId}`])
    return pagoId
}

/** El pago salió de aprobar un comprobante y `comprobante.aprobado` avisa al pagador. */
export async function pagoCubiertoPorComprobante(
    trx: TransactionClientContract,
    pagoId: number,
): Promise<boolean> {
    const comprobante = await trx.from('billing.comprobantes').where('pago_id', pagoId).select('id').first()
    if (!comprobante) return false
    const plantillas = await plantillasActivas(trx, 'comprobante.aprobado')
    return plantillas.size > 0
}

/** Ya hay un aviso de este pago para el cliente desde otro origen (otro evento del mismo pago). */
export async function avisoDePagoYaProgramado(
    trx: TransactionClientContract,
    pagoId: number,
    clienteId: number,
    origen: string,
): Promise<boolean> {
    const fila = await trx
        .from('notify.envios')
        .where('cliente_id', clienteId)
        .whereIn('evento', [...EVENTOS_AVISO_PAGO])
        .whereNot('origen', origen)
        .whereRaw(`variables->'pago'->>'id' = ?`, [String(pagoId)])
        .select('id')
        .first()
    return Boolean(fila)
}
