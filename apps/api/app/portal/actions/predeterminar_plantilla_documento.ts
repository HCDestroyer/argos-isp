import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ConflictoVersion, ReglaNegocio } from '#shared/errores'
import { actualizarConVersion } from '#shared/version'
import { filaPlantilla, plantillaPorId, type PlantillaDocumento } from '#portal/documentos/render'

export interface EntradaPredeterminarPlantillaDocumento {
    plantilla_id: number
    version: number
}

/**
 * Marca una plantilla como la predeterminada de su tipo (`POST /plantillas-documentos/:id/predeterminar`):
 * la que usan el portal, el correo y los procesos automáticos. La anterior deja de serlo (su
 * `version` también sube). Solo una activa (422 `plantilla_inactiva`). Idempotente si ya lo era.
 * Diff de `predeterminada` en las dos en `audit.cambios`.
 */
export default class PredeterminarPlantillaDocumento extends DomainAction<
    EntradaPredeterminarPlantillaDocumento,
    PlantillaDocumento
> {
    readonly nombre = 'documentos.predeterminar'

    protected async handle(
        input: EntradaPredeterminarPlantillaDocumento,
        t: Transaccion,
    ): Promise<PlantillaDocumento> {
        await t.trx.rawQuery('LOCK TABLE core.plantillas_documentos IN SHARE ROW EXCLUSIVE MODE')
        const plantilla = await filaPlantilla(input.plantilla_id, t.trx, true)
        if (plantilla.version !== input.version) {
            throw new ConflictoVersion('plantilla_documento', plantilla.id)
        }
        t.fijarEntidad('plantilla_documento', plantilla.id)
        if (plantilla.predeterminada) return plantillaPorId(plantilla.id, t.trx)
        if (!plantilla.activa) {
            throw new ReglaNegocio(
                'Una plantilla desactivada no puede ser la predeterminada: actívala primero',
                'plantilla_inactiva',
            )
        }

        const anterior = (await t.trx
            .from('core.plantillas_documentos')
            .where('tipo', plantilla.tipo)
            .where('predeterminada', true)
            .select('id', 'version')
            .first()) as { id: number; version: number } | null
        if (anterior) {
            await actualizarConVersion(
                t.trx,
                'core.plantillas_documentos',
                Number(anterior.id),
                Number(anterior.version),
                { predeterminada: false },
            )
            await t.registrarCambios(
                { tipo: 'plantilla_documento', id: Number(anterior.id) },
                { predeterminada: true },
                { predeterminada: false },
            )
        }
        await actualizarConVersion(t.trx, 'core.plantillas_documentos', plantilla.id, input.version, {
            predeterminada: true,
        })
        await t.registrarCambios(
            { tipo: 'plantilla_documento', id: plantilla.id },
            { predeterminada: false },
            { predeterminada: true },
        )
        return plantillaPorId(plantilla.id, t.trx)
    }
}
