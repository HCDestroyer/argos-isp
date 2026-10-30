import { DomainAction, type Transaccion } from '#shared/domain_action'
import { actualizarConVersion } from '#shared/version'
import { columnasCliente, type DatosCliente, type DocumentoAnterior } from '#core/actions/crear_cliente'
import { verCliente, type ClienteVista } from '#core/consultas/clientes'
import { CAMPOS_CLIENTE_ACTUALIZADO } from '#shared/eventos'

export interface EntradaEditarCliente extends DatosCliente {
    id: number
    version: number
}

/**
 * Edita datos generales y fiscales de un cliente. Control optimista por `version` (409).
 * `campos_personalizados` se reemplaza completo. El documento fiscal se valida solo si llega
 * `tipo_documento_fiscal`, `nit_cui` o `pais_fiscal` (`columnasCliente`).
 *
 * Si el número cambia sin tipo explícito, el tipo de documento se reclasifica con la regla del
 * alta (`columnasCliente`); el diff de `tipo_documento_fiscal` y `nit_cui_invalido` queda en
 * `audit.cambios`.
 *
 * Si cambia el nombre, el tipo, el código, el NIT/CUI, el tipo de documento, el teléfono, el
 * móvil, la dirección, las coordenadas o la zona emite `cliente.actualizado` (`cliente_id`,
 * `campos[]`, solo los nombres) para los sistemas que muestran al cliente (Horus refresca sus
 * identidades; Iris, su instantánea) o lo usan como receptor (FEL).
 */
export default class EditarCliente extends DomainAction<EntradaEditarCliente, ClienteVista> {
    readonly nombre = 'clientes.editar'

    protected async handle(input: EntradaEditarCliente, t: Transaccion): Promise<ClienteVista> {
        const { id, version, ...datos } = input
        t.fijarEntidad('cliente', id)
        const antes = await verCliente(id, t.trx)
        const columnas = await columnasCliente(t, datos, antes as unknown as DocumentoAnterior)
        await actualizarConVersion(t.trx, 'core.clientes', id, version, columnas)
        const despues = await verCliente(id, t.trx)
        await t.registrarCambios({ tipo: 'cliente', id }, antes, despues)
        const campos = CAMPOS_CLIENTE_ACTUALIZADO.filter((campo) => antes[campo] !== despues[campo])
        if (campos.length > 0) await t.emit('cliente.actualizado', { cliente_id: id, campos })
        return despues
    }
}
