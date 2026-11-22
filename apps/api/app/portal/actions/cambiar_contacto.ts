import { DomainAction, type Transaccion } from '#shared/domain_action'
import EditarContactoCliente from '#core/actions/editar_contacto_cliente'
import type { ContactoVista, PermisosContacto, RelacionContacto, TelefonoEntrada } from '#core/contactos'
import { contactoDelTitular } from '#portal/contactos'

export interface EntradaCambiarContacto {
    clienteId: number
    contactoId: number
    version: number
    nombre?: string
    relacion?: Exclude<RelacionContacto, 'titular'>
    servicios?: number[] | null
    permisos?: Partial<PermisosContacto>
    telefonos?: TelefonoEntrada[]
}

/**
 * `portal.cambiar_contacto` (`PUT /portal/contactos/:contactoId`, §3.5): el titular cambia nombre,
 * relación, servicios, permisos o números de uno de sus contactos, con `version` (409). Solo los
 * contactos de su cuenta que no son el titular (404 si no; el titular cambia sus datos en «Mis
 * datos»). Delega en `contactos.gestionar` de A1 (diff, revalidación del vínculo A46 al cambiar
 * números y `cliente.contactos_cambiados`).
 */
export default class CambiarContactoPortal extends DomainAction<EntradaCambiarContacto, ContactoVista> {
    readonly nombre = 'portal.cambiar_contacto'

    protected async handle(input: EntradaCambiarContacto, t: Transaccion): Promise<ContactoVista> {
        const { clienteId, contactoId, ...datos } = input
        t.fijarEntidad('contacto_cliente', contactoId)
        const actual = await contactoDelTitular(clienteId, contactoId, t.trx)
        t.fijarEmpresa(actual.empresa_id)
        return new EditarContactoCliente().execute({ ...datos, id: contactoId }, t.ctx, { trx: t.trx })
    }
}
