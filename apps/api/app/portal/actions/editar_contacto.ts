import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ReglaNegocio } from '#shared/errores'
import EditarCliente from '#core/actions/editar_cliente'
import { contactoDelCliente, type ContactoPortal } from '#portal/cuenta'

export interface EntradaEditarContacto {
    clienteId: number
    version: number
    email?: string | null
    telefono?: string | null
    movil?: string | null
    canal_preferido?: 'correo' | 'telegram' | 'whatsapp'
}

/**
 * El cliente edita sus datos de contacto y su canal preferido desde el portal
 * (`PUT /portal/contacto`, canal `portal`).
 *
 * Solo correo, teléfono, móvil y canal preferido: nombre, NIT y dirección los cambia la oficina.
 * Delega en `EditarCliente` de A1 (misma transacción), que valida `version` (409) y escribe el
 * diff en `audit.cambios`; esta acción deja además su propia fila `portal.editar_contacto`.
 *
 * Telegram como canal preferido exige tenerlo vinculado (la vinculación llega en la semana 2).
 */
export default class EditarContactoPortal extends DomainAction<EntradaEditarContacto, ContactoPortal> {
    readonly nombre = 'portal.editar_contacto'

    protected async handle(input: EntradaEditarContacto, t: Transaccion): Promise<ContactoPortal> {
        const { clienteId, version, ...datos } = input
        t.fijarEntidad('cliente', clienteId)

        if (datos.canal_preferido === 'telegram') {
            const cliente = (await t.trx
                .from('core.clientes')
                .where('id', clienteId)
                .select('telegram_chat_id')
                .first()) as { telegram_chat_id: string | null } | null
            if (!cliente?.telegram_chat_id) {
                throw new ReglaNegocio(
                    'Para recibir avisos por Telegram primero vincula tu cuenta con nuestro bot.',
                    'telegram_no_vinculado',
                )
            }
        }

        await new EditarCliente().execute({ id: clienteId, version, ...datos }, t.ctx, { trx: t.trx })
        return contactoDelCliente(clienteId, t.trx)
    }
}
