import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ReglaNegocio } from '#shared/errores'
import type { EstadoServicio } from '#shared/eventos'
import { verServicio, type ServicioVista } from '#core/consultas/servicios'
import { liberarAsignaciones } from '#core/asignaciones_servicio'

export interface EntradaRetirarServicio {
    id: number
    motivo: string
}

/**
 * Retira un servicio (baja definitiva): estado `retirado` desde cualquier estado, libera su IPv4
 * y sus prefijos IPv6 (quedan en el historial) y emite `servicio.estado_cambiado` y
 * `asignacion.cambiada`. El `user_ppp` se conserva para la bitácora. La máquina de estados
 * completa (`cambiarEstadoServicio`) llega con la tarea 8.
 */
export default class RetirarServicio extends DomainAction<EntradaRetirarServicio, ServicioVista> {
    readonly nombre = 'servicios.retirar'

    protected async handle(input: EntradaRetirarServicio, t: Transaccion): Promise<ServicioVista> {
        t.fijarEntidad('servicio', input.id)
        const fila = (await t.trx
            .from('core.servicios')
            .where('id', input.id)
            .forUpdate()
            .select('estado')
            .first()) as { estado: EstadoServicio } | null
        if (!fila) throw new NoEncontrado(`El servicio ${input.id} no existe`)
        if (fila.estado === 'retirado') {
            throw new ReglaNegocio('El servicio ya está retirado', 'servicio_retirado')
        }

        const antes = await verServicio(input.id, t.trx)
        await t.trx
            .from('core.servicios')
            .where('id', input.id)
            .update({
                estado: 'retirado',
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await liberarAsignaciones(t.trx, input.id)

        const despues = await verServicio(input.id, t.trx)
        await t.registrarCambios({ tipo: 'servicio', id: input.id }, antes, despues)
        const ahora = new Date().toISOString()
        await t.emit('servicio.estado_cambiado', {
            servicio_id: input.id,
            de: fila.estado,
            a: 'retirado',
            motivo: input.motivo,
        })
        await t.emit('asignacion.cambiada', {
            servicio_id: input.id,
            ipv4: [],
            prefijo_enlace_v6: null,
            prefijo_delegado_v6: null,
            inicio: ahora,
            fin: ahora,
        })
        return despues
    }
}
