import { DomainAction, type Transaccion } from '#shared/domain_action'
import { actualizarConVersion } from '#shared/version'
import { columnasCliente, type DatosCliente } from '#core/actions/crear_cliente'
import { verCliente, type ClienteVista } from '#core/consultas/clientes'
import { CAMPOS_CLIENTE_ACTUALIZADO } from '#shared/eventos'

export interface EntradaEditarCliente extends DatosCliente {
    id: number
    version: number
}

/**
 * Edita datos generales y fiscales de un cliente. Control optimista por `version` (409).
 * `campos_personalizados` se reemplaza completo.
 *
 * Si cambia el nombre, el tipo o el código emite `cliente.actualizado` (`cliente_id`, `campos[]`)
 * para los sistemas que muestran al cliente (Horus refresca sus identidades).
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
        const campos = CAMPOS_CLIENTE_ACTUALIZADO.filter((campo) => antes[campo] !== despues[campo])
        if (campos.length > 0) await t.emit('cliente.actualizado', { cliente_id: id, campos })
        return despues
    }
}
