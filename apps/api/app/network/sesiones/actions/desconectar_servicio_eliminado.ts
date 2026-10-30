import { DomainAction, type Transaccion } from '#shared/domain_action'
import { sesionesAbiertasDeEliminado, solicitarDesconexion } from '#network/sesiones/desconexion'

export interface EntradaDesconectarEliminado {
    servicio_id: number
    user_ppp: string
    /** id del `servicio.eliminado` en `audit.outbox` (trazabilidad) */
    evento_id: string | null
}

export interface SalidaDesconectarEliminado {
    servicio_id: number
    sesiones: number[]
}

/** Motivo de `sesion.desconexion_solicitada` cuando el servicio se eliminó. */
export const MOTIVO_ELIMINADO = 'servicio_eliminado'

/**
 * `servicio.eliminado` (`contratos/eliminar.md`) con una sesión todavía viva: pide el Disconnect por
 * el flujo normal (`sesion.desconexion_solicitada` por outbox; lo ejecuta `coa` y lo registra en
 * `audit.red`). No debería pasar: sin historial implica que nunca conectó. Solo queda una sesión que
 * el accounting abrió después del borrado (sin `servicio_id`, con su `user_ppp`).
 *
 * La llama el consumidor `sesiones` solo cuando hay sesiones abiertas, así que cada ejecución deja
 * su fila en `audit.acciones`. Repetida (el evento llega dos veces) vuelve a pedir el Disconnect
 * solo si la sesión sigue abierta; si el NAS ya la cortó, no hace nada.
 */
export default class DesconectarServicioEliminado extends DomainAction<
    EntradaDesconectarEliminado,
    SalidaDesconectarEliminado
> {
    readonly nombre = 'sesiones.desconectar_eliminado'

    protected async handle(input: EntradaDesconectarEliminado, t: Transaccion) {
        t.fijarEntidad('servicio', input.servicio_id)
        const sesiones = await sesionesAbiertasDeEliminado(input.user_ppp, t)
        for (const sesion of sesiones) {
            await solicitarDesconexion(t, { ...sesion, servicio_id: input.servicio_id }, MOTIVO_ELIMINADO)
        }
        return { servicio_id: input.servicio_id, sesiones: sesiones.map((s) => s.id) }
    }
}
