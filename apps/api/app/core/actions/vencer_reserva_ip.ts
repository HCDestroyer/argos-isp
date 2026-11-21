import db from '@adonisjs/lucid/services/db'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { asignacionesVigentes, liberarAsignaciones } from '#core/asignaciones_servicio'
import { refrescarAaaAlConfirmar } from '#core/aaa'
import { registrarTramo } from '#network/historial'
import { DIAS_RESERVA_IP, bloquearServicio } from '#core/instalacion_iris'

export interface EntradaVencerReservaIp {
    id: number
    ahora?: Date
}

/**
 * `servicios.vencer_reserva_ip` (cron `reservas_ip_vencidas`, contrato Iris 0.10.0 §3.4.1, B5): libera
 * la IP reservada en sitio de un servicio que sigue `pendiente_instalacion` 30 días después de
 * reservarla. Vuelve a leer la fila bloqueada: si ya se activó, se retiró o la reserva es más nueva,
 * no hace nada (y no deja fila de auditoría). Emite `asignacion.cambiada` con las IPs vacías.
 */
export default class VencerReservaIp extends DomainAction<EntradaVencerReservaIp, { liberada: boolean }> {
    readonly nombre = 'servicios.vencer_reserva_ip'

    protected auditarExito(salida: { liberada: boolean }): boolean {
        return salida.liberada
    }

    protected async handle(input: EntradaVencerReservaIp, t: Transaccion): Promise<{ liberada: boolean }> {
        t.fijarEntidad('servicio', input.id)
        const servicio = await bloquearServicio(t.trx, input.id)
        if (!servicio || servicio.estado !== 'pendiente_instalacion') return { liberada: false }
        t.fijarEmpresa(servicio.empresa_id)
        const limite = new Date((input.ahora ?? new Date()).getTime() - DIAS_RESERVA_IP * 86_400_000)
        const fila = (await t.trx
            .from('core.servicios')
            .where('id', input.id)
            .where('ip_reservada_en', '<=', limite)
            .select('ip_reservada_en')
            .first()) as { ip_reservada_en: Date } | null
        if (!fila) return { liberada: false }
        const antes = await asignacionesVigentes(t.trx, input.id)
        await liberarAsignaciones(t.trx, input.id)
        await t.trx
            .from('core.servicios')
            .where('id', input.id)
            .update({ ip_reservada_en: null, ip_al_activar: true, updated_at: t.trx.knexRawQuery('now()') })
        await registrarTramo(t.trx, input.id, 'reserva_ip_vencida')
        await t.registrarCambios({ tipo: 'servicio', id: input.id }, antes, {
            ipv4: null,
            prefijo_enlace_v6: null,
            prefijo_delegado_v6: null,
        })
        await t.emit('asignacion.cambiada', {
            servicio_id: input.id,
            empresa_id: servicio.empresa_id,
            ipv4: [],
            prefijo_enlace_v6: null,
            prefijo_delegado_v6: null,
            inicio: new Date().toISOString(),
            fin: null,
        })
        refrescarAaaAlConfirmar(t, { servicioId: input.id })
        return { liberada: true }
    }
}

/** Servicios pendientes con una reserva de IP de más de 30 días (todo lo vencido hasta `ahora`). */
export async function reservasIpVencidas(ahora: Date): Promise<number[]> {
    const cliente = db.connection()
    const limite = new Date(ahora.getTime() - DIAS_RESERVA_IP * 86_400_000)
    const filas = (await cliente
        .from('core.servicios')
        .where('estado', 'pendiente_instalacion')
        .where('ip_reservada_en', '<=', limite)
        .orderBy('id')
        .select('id')) as Array<{ id: number }>
    return filas.map((f) => Number(f.id))
}
