import { DomainAction, type Transaccion } from '#shared/domain_action'
import { actualizarConVersion } from '#shared/version'
import { columnasCliente, type DatosCliente } from '#core/actions/crear_cliente'
import { verCliente, type ClienteVista } from '#core/consultas/clientes'

export interface EntradaEditarCliente extends DatosCliente {
    id: number
    version: number
}

/**
 * Edita datos generales y fiscales de un cliente. Control optimista por `version` (409).
 * `campos_personalizados` se reemplaza completo.
 */
export default class EditarCliente extends DomainAction<EntradaEditarCliente, ClienteVista> {
    readonly nombre = 'clientes.editar'

    protected async handle(input: EntradaEditarCliente, t: Transaccion): Promise<ClienteVista> {
        const { id, version, ...datos } = input
        t.fijarEntidad('cliente', id)
        const antes = await verCliente(id, t.trx)
        await actualizarConVersion(t.trx, 'core.clientes', id, version, await columnasCliente(t, datos))
        const despues = await verCliente(id, t.trx)
        await t.registrarCambios({ tipo: 'cliente', id }, antes, despues)
        return despues
    }
}
