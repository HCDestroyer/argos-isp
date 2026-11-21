import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ConflictoVersion } from '#shared/errores'
import { actualizarConVersion } from '#shared/version'
import { filaPlantilla, plantillaPorId, type PlantillaDocumento } from '#portal/documentos/render'
import type { EntradaActivarPlantillaDocumento } from '#portal/actions/desactivar_plantilla_documento'

/**
 * Vuelve a activar una plantilla desactivada (`POST /plantillas-documentos/:id/activar`): se ofrece
 * otra vez al imprimir. Idempotente. Diff de `activa` en `audit.cambios`.
 */
export default class ActivarPlantillaDocumento extends DomainAction<
    EntradaActivarPlantillaDocumento,
    PlantillaDocumento
> {
    readonly nombre = 'documentos.activar'

    protected async handle(
        input: EntradaActivarPlantillaDocumento,
        t: Transaccion,
    ): Promise<PlantillaDocumento> {
        const plantilla = await filaPlantilla(input.plantilla_id, t.trx, true)
        if (plantilla.version !== input.version) {
            throw new ConflictoVersion('plantilla_documento', plantilla.id)
        }
        t.fijarEntidad('plantilla_documento', plantilla.id)
        if (!plantilla.activa) {
            await actualizarConVersion(t.trx, 'core.plantillas_documentos', plantilla.id, input.version, {
                activa: true,
            })
            await t.registrarCambios(
                { tipo: 'plantilla_documento', id: plantilla.id },
                { activa: false },
                { activa: true },
            )
        }
        return plantillaPorId(plantilla.id, t.trx)
    }
}
