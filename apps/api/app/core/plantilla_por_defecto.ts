import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { ValidacionFallida } from '#shared/errores'
import { plantillaPorDefectoId } from '#billing/plantillas'

/**
 * Plantilla de facturación por defecto al crear un servicio sin `plantilla_facturacion_id`
 * (pedido de A4: el rol `tecnico` crea servicios y no tiene `plantillas.ver`).
 *
 * Regla (`POST /servicios`):
 *   - `plantilla_facturacion_id` con un id → esa plantilla.
 *   - `plantilla_facturacion_id: null` explícito → sin plantilla (no se factura hasta asignarla).
 *   - Ausente → plantilla por defecto:
 *       - la marcada con `billing.plantillas_facturacion.por_defecto` (A3: a lo sumo una, índice
 *         único parcial; se lee con `plantillaPorDefectoId` de `#billing/plantillas`);
 *       - sin marcada: si hay exactamente una plantilla, esa; si no hay ninguna, sin plantilla; si
 *         hay varias, 422 en `plantilla_facturacion_id` pidiendo elegir (o marcar una por defecto).
 *
 * Las llamadas internas a `CrearServicio` (importador) no piden la plantilla por defecto: siguen
 * con `plantilla_facturacion_id` tal como lo pasan.
 */

/** Decide con los ids candidatos (a lo sumo dos bastan para saber si hay varias). */
export function elegirPlantilla(candidatas: readonly number[]): number | null {
    if (candidatas.length === 0) return null
    if (candidatas.length === 1) return candidatas[0]!
    throw new ValidacionFallida(
        [
            {
                field: 'plantilla_facturacion_id',
                message: 'Hay varias plantillas de facturación y ninguna por defecto: elige una',
                rule: 'required',
            },
        ],
        'Hay varias plantillas de facturación y ninguna está marcada por defecto: indica plantilla_facturacion_id',
    )
}

export async function plantillaPorDefecto(trx: TransactionClientContract): Promise<number | null> {
    const marcada = await plantillaPorDefectoId(trx)
    if (marcada !== null) return marcada
    const todas = (await trx
        .from('billing.plantillas_facturacion')
        .orderBy('id')
        .limit(2)
        .select('id')) as Array<{ id: number }>
    return elegirPlantilla(todas.map((f) => Number(f.id)))
}
