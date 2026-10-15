import { DomainAction, type Transaccion } from '#shared/domain_action'
import { resolverServicio, saldoDelServicio, type EstadoServicio } from '#portal/servicio_por_ip'

export interface EntradaConsultarEstado {
    /** IP de origen ya resuelta (`ipOrigenDeLaPeticion`), IPv4 o IPv6. */
    ip: string
}

/** Espejo del schema `EstadoPortal` (`app/portal/esquemas.ts`). */
export interface EstadoPortal {
    identificado: boolean
    estado: EstadoServicio | null
    monto_adeudado: string | null
}

/**
 * Estado en vivo para la página de corte: la consulta cada 5 s después de pagar o de una promesa
 * hasta ver `activo`. Identifica por IP igual que `portal.quien_soy`, pero solo devuelve estado y
 * monto adeudado: sin nombre ni IP ni ningún otro dato del cliente.
 *
 * Lectura pura (no cambia estado ni emite eventos). Se audita como `portal.estado`.
 */
export default class ConsultarEstadoPorIp extends DomainAction<EntradaConsultarEstado, EstadoPortal> {
    readonly nombre = 'portal.estado'

    protected async handle(input: EntradaConsultarEstado, t: Transaccion): Promise<EstadoPortal> {
        const servicioId = await resolverServicio(t.trx, input.ip)
        const servicio = servicioId
            ? ((await t.trx
                  .from('core.servicios')
                  .where('id', servicioId)
                  .select('id', 'estado')
                  .first()) as {
                  id: number
                  estado: EstadoServicio
              } | null)
            : null
        if (!servicio) return { identificado: false, estado: null, monto_adeudado: null }

        t.fijarEntidad('servicio', Number(servicio.id))
        const { adeudado } = await saldoDelServicio(t.trx, Number(servicio.id))
        return { identificado: true, estado: servicio.estado, monto_adeudado: adeudado.toFixed(2) }
    }
}
