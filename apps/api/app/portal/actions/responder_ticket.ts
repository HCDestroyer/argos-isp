import { DomainAction, type Transaccion } from '#shared/domain_action'
import { llamarIrisJson, type ArchivoIris, type SesionIris } from '#portal/soporte/iris_portal'
import { adjuntosParaAuditoria } from '#portal/soporte/adjuntos'
import {
    mensajeSoporte,
    ticketSoporte,
    type MensajeSoporte,
    type TicketSoporte,
} from '#portal/soporte/vistas'
import { SoporteNoDisponible } from '#portal/soporte/iris_portal'

export interface EntradaResponderTicket {
    clienteId: number
    empresaId: number
    sesion: SesionIris
    ticketId: number
    /** UUID del envío: `argos:portal:respuesta:<clave>` */
    clave: string
    cuerpo: string
    version?: number | null
    archivos: ArchivoIris[]
}

export interface RespuestaTicket {
    ticket: TicketSoporte
    mensaje: MensajeSoporte
}

/**
 * `portal.responder_ticket` (`POST /portal/soporte/tickets/:ticketId/responder`, contrato Iris
 * 0.9.0 §11.5, A30): mensaje del cliente en su ticket. En Iris, un ticket `en_espera` se reanuda y
 * uno `resuelto` se reabre; uno `cerrado` responde 422 `transicion_invalida`. Con `version` vieja,
 * 409 `conflicto_version`. Solo con sesión `documento` (lo exige la ruta). Auditada con actor
 * `cliente`, canal `portal`; los adjuntos, sin contenido.
 */
export default class ResponderTicketPortal extends DomainAction<EntradaResponderTicket, RespuestaTicket> {
    readonly nombre = 'portal.responder_ticket'
    protected readonly camposEntradaOcultos = ['archivos', 'sesion']

    protected async handle(input: EntradaResponderTicket, t: Transaccion): Promise<RespuestaTicket> {
        t.fijarEmpresa(input.empresaId)
        t.fijarEntidad('ticket_iris', input.ticketId)
        t.anotarAuditoria({ adjuntos: adjuntosParaAuditoria(input.archivos) })
        const cuerpo: Record<string, unknown> = { cuerpo: input.cuerpo }
        if (input.version) cuerpo.version = input.version
        const respuesta = await llamarIrisJson<{ ticket?: unknown; mensaje?: unknown }>({
            metodo: 'POST',
            clienteId: input.clienteId,
            empresaId: input.empresaId,
            sesion: input.sesion,
            ruta: `/tickets/${input.ticketId}/responder`,
            cuerpo,
            archivos: input.archivos,
            idempotencia: `argos:portal:respuesta:${input.clave}`,
        })
        if (!respuesta || typeof respuesta !== 'object') throw new SoporteNoDisponible()
        return { ticket: ticketSoporte(respuesta.ticket), mensaje: mensajeSoporte(respuesta.mensaje) }
    }
}
