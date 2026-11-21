import { DomainAction, type Transaccion } from '#shared/domain_action'
import { actualizarConVersion, verificarVersion } from '#shared/version'
import { columnasCliente, type DatosCliente, type DocumentoAnterior } from '#core/actions/crear_cliente'
import { verCliente, type ClienteVista } from '#core/consultas/clientes'
import { CAMPOS_CLIENTE_ACTUALIZADO } from '#shared/eventos'
import { numerosPersona, revalidarVinculos } from '#core/contactos'

export interface EntradaEditarCliente extends DatosCliente {
    id: number
    version: number
}

/**
 * Edita datos generales y fiscales de un cliente. Control optimista por `version` (409).
 * `campos_personalizados` se reemplaza completo. `telefono` y `movil` se validan y normalizan solo
 * si cambian (`#core/telefonos`, pedido A14). El documento fiscal se valida solo si llega
 * `tipo_documento_fiscal`, `nit_cui` o `pais_fiscal` (`columnasCliente`).
 *
 * Si el número cambia sin tipo explícito, el tipo de documento se reclasifica con la regla del
 * alta (`columnasCliente`); el diff de `tipo_documento_fiscal` y `nit_cui_invalido` queda en
 * `audit.cambios`.
 *
 * Si cambia el nombre, el tipo, el código, el NIT/CUI, el tipo de documento, el teléfono, el
 * móvil, la dirección, las coordenadas, la zona, el correo o la referencia (`CAMPOS_CLIENTE_ACTUALIZADO`)
 * emite `cliente.actualizado` (`cliente_id`,
 * `campos[]`, solo los nombres) para los sistemas que muestran al cliente (Horus refresca sus
 * identidades; Iris, su instantánea) o lo usan como receptor (FEL).
 */
export default class EditarCliente extends DomainAction<EntradaEditarCliente, ClienteVista> {
    readonly nombre = 'clientes.editar'

    protected async handle(input: EntradaEditarCliente, t: Transaccion): Promise<ClienteVista> {
        const { id, version, ...datos } = input
        t.fijarEntidad('cliente', id)
        const antes = await verCliente(id, t.trx)
        // 409 antes de validar: los teléfonos se validan contra lo guardado en esa versión
        verificarVersion('core.clientes', id, antes.version, version)
        const columnas = await columnasCliente(t, datos, antes as unknown as DocumentoAnterior)
        const numerosAntes = await numerosPersona(id, t.trx)
        // Iris 0.10.0 §3.4.6 y §3.8: un número que cambia deja de estar verificado; si lo escribe el
        // personal de Argos ya cuenta como registrado
        const cambiaNumero: Array<'telefono' | 'movil'> = []
        for (const campo of ['telefono', 'movil'] as const) {
            if (columnas[campo] !== undefined && columnas[campo] !== antes[campo]) {
                columnas[`${campo}_verificado_en`] = null
                cambiaNumero.push(campo)
            }
        }
        if (cambiaNumero.length > 0) {
            columnas.campos_sin_confirmar = t.trx.knexRawQuery(
                'array(SELECT x FROM unnest(campos_sin_confirmar) x WHERE x <> ALL(CAST(? AS text[])))',
                [`{${cambiaNumero.join(',')}}`],
            )
        }
        await actualizarConVersion(t.trx, 'core.clientes', id, version, columnas)
        const despues = await verCliente(id, t.trx)
        await t.registrarCambios({ tipo: 'cliente', id }, antes, despues)
        const campos = CAMPOS_CLIENTE_ACTUALIZADO.filter((campo) => antes[campo] !== despues[campo])
        if (campos.length > 0) await t.emit('cliente.actualizado', { cliente_id: id, campos })
        // §3.8 (ajuste am): los vínculos de contactos de otros clientes que eran esta persona por su número
        if (cambiaNumero.length > 0 && numerosAntes) {
            await revalidarVinculos(t, { personaId: id, antes: numerosAntes })
        }
        return despues
    }
}
