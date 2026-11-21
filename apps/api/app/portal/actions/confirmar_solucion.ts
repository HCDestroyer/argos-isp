import { DomainAction, type Transaccion } from '#shared/domain_action'
import { llamarIrisJson, type SesionIris } from '#portal/soporte/iris_portal'
import { ticketSoporte, type TicketSoporte } from '#portal/soporte/vistas'

export interface EntradaConfirmarSolucion {
    clienteId: number
    empresaId: number
    sesion: SesionIris
    ticketId: number
    version: number
}

/**
 * `portal.confirmar_solucion` (`POST /portal/soporte/tickets/:ticketId/confirmar-solucion`, contrato
 * Iris 0.9.0 §11.5, A30): el cliente confirma que su ticket `resuelto` quedó bien y Iris lo cierra.
 * Si no está resuelto, 422 `transicion_invalida`; con `version` vieja, 409. La clave de idempotencia
 * la fija el contrato: `argos:portal:confirmar:<ticket_id>:<version>`. Solo con sesión `documento`.
 */
export default class ConfirmarSolucionPortal extends DomainAction<EntradaConfirmarSolucion, TicketSoporte> {
    readonly nombre = 'portal.confirmar_solucion'
    protected readonly camposEntradaOcultos = ['sesion']

    protected async handle(input: EntradaConfirmarSolucion, t: Transaccion): Promise<TicketSoporte> {
        t.fijarEmpresa(input.empresaId)
        t.fijarEntidad('ticket_iris', input.ticketId)
        return ticketSoporte(
            await llamarIrisJson<unknown>({
                metodo: 'POST',
                clienteId: input.clienteId,
                empresaId: input.empresaId,
                sesion: input.sesion,
                ruta: `/tickets/${input.ticketId}/confirmar-solucion`,
                cuerpo: { version: input.version },
                idempotencia: `argos:portal:confirmar:${input.ticketId}:${input.version}`,
            }),
        )
    }
}
