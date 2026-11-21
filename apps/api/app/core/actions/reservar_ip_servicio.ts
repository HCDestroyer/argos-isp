import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import { asignacionesVigentes } from '#core/asignaciones_servicio'
import { refrescarAaaAlConfirmar } from '#core/aaa'
import { verServicio } from '#core/consultas/servicios'
import EditarServicio from '#core/actions/editar_servicio'
import { registrarTramo } from '#network/historial'
import {
    DIAS_RESERVA_IP,
    PlanNoPermitido,
    ServicioNoPendiente,
    asignarIpPendiente,
    bloquearServicio,
    exigirServicioDeIris,
    planDisponibleEnRouter,
    tieneAsignaciones,
} from '#core/instalacion_iris'

export interface EntradaReservarIp {
    id: number
    /** router final; si es otro, el pendiente pasa a él antes de reservar */
    router_id?: number
    origen_tipo: string
    origen_id: string
    /** la pidió el token de Iris (alcance de §3.4) */
    desdeIris?: boolean
}

export interface ReservaIp {
    ipv4: string | null
    /** prefijo delegado (o null) */
    prefijo_v6: string | null
    prefijo_enlace_v6: string | null
    /** la reserva se libera sola si el servicio no se activa antes (30 días) */
    vence_en: string | null
}

/**
 * `servicios.reservar_ip` (`POST /servicios/:id/reservar-ip`, contrato Iris 0.10.0 §3.4.1, A38):
 * reserva en sitio la IPv4 y los prefijos de un servicio `pendiente_instalacion` (IP fija o amarre
 * IP-MAC que el técnico configura en el equipo antes de activar). Solo en pendiente (422
 * `servicio_no_pendiente`). Con `router_id` distinto, el servicio pasa antes a ese router (el plan
 * debe estar asignado a él: 422 `plan_no_permitido`). Una segunda llamada devuelve la misma
 * reserva. Sin IP libre: 422 `sin_ip_disponible`. La activación usa la reserva; vence a los 30 días
 * sin activar (`VencerReservaIp`) y se libera al retirar. Emite `asignacion.cambiada`.
 */
export default class ReservarIpServicio extends DomainAction<EntradaReservarIp, ReservaIp> {
    readonly nombre = 'servicios.reservar_ip'

    protected async handle(input: EntradaReservarIp, t: Transaccion): Promise<ReservaIp> {
        t.fijarEntidad('servicio', input.id)
        let servicio = await bloquearServicio(t.trx, input.id)
        if (!servicio) throw new NoEncontrado(`El servicio ${input.id} no existe`)
        t.fijarEmpresa(servicio.empresa_id)
        if (servicio.estado !== 'pendiente_instalacion') throw new ServicioNoPendiente(servicio.estado)
        if (input.desdeIris) {
            await exigirServicioDeIris(t, input.id, {
                origen_tipo: input.origen_tipo,
                origen_id: input.origen_id,
            })
        }

        if (input.router_id !== undefined && input.router_id !== servicio.router_id) {
            if (!(await planDisponibleEnRouter(t.trx, servicio.plan_id, input.router_id))) {
                throw new PlanNoPermitido('El plan del servicio no está asignado al router pedido')
            }
            await new EditarServicio().execute(
                { id: input.id, version: servicio.version, router_id: input.router_id },
                t.ctx,
                { trx: t.trx },
            )
            servicio = (await bloquearServicio(t.trx, input.id))!
        }

        if (await tieneAsignaciones(t.trx, input.id)) return reserva(t, input.id)

        const asignaciones = await asignarIpPendiente(t.trx, servicio)
        await t.trx
            .from('core.servicios')
            .where('id', input.id)
            .update({ ip_reservada_en: t.trx.knexRawQuery('now()'), updated_at: t.trx.knexRawQuery('now()') })
        await registrarTramo(t.trx, input.id, 'reserva_ip')
        await t.registrarCambios(
            { tipo: 'servicio', id: input.id },
            { ipv4: null, prefijo_enlace_v6: null, prefijo_delegado_v6: null },
            asignaciones,
        )
        await t.emit('asignacion.cambiada', {
            servicio_id: input.id,
            empresa_id: servicio.empresa_id,
            ipv4: asignaciones.ipv4 ? [asignaciones.ipv4] : [],
            prefijo_enlace_v6: asignaciones.prefijo_enlace_v6,
            prefijo_delegado_v6: asignaciones.prefijo_delegado_v6,
            inicio: new Date().toISOString(),
            fin: null,
        })
        refrescarAaaAlConfirmar(t, { servicioId: input.id })
        return reserva(t, input.id)
    }
}

async function reserva(t: Transaccion, servicioId: number): Promise<ReservaIp> {
    const vigentes = await asignacionesVigentes(t.trx, servicioId)
    const fila = (await t.trx
        .from('core.servicios')
        .where('id', servicioId)
        .select(t.trx.raw(`ip_reservada_en + interval '${DIAS_RESERVA_IP} days' AS vence_en`))
        .first()) as { vence_en: Date | null }
    // la vista confirma que el servicio sigue existiendo y legible
    await verServicio(servicioId, t.trx)
    return {
        ipv4: vigentes.ipv4,
        prefijo_v6: vigentes.prefijo_delegado_v6,
        prefijo_enlace_v6: vigentes.prefijo_enlace_v6,
        vence_en: fila.vence_en ? new Date(fila.vence_en).toISOString() : null,
    }
}
