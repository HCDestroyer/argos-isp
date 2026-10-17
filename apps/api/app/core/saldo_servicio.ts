import { Decimal } from 'decimal.js'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'

/**
 * Saldo pendiente de un servicio: lo que falta por cobrar de sus facturas vivas (`emitida`,
 * `parcial`, `vencida`): `total − pagado` (el `pagado` incluye lo acreditado por notas de crédito).
 *
 * Provisional (multiempresa, `servicios.cambiar_empresa`): A3 es dueño de `billing` y debe exponer
 * esta consulta; mientras tanto se lee aquí sin escribir nada (ver `.claude/integration/a1.md`).
 */
export async function saldoPendienteServicio(
    servicioId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<Decimal> {
    const fila = (await cliente
        .from('billing.facturas')
        .where('servicio_id', servicioId)
        .whereIn('estado', ['emitida', 'parcial', 'vencida'])
        .select(cliente.raw('coalesce(sum(total - pagado), 0)::text AS saldo'))
        .first()) as { saldo: string }
    return new Decimal(fila.saldo)
}
