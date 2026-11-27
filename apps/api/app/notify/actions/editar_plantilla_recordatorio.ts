import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { ConflictoVersion } from '#shared/errores'
import {
    bloquearPlantilla,
    exigirNoPersonalizada,
    exigirNombreLibre,
    guardarPasos,
    normalizarPasos,
    obtenerPlantillaRecordatorio,
    paraAuditoria,
    type EntradaPaso,
    type PlantillaRecordatorio,
} from '#notify/plantillas_recordatorio'

export interface EntradaEditarPlantillaRecordatorio {
    id: number
    version: number
    nombre?: string
    descripcion?: string | null
    /** el conjunto completo: los pasos que no vengan se borran */
    pasos?: EntradaPaso[]
}

/**
 * `recordatorios.editar` (`PUT /plantillas-recordatorio/:id`): nombre, descripción y el conjunto de
 * pasos. `version` vieja: 409; nombre repetido: 409 `plantilla_duplicada`; pasos inválidos: 422. La
 * personalizada de un servicio no se edita aquí (409 `plantilla_personalizada`). Una retirada se
 * puede seguir editando para quienes ya la tienen. Editar los pasos no reenvía lo ya enviado: el
 * origen del envío depende del paso y de la factura, no de la plantilla. Diff en `audit.cambios` y
 * `recordatorios.plantilla_cambiada` si algo cambió.
 */
export default class EditarPlantillaRecordatorio extends DomainAction<
    EntradaEditarPlantillaRecordatorio,
    PlantillaRecordatorio
> {
    readonly nombre = 'recordatorios.editar'

    protected async handle(input: EntradaEditarPlantillaRecordatorio, t: Transaccion) {
        t.fijarEntidad('plantilla_recordatorio', input.id)
        const antes = await bloquearPlantilla(t.trx, input.id)
        t.fijarEmpresa(antes.empresa_id)
        exigirAccesoEmpresa(t.ctx, antes.empresa_id)
        if (antes.version !== input.version) throw new ConflictoVersion('plantilla_recordatorio', input.id)
        exigirNoPersonalizada(antes)

        const cambios: Record<string, unknown> = {}
        if (input.nombre !== undefined && input.nombre.trim() !== antes.nombre) {
            await exigirNombreLibre(t.trx, antes.empresa_id, input.nombre, antes.id)
            cambios.nombre = input.nombre.trim()
        }
        if (input.descripcion !== undefined) cambios.descripcion = input.descripcion?.trim() || null
        const pasos = input.pasos === undefined ? null : normalizarPasos(input.pasos)

        await t.trx
            .from('notify.plantillas_recordatorio')
            .where('id', antes.id)
            .update({
                ...cambios,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            })
        const pasosCambiaron = pasos === null ? false : await guardarPasos(t.trx, antes.id, pasos)

        const despues = await obtenerPlantillaRecordatorio(antes.id, t.trx)
        const campos = await t.registrarCambios(
            { tipo: 'plantilla_recordatorio', id: antes.id },
            paraAuditoria(antes),
            paraAuditoria(despues),
        )
        const camposPlantilla = campos.filter((c) => c !== 'pasos')
        if (camposPlantilla.length > 0 || pasosCambiaron) {
            await t.emit('recordatorios.plantilla_cambiada', {
                plantilla_id: antes.id,
                empresa_id: antes.empresa_id,
                campos: camposPlantilla,
                pasos: pasosCambiaron,
            })
        }
        return despues
    }
}
