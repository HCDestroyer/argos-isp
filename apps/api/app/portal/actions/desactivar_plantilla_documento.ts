import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ConflictoVersion, ReglaNegocio } from '#shared/errores'
import { actualizarConVersion } from '#shared/version'
import { filaPlantilla, plantillaPorId, type PlantillaDocumento } from '#portal/documentos/render'

export interface EntradaActivarPlantillaDocumento {
    plantilla_id: number
    version: number
}

/**
 * Desactiva una plantilla (`POST /plantillas-documentos/:id/desactivar`): deja de ofrecerse al
 * imprimir y no se puede pedir con `?plantilla_id=` (422). Nunca la predeterminada (422
 * `plantilla_predeterminada`: primero se elige otra). No se borra: queda su historial. Idempotente.
 */
export default class DesactivarPlantillaDocumento extends DomainAction<
    EntradaActivarPlantillaDocumento,
    PlantillaDocumento
> {
    readonly nombre = 'documentos.desactivar'

    protected async handle(
        input: EntradaActivarPlantillaDocumento,
        t: Transaccion,
    ): Promise<PlantillaDocumento> {
        const plantilla = await filaPlantilla(input.plantilla_id, t.trx, true)
        if (plantilla.version !== input.version) {
            throw new ConflictoVersion('plantilla_documento', plantilla.id)
        }
        t.fijarEntidad('plantilla_documento', plantilla.id)
        if (plantilla.predeterminada) {
            throw new ReglaNegocio(
                'La plantilla predeterminada no se puede desactivar: marca otra como predeterminada primero',
                'plantilla_predeterminada',
            )
        }
        if (plantilla.activa) {
            await actualizarConVersion(t.trx, 'core.plantillas_documentos', plantilla.id, input.version, {
                activa: false,
            })
            await t.registrarCambios(
                { tipo: 'plantilla_documento', id: plantilla.id },
                { activa: true },
                { activa: false },
            )
        }
        return plantillaPorId(plantilla.id, t.trx)
    }
}
