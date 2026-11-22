import { DomainAction, type Transaccion } from '#shared/domain_action'
import QuitarContactoCliente from '#core/actions/quitar_contacto_cliente'
import type { ContactoVista } from '#core/contactos'
import { contactoDelTitular } from '#portal/contactos'

export interface EntradaQuitarContacto {
    clienteId: number
    contactoId: number
    version: number
}

/**
 * `portal.quitar_contacto` (`POST /portal/contactos/:contactoId/quitar`, §3.5): el titular quita un
 * contacto de su cuenta, con `version`. Si era una persona a cargo (A46), el vínculo se rompe al
 * momento. Solo contactos de su cuenta que no son el titular (404). Delega en `contactos.gestionar`.
 */
export default class QuitarContactoPortal extends DomainAction<EntradaQuitarContacto, ContactoVista> {
    readonly nombre = 'portal.quitar_contacto'

    protected async handle(input: EntradaQuitarContacto, t: Transaccion): Promise<ContactoVista> {
        t.fijarEntidad('contacto_cliente', input.contactoId)
        const actual = await contactoDelTitular(input.clienteId, input.contactoId, t.trx)
        t.fijarEmpresa(actual.empresa_id)
        return new QuitarContactoCliente().execute({ id: input.contactoId, version: input.version }, t.ctx, {
            trx: t.trx,
        })
    }
}
