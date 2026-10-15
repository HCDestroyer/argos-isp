import { DomainAction, type Transaccion } from '#shared/domain_action'
import { resolverServicio, saldoDelServicio, type EstadoServicio } from '#portal/servicio_por_ip'

export interface EntradaIdentificarPorIp {
    /** IP de origen ya resuelta (`ipOrigenDeLaPeticion`), IPv4 o IPv6. */
    ip: string
}

export type { EstadoServicio }

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

/**
 * Identifica el servicio de la página de corte a partir de la IP de origen.
 *
 * Lectura pura (no cambia estado ni emite eventos); se audita como cualquier acción porque es un
 * endpoint público que revela información de un cliente.
 *
 * La IP se resuelve con `resolverServicio` (`app/portal/servicio_por_ip.ts`): sesiones activas y,
 * si no hay, asignaciones vigentes. NEEDS(A1): `GET /ip/{ip}` cuando se publique.
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

        const { adeudado, vencidas, vencidoTotal } = await saldoDelServicio(t.trx, Number(servicio.id))

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
