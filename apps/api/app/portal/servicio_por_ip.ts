import { Decimal } from 'decimal.js'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

/**
 * Consultas compartidas por las acciones públicas del portal (`portal.quien_soy`, `portal.estado`):
 * qué servicio corresponde a una IP de origen y cuánto debe.
 */

export type EstadoServicio = 'activo' | 'limitado' | 'suspendido' | 'retirado'

/** Zona en la que vence una factura (`vence_en` es fecha local de Guatemala). */
const ZONA = 'America/Guatemala'

/**
 * Servicio de una IP, en orden:
 * 1. `network.sesiones` activas (`fin IS NULL`): `ipv4` igual, o la IPv6 contenida en
 *    `prefijo_enlace_v6` o `prefijo_delegado_v6`. Gana la sesión más reciente.
 * 2. Asignaciones vigentes (`fin IS NULL`): `network.ipv4_asignaciones.ip` igual o
 *    `network.ipv6_asignaciones.prefijo` que contenga la IP (servicio sin sesión viva, IP fija).
 *
 * NEEDS(A1): reemplazar por `GET /ip/{ip}` (acción de A1) cuando se publique.
 */
export async function resolverServicio(trx: TransactionClientContract, ip: string): Promise<number | null> {
    const sesion = (await trx
        .from('network.sesiones')
        .whereNull('fin')
        .whereNotNull('servicio_id')
        .where((q) => {
            q.whereRaw('ipv4 = ?::inet', [ip])
                .orWhereRaw('prefijo_enlace_v6 >>= ?::inet', [ip])
                .orWhereRaw('prefijo_delegado_v6 >>= ?::inet', [ip])
        })
        .orderBy('inicio', 'desc')
        .orderBy('id', 'desc')
        .select('servicio_id')
        .first()) as { servicio_id: number } | null
    if (sesion) return Number(sesion.servicio_id)

    const asignacion = (await trx
        .from('network.ipv4_asignaciones')
        .whereNull('fin')
        .whereRaw('ip = ?::inet', [ip])
        .select('servicio_id')
        .unionAll((q) => {
            q.from('network.ipv6_asignaciones')
                .whereNull('fin')
                .whereRaw('prefijo >>= ?::inet', [ip])
                .select('servicio_id')
        })
        .first()) as { servicio_id: number } | null
    return asignacion ? Number(asignacion.servicio_id) : null
}

export interface SaldoServicio {
    /** saldo de las facturas en `emitida`, `parcial` o `vencida` */
    adeudado: Decimal
    vencidas: number
    vencidoTotal: Decimal
}

/**
 * Saldo (`total - pagado`) de las facturas pendientes del servicio, con `decimal.js`.
 * Vencidas = estado `vencida` o con `vence_en` anterior a hoy en Guatemala.
 */
export async function saldoDelServicio(
    trx: TransactionClientContract,
    servicioId: number,
): Promise<SaldoServicio> {
    const facturas = (await trx
        .from('billing.facturas')
        .where('servicio_id', servicioId)
        .whereIn('estado', ['emitida', 'parcial', 'vencida'])
        .select('total', 'pagado')
        .select(
            trx.raw(`(estado = 'vencida' OR vence_en < (now() AT TIME ZONE ?)::date) AS vencida`, [ZONA]),
        )) as { total: string; pagado: string; vencida: boolean }[]

    let adeudado = new Decimal(0)
    let vencidoTotal = new Decimal(0)
    let vencidas = 0
    for (const factura of facturas) {
        const saldo = new Decimal(factura.total).minus(factura.pagado)
        if (saldo.lessThanOrEqualTo(0)) continue
        adeudado = adeudado.plus(saldo)
        if (factura.vencida) {
            vencidas += 1
            vencidoTotal = vencidoTotal.plus(saldo)
        }
    }
    return { adeudado, vencidas, vencidoTotal }
}
