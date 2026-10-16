import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ConflictoVersion } from '#shared/errores'
import { actualizarConVersion } from '#shared/version'
import {
    pdfDesdePlantilla,
    plantillaVigente,
    type PlantillaDocumento,
    type TipoDocumento,
} from '#portal/documentos/render'
import { vistaDeEjemplo } from '#portal/documentos/variables'

export interface EntradaEditarPlantillaDocumento {
    tipo: TipoDocumento
    html: string
    /** versión leída; 0 si se editó la de fábrica */
    version: number
}

/**
 * Guarda la plantilla HTML de un documento (`PUT /documentos/plantillas/:tipo`, editor de A4).
 *
 * - Valida que sea Mustache sin `{{{ }}}` y que genere un PDF con los datos de ejemplo (422).
 * - Versión 0 = la de fábrica: crea la fila con `version = 1`. Si no, control optimista (409).
 * - Diff del campo `html` en `audit.cambios` (entidad `plantilla_documento`).
 */
export default class EditarPlantillaDocumento extends DomainAction<
    EntradaEditarPlantillaDocumento,
    PlantillaDocumento
> {
    readonly nombre = 'documentos.editar'

    protected async handle(
        input: EntradaEditarPlantillaDocumento,
        t: Transaccion,
    ): Promise<PlantillaDocumento> {
        await pdfDesdePlantilla(input.html, await vistaDeEjemplo(t.trx))

        await t.trx.rawQuery('LOCK TABLE core.plantillas_documentos IN SHARE ROW EXCLUSIVE MODE')
        const antes = await plantillaVigente(input.tipo, t.trx)
        let id: number
        if (antes.version === 0) {
            if (input.version !== 0) throw new ConflictoVersion('plantilla_documento', input.tipo)
            const [fila] = (await t.trx
                .insertQuery()
                .table('core.plantillas_documentos')
                .insert({ tipo: input.tipo, html: input.html })
                .returning('id')) as Array<{ id: number }>
            id = Number(fila!.id)
        } else {
            const fila = (await t.trx
                .from('core.plantillas_documentos')
                .where('tipo', input.tipo)
                .select('id')
                .first()) as { id: number }
            id = Number(fila.id)
            await actualizarConVersion(t.trx, 'core.plantillas_documentos', id, input.version, {
                html: input.html,
            })
        }
        t.fijarEntidad('plantilla_documento', id)
        const despues = await plantillaVigente(input.tipo, t.trx)
        await t.registrarCambios(
            { tipo: 'plantilla_documento', id },
            { html: antes.html },
            { html: despues.html },
        )
        return despues
    }
}
