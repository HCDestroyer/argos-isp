import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import { bloquearSesionesAbiertas, solicitarDesconexion } from '#network/sesiones/desconexion'

export interface EntradaDesconectarServicio {
    id: number
    motivo: string
}

export interface SalidaDesconectarServicio {
    servicio_id: number
    sesiones: number[]
}

/**
 * `POST /servicios/:id/desconectar`: desconecta la sesión activa del servicio (todas, si el NAS
 * dejó más de una abierta). Un `sesion.desconexion_solicitada` por sesión; lo ejecuta `coa`.
 * 404 si el servicio no existe o no tiene sesión activa. No cambia el estado del servicio.
 */
export default class DesconectarServicio extends DomainAction<
    EntradaDesconectarServicio,
    SalidaDesconectarServicio
> {
    readonly nombre = 'servicios.desconectar'

    protected async handle(input: EntradaDesconectarServicio, t: Transaccion) {
        const existe = await t.trx.from('core.servicios').where('id', input.id).select('id').first()
        if (!existe) throw new NoEncontrado(`El servicio ${input.id} no existe`)
        t.fijarEntidad('servicio', input.id)
        const sesiones = await bloquearSesionesAbiertas(t, input.id)
        if (sesiones.length === 0) {
            throw new NoEncontrado(`El servicio ${input.id} no tiene una sesión activa`)
        }
        for (const sesion of sesiones) await solicitarDesconexion(t, sesion, input.motivo)
        return { servicio_id: input.id, sesiones: sesiones.map((s) => s.id) }
    }
}
