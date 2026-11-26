import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import AsignarPlantillaRecordatorio from '#notify/actions/asignar_plantilla_recordatorio'
import { obtenerPlantillaRecordatorio } from '#notify/plantillas_recordatorio'

export interface EntradaAsignarMasivo {
    plantilla_id: number
    /** servicios a los que se asigna (hasta 500 por llamada, sin repetir) */
    servicio_ids: number[]
}

export interface ResultadoAsignarMasivo {
    plantilla_id: number
    /** servicios cuya asignación cambió */
    asignados: number
    /** ya la tenían */
    sin_cambios: number
}

/**
 * `recordatorios.asignar` (`POST /plantillas-recordatorio/:id/asignar-masivo { servicio_ids }`):
 * asigna la plantilla a varios servicios, **uno por uno** con `AsignarPlantillaRecordatorio` (regla
 * 9: una fila de `audit.acciones`, su diff y su `recordatorios.asignacion_cambiada` por servicio que
 * cambió; nunca un `UPDATE` masivo). Todo o nada: si un servicio no puede recibirla (otra empresa,
 * no existe, fuera de alcance) no se asigna a ninguno y responde el error de ese servicio.
 */
export default class AsignarPlantillaRecordatorioMasivo extends DomainAction<
    EntradaAsignarMasivo,
    ResultadoAsignarMasivo
> {
    readonly nombre = 'recordatorios.asignar'

    protected async handle(input: EntradaAsignarMasivo, t: Transaccion) {
        t.fijarEntidad('plantilla_recordatorio', input.plantilla_id)
        const plantilla = await obtenerPlantillaRecordatorio(input.plantilla_id, t.trx)
        t.fijarEmpresa(plantilla.empresa_id)
        exigirAccesoEmpresa(t.ctx, plantilla.empresa_id)
        const resultado: ResultadoAsignarMasivo = { plantilla_id: plantilla.id, asignados: 0, sin_cambios: 0 }
        for (const servicioId of [...new Set(input.servicio_ids)].sort((a, b) => a - b)) {
            const fila = await new AsignarPlantillaRecordatorio().execute(
                { servicio_id: servicioId, plantilla_id: plantilla.id },
                t.ctx,
                { trx: t.trx },
            )
            if (fila.cambio) resultado.asignados += 1
            else resultado.sin_cambios += 1
        }
        return resultado
    }
}
