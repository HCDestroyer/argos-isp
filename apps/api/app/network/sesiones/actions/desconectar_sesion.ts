import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, NoEncontrado } from '#shared/errores'
import { bloquearSesion, solicitarDesconexion } from '#network/sesiones/desconexion'

export interface EntradaDesconectarSesion {
    id: number
    motivo: string
}

export interface SalidaDesconectarSesion {
    sesion_id: number
    servicio_id: number | null
}

/**
 * `POST /sesiones/:id/desconectar`: pide a `coa` un Disconnect-Request para una sesión abierta
 * (evento `sesion.desconexion_solicitada`). 404 si la sesión no existe, 409 si ya terminó.
 * El resultado del NAS queda en `audit.red`; la sesión se cierra cuando llega el Stop del NAS.
 */
export default class DesconectarSesion extends DomainAction<
    EntradaDesconectarSesion,
    SalidaDesconectarSesion
> {
    readonly nombre = 'sesiones.desconectar'

    protected async handle(input: EntradaDesconectarSesion, t: Transaccion) {
        const sesion = await bloquearSesion(t, input.id)
        if (!sesion) throw new NoEncontrado(`La sesión ${input.id} no existe`)
        t.fijarEntidad('sesion', sesion.id)
        if (sesion.fin) {
            throw new Conflicto(`La sesión ${sesion.id} ya terminó`, 'sesion_terminada', 'Sesión terminada')
        }
        await solicitarDesconexion(t, sesion, input.motivo)
        return { sesion_id: sesion.id, servicio_id: sesion.servicio_id }
    }
}
