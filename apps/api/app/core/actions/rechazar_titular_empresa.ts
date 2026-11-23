import { DomainAction, type Transaccion } from '#shared/domain_action'
import type { RevisionTitularEmpresaResumen } from '#core/consultas/titulares_empresa_revision'
import { bloquearRevision, cerrarRevision, exigirRevisor } from '#core/titulares_empresa'

export interface EntradaRechazarTitularEmpresa {
    id: number
    motivo: string
    version: number
}

/**
 * `servicios.rechazar_titular_empresa` (`POST /titulares-empresa/revisiones/:id/rechazar`): no cambia
 * nada del servicio ni del cliente; la revisión queda `rechazada` y se borran el documento y las
 * fotos del representante. Sin evento: Iris ya tiene la orden en revisión de su supervisor.
 */
export default class RechazarTitularEmpresa extends DomainAction<
    EntradaRechazarTitularEmpresa,
    RevisionTitularEmpresaResumen
> {
    readonly nombre = 'servicios.rechazar_titular_empresa'

    protected async handle(
        input: EntradaRechazarTitularEmpresa,
        t: Transaccion,
    ): Promise<RevisionTitularEmpresaResumen> {
        const revisor = await exigirRevisor(t)
        const fila = await bloquearRevision(t, input.id, input.version)
        return cerrarRevision(t, fila, { estado: 'rechazada', decidida_por: revisor, motivo: input.motivo })
    }
}
