import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { ConflictoVersion, NoEncontrado } from '#shared/errores'
import {
    obtenerPlantillaRecordatorio,
    paraAuditoria,
    recordatoriosDe,
    type RecordatoriosDe,
} from '#notify/plantillas_recordatorio'

export interface EntradaQuitarPersonalizados {
    servicio_id: number
    /** `version` de la plantilla personalizada */
    version: number
}

/**
 * `recordatorios.personalizar` (`POST /servicios/:id/recordatorios/quitar-personalizados { version }`):
 * borra la plantilla personalizada del servicio y sus pasos; el servicio vuelve a su plantilla
 * asignada o a la por defecto de su empresa. 404 si no tiene personalizados; `version` vieja, 409.
 * Diff en `audit.cambios` (de la plantilla y del servicio), `recordatorios.plantilla_cambiada` y
 * `recordatorios.asignacion_cambiada` (`personalizada: false`, con la asignada o null). Lo ya
 * enviado no se repite (el origen depende del paso y de la factura).
 */
export default class QuitarRecordatoriosPersonalizados extends DomainAction<
    EntradaQuitarPersonalizados,
    RecordatoriosDe
> {
    readonly nombre = 'recordatorios.personalizar'

    protected async handle(input: EntradaQuitarPersonalizados, t: Transaccion) {
        t.fijarEntidad('servicio', input.servicio_id)
        const fila = (await t.trx
            .from('notify.plantillas_recordatorio')
            .where('servicio_id', input.servicio_id)
            .forUpdate()
            .select('id', 'version')
            .first()) as { id: number; version: number } | null
        if (!fila) {
            throw new NoEncontrado(`El servicio ${input.servicio_id} no tiene recordatorios personalizados`)
        }
        const antes = await obtenerPlantillaRecordatorio(fila.id, t.trx)
        t.fijarEmpresa(antes.empresa_id)
        exigirAccesoEmpresa(t.ctx, antes.empresa_id)
        if (antes.version !== input.version) throw new ConflictoVersion('plantilla_recordatorio', antes.id)

        await t.trx.from('notify.plantillas_recordatorio').where('id', antes.id).delete()
        await t.registrarCambios({ tipo: 'plantilla_recordatorio', id: antes.id }, paraAuditoria(antes), null)
        await t.registrarCambios(
            { tipo: 'servicio', id: input.servicio_id },
            { recordatorios_personalizados: antes.pasos },
            { recordatorios_personalizados: null },
        )
        const asignada = (await t.trx
            .from('notify.recordatorios_asignaciones')
            .where({ servicio_id: input.servicio_id, empresa_id: antes.empresa_id })
            .select('plantilla_id')
            .first()) as { plantilla_id: number } | null
        await t.emit('recordatorios.plantilla_cambiada', {
            plantilla_id: antes.id,
            empresa_id: antes.empresa_id,
            campos: ['eliminada'],
            pasos: true,
        })
        await t.emit('recordatorios.asignacion_cambiada', {
            empresa_id: antes.empresa_id,
            servicio_id: input.servicio_id,
            suscripcion_id: null,
            plantilla_id: asignada ? Number(asignada.plantilla_id) : null,
            personalizada: false,
        })
        return recordatoriosDe({ servicioId: input.servicio_id }, t.trx)
    }
}
