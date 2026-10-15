import { Decimal } from 'decimal.js'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DomainAction, type Transaccion } from '#shared/domain_action'

export interface EntradaIdentificarPorIp {
    /** IP de origen ya resuelta (`ipOrigenDeLaPeticion`), IPv4 o IPv6. */
    ip: string
}

export type EstadoServicio = 'activo' | 'limitado' | 'suspendido' | 'retirado'

/** Espejo del schema `QuienSoy` (`app/portal/esquemas.ts`). */
export interface QuienSoy {
    identificado: boolean
    ip: string
    nombre_parcial: string | null
    estado: EstadoServicio | null
    promesa_activa: boolean | null
    monto_adeudado: string | null
    facturas_vencidas: { cantidad: number; total: string } | null
}

/** Zona en la que vence una factura (`vence_en` es fecha local de Guatemala). */
const ZONA = 'America/Guatemala'

/**
 * Identifica el servicio de la página de corte a partir de la IP de origen.
 *
 * Lectura pura (no cambia estado ni emite eventos); se audita como cualquier acción porque es un
 * endpoint público que revela información de un cliente.
 *
 * Resolución, en orden:
 * 1. `network.sesiones` activas (`fin IS NULL`): `ipv4` igual, o la IPv6 contenida en
 *    `prefijo_enlace_v6` o `prefijo_delegado_v6`. Gana la sesión más reciente.
 * 2. Asignaciones vigentes (`fin IS NULL`): `network.ipv4_asignaciones.ip` igual o
 *    `network.ipv6_asignaciones.prefijo` que contenga la IP (servicio sin sesión viva, IP fija).
 *
 * NEEDS(A1): reemplazar los pasos 1 y 2 por `GET /ip/{ip}` (acción de A1) cuando se publique.
 *
 * Solo devuelve nombre parcial, estado y montos: nunca datos personales completos.
 * `monto_adeudado` = saldo (`total - pagado`) de las facturas del servicio en `emitida`,
 * `parcial` o `vencida`. Vencidas = estado `vencida` o con `vence_en` anterior a hoy en Guatemala.
 */
export default class IdentificarPorIp extends DomainAction<EntradaIdentificarPorIp, QuienSoy> {
    readonly nombre = 'portal.quien_soy'

    protected async handle(input: EntradaIdentificarPorIp, t: Transaccion): Promise<QuienSoy> {
        const servicioId = await resolverServicio(t.trx, input.ip)
        if (!servicioId) return noIdentificado(input.ip)

        const servicio = (await t.trx
            .from('core.servicios as s')
            .join('core.clientes as c', 'c.id', 's.cliente_id')
            .where('s.id', servicioId)
            .select('s.id', 's.estado', 'c.nombre')
            .select(
                t.trx.raw(
                    `EXISTS (SELECT 1 FROM billing.promesas p WHERE p.servicio_id = s.id AND p.estado = 'activa') AS promesa_activa`,
                ),
            )
            .first()) as {
            id: number
            estado: EstadoServicio
            nombre: string
            promesa_activa: boolean
        } | null
        if (!servicio) return noIdentificado(input.ip)

        t.fijarEntidad('servicio', Number(servicio.id))

        const facturas = (await t.trx
            .from('billing.facturas')
            .where('servicio_id', servicio.id)
            .whereIn('estado', ['emitida', 'parcial', 'vencida'])
            .select('total', 'pagado')
            .select(
                t.trx.raw(`(estado = 'vencida' OR vence_en < (now() AT TIME ZONE ?)::date) AS vencida`, [
                    ZONA,
                ]),
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

        return {
            identificado: true,
            ip: input.ip,
            nombre_parcial: nombreParcial(servicio.nombre),
            estado: servicio.estado,
            promesa_activa: Boolean(servicio.promesa_activa),
            monto_adeudado: adeudado.toFixed(2),
            facturas_vencidas: { cantidad: vencidas, total: vencidoTotal.toFixed(2) },
        }
    }
}

async function resolverServicio(trx: TransactionClientContract, ip: string): Promise<number | null> {
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

function noIdentificado(ip: string): QuienSoy {
    return {
        identificado: false,
        ip,
        nombre_parcial: null,
        estado: null,
        promesa_activa: null,
        monto_adeudado: null,
        facturas_vencidas: null,
    }
}

/**
 * Primer nombre y la inicial de la segunda palabra: "María José García" → "María J.".
 * Nunca el nombre completo.
 */
export function nombreParcial(nombre: string): string | null {
    const palabras = nombre.trim().split(/\s+/).filter(Boolean)
    if (palabras.length === 0) return null
    const [primera, segunda] = palabras
    const inicial = segunda ? ` ${segunda.charAt(0).toLocaleUpperCase('es')}.` : ''
    return `${primera}${inicial}`
}
