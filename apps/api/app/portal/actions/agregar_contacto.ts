import { DomainAction, type Transaccion } from '#shared/domain_action'
import CrearContactoCliente from '#core/actions/crear_contacto_cliente'
import type { ContactoVista, PermisosContacto, RelacionContacto, TelefonoEntrada } from '#core/contactos'

export interface EntradaAgregarContacto {
    /** cliente de la sesión (el titular) */
    clienteId: number
    nombre: string
    relacion: Exclude<RelacionContacto, 'titular'>
    servicios?: number[] | null
    permisos?: Partial<PermisosContacto>
    telefonos: TelefonoEntrada[]
}

/**
 * `portal.agregar_contacto` (`POST /portal/contactos`, contrato Iris 0.10.0 §3.5, A42; decisión del
 * PM «También el titular desde el portal»): el titular agrega a alguien que puede consultar,
 * reportar, pagar o recibir avisos de sus servicios. Delega en `contactos.gestionar` de A1 en la
 * misma transacción (diff en `audit.cambios`, `origen: portal`, aviso al titular y
 * `cliente.contactos_cambiados`); esta acción deja su propia fila con actor `cliente`, canal
 * `portal`. Nunca crea un titular ni vincula otra cuenta (`persona_cliente_id` lo pone el personal).
 */
export default class AgregarContactoPortal extends DomainAction<EntradaAgregarContacto, ContactoVista> {
    readonly nombre = 'portal.agregar_contacto'

    protected async handle(input: EntradaAgregarContacto, t: Transaccion): Promise<ContactoVista> {
        const { clienteId, ...datos } = input
        t.fijarEntidad('cliente', clienteId)
        const contacto = await new CrearContactoCliente().execute(
            { ...datos, cliente_id: clienteId },
            t.ctx,
            { trx: t.trx },
        )
        t.fijarEntidad('contacto_cliente', contacto.contacto_id)
        t.fijarEmpresa(contacto.empresa_id)
        return contacto
    }
}
