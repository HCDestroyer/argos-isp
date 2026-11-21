import { DomainAction, type Transaccion } from '#shared/domain_action'
import {
    llamarIrisJson,
    type ArchivoIris,
    type ContactoIris,
    type SesionIris,
} from '#portal/soporte/iris_portal'
import { adjuntosParaAuditoria } from '#portal/soporte/adjuntos'
import { ticketSoporte, type TicketSoporte } from '#portal/soporte/vistas'

export interface EntradaAbrirTicket {
    /** cliente de la ruta de Iris: el de la sesión, o el dueño del servicio que tiene a cargo (A46) */
    clienteId: number
    /** `titular`, o el contacto con que actúa la persona de la sesión sobre el servicio de otro (A46) */
    contacto: ContactoIris
    empresaId: number
    sesion: SesionIris
    /** UUID del envío del formulario (`Idempotency-Key` del portal): `argos:portal:ticket:<clave>` */
    clave: string
    asunto: string
    descripcion: string
    categoria_id?: number | null
    servicio_id?: number | null
    archivos: ArchivoIris[]
}

/**
 * `portal.abrir_ticket` (`POST /portal/soporte/tickets`, contrato Iris 0.9.0 §11.4, A30): el cliente
 * abre un ticket de soporte en Iris desde el portal. Argos no guarda el ticket (es de Iris): solo lo
 * pide con el `token_portal`, la empresa y la sesión, y deja la fila de auditoría con actor
 * `cliente` y canal `portal` (los adjuntos, solo nombre, tipo y tamaño). Iris emite `ticket.creado`.
 *
 * La misma `clave` repite la misma respuesta en Iris (`argos:portal:ticket:<uuid>`). Desde una
 * sesión `ip` va sin adjuntos (la ruta ya los rechaza). Con un contacto (A46, Iris ≥ 0.12.1) la ruta ya validó que
 * el contacto apunta a la persona de la sesión y tiene `reportar`.
 */
export default class AbrirTicketPortal extends DomainAction<EntradaAbrirTicket, TicketSoporte> {
    readonly nombre = 'portal.abrir_ticket'
    protected readonly camposEntradaOcultos = ['archivos', 'sesion']

    protected async handle(input: EntradaAbrirTicket, t: Transaccion): Promise<TicketSoporte> {
        t.fijarEmpresa(input.empresaId)
        t.anotarAuditoria({
            cliente_id: input.clienteId,
            contacto_id: input.contacto === 'titular' ? null : input.contacto.id,
            metodo: input.sesion.metodo,
            adjuntos: adjuntosParaAuditoria(input.archivos),
        })
        const cuerpo: Record<string, unknown> = { asunto: input.asunto, descripcion: input.descripcion }
        if (input.categoria_id) cuerpo.categoria_id = input.categoria_id
        if (input.servicio_id) cuerpo.servicio_id = input.servicio_id
        const ticket = ticketSoporte(
            await llamarIrisJson<unknown>({
                metodo: 'POST',
                clienteId: input.clienteId,
                empresaId: input.empresaId,
                sesion: input.sesion,
                ruta: '/tickets',
                cuerpo,
                archivos: input.archivos,
                idempotencia: `argos:portal:ticket:${input.clave}`,
                contacto: input.contacto,
            }),
        )
        t.fijarEntidad('ticket_iris', ticket.id)
        t.anotarAuditoria({ numero: ticket.numero })
        return ticket
    }
}
