import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ConflictoVersion } from '#shared/errores'
import { actualizarConVersion } from '#shared/version'
import {
    camposAuditados,
    exigirNombreLibre,
    filaPlantilla,
    plantillaPorId,
    plantillaPredeterminada,
    validarConEjemplo,
    type FormatoDocumento,
    type PlantillaDocumento,
    type TipoDocumento,
} from '#portal/documentos/render'

export interface EntradaEditarPlantillaDocumento {
    /** plantilla a editar (`PUT /plantillas-documentos/:id`) */
    plantilla_id?: number
    /** sin `plantilla_id`: la predeterminada del tipo (`PUT /documentos/plantillas/:tipo`, compatibilidad) */
    tipo?: TipoDocumento
    nombre?: string
    formato?: FormatoDocumento
    /** HTML nuevo; `null` vuelve a la de fábrica de su tipo y formato */
    html?: string | null
    /** versión leída; 0 si se editó la de fábrica sin fila (solo por tipo) */
    version: number
}

/**
 * Edita una plantilla de documento: nombre, formato y HTML.
 *
 * - Valida que el HTML sea Mustache sin `{{{ }}}` y que genere el PDF con los datos de ejemplo en su
 *   formato (422). `html: null` la devuelve a la de fábrica (sigue a la versión instalada).
 * - Nombre único por tipo (422 en `nombre`). Control optimista por `version` (409).
 * - Por tipo (compatibilidad): edita la predeterminada; con versión 0 y sin predeterminada guardada
 *   la crea («Carta», carta) con `version = 1`.
 * - Diff por campo en `audit.cambios` (entidad `plantilla_documento`).
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
        await t.trx.rawQuery('LOCK TABLE core.plantillas_documentos IN SHARE ROW EXCLUSIVE MODE')

        let id = input.plantilla_id ?? null
        if (id === null) {
            const tipo = input.tipo!
            const actual = await plantillaPredeterminada(tipo, t.trx)
            if (actual.id === null) {
                if (input.version !== 0) throw new ConflictoVersion('plantilla_documento', tipo)
                const formato = input.formato ?? 'carta'
                const nombre = input.nombre ?? 'Carta'
                await exigirNombreLibre(tipo, nombre, null, t.trx)
                if (typeof input.html === 'string') await validarConEjemplo(tipo, formato, input.html, t.trx)
                const despues = {
                    tipo,
                    nombre,
                    formato,
                    predeterminada: true,
                    activa: true,
                    html: input.html ?? null,
                }
                const [fila] = (await t.trx
                    .insertQuery()
                    .table('core.plantillas_documentos')
                    .insert(despues)
                    .returning('id')) as Array<{ id: number }>
                const nuevo = Number(fila!.id)
                t.fijarEntidad('plantilla_documento', nuevo)
                await t.registrarCambios(
                    { tipo: 'plantilla_documento', id: nuevo },
                    camposAuditados({ ...despues, html: actual.html }),
                    camposAuditados(despues),
                )
                return plantillaPorId(nuevo, t.trx)
            }
            id = actual.id
        }

        const antes = await filaPlantilla(id, t.trx, true)
        if (antes.version !== input.version) throw new ConflictoVersion('plantilla_documento', id)
        const nombre = input.nombre ?? antes.nombre
        const formato = input.formato ?? antes.formato
        const html = input.html === undefined ? antes.html : input.html
        if (nombre.toLowerCase() !== antes.nombre.toLowerCase()) {
            await exigirNombreLibre(antes.tipo, nombre, id, t.trx)
        }
        if (html !== null) await validarConEjemplo(antes.tipo, formato, html, t.trx)

        await actualizarConVersion(t.trx, 'core.plantillas_documentos', id, input.version, {
            nombre,
            formato,
            html,
        })
        t.fijarEntidad('plantilla_documento', id)
        await t.registrarCambios(
            { tipo: 'plantilla_documento', id },
            camposAuditados(antes),
            camposAuditados({ ...antes, nombre, formato, html }),
        )
        return plantillaPorId(id, t.trx)
    }
}
