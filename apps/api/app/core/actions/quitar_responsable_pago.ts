import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import { verCliente, type ClienteVista } from '#core/consultas/clientes'
import { bloquearRelacion, fijarResponsable } from '#core/actions/asignar_responsable_pago'

export interface EntradaQuitarResponsablePago {
    id: number
    /** queda en `audit.acciones.entrada` */
    motivo?: string
}

/**
 * `clientes.quitar_responsable_pago`: deja al cliente sin responsable de pago (diff en
 * `audit.cambios`). Si no tenía, no cambia nada. No toca facturas ni pagos.
 */
export default class QuitarResponsablePago extends DomainAction<EntradaQuitarResponsablePago, ClienteVista> {
    readonly nombre = 'clientes.quitar_responsable_pago'

    protected async handle(input: EntradaQuitarResponsablePago, t: Transaccion): Promise<ClienteVista> {
        const id = Number(input.id)
        t.fijarEntidad('cliente', id)
        const filas = await bloquearRelacion(t, [id])
        const cliente = filas.get(id)
        if (!cliente) throw new NoEncontrado(`El cliente ${id} no existe`)
        if (cliente.responsable_pago_id === null) return verCliente(id, t.trx)
        return fijarResponsable(t, id, Number(cliente.responsable_pago_id), null)
    }
}
