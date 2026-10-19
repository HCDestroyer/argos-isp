import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ReglaNegocio } from '#shared/errores'
import { verificarVersion } from '#shared/version'
import {
    darDeBajaAsignacion,
    filaAsignacion,
    servicioParaAdicional,
    verAsignacion,
    type AsignacionAdicionalVista,
} from '#core/adicionales'

export interface EntradaQuitarAdicionalServicio {
    servicio_id: number
    /** id de la asignación (`core.servicios_adicionales`) */
    id: number
    version: number
    motivo?: string | null
}

/**
 * Da de baja un adicional de un servicio (`servicios.quitar_adicional`): `estado = baja` con
 * `baja_en`; nunca se borra. Control por `version` (409). Ya dado de baja: 422
 * `adicional_dado_de_baja`. Emite `servicio.adicional_quitado` (`origen: manual`).
 */
export default class QuitarAdicionalServicio extends DomainAction<
    EntradaQuitarAdicionalServicio,
    AsignacionAdicionalVista
> {
    readonly nombre = 'servicios.quitar_adicional'

    protected async handle(
        input: EntradaQuitarAdicionalServicio,
        t: Transaccion,
    ): Promise<AsignacionAdicionalVista> {
        t.fijarEntidad('servicio', input.servicio_id)
        const servicio = await servicioParaAdicional(t, input.servicio_id)
        const antes = await filaAsignacion(t, input.id, true)
        if (antes.servicio_id !== servicio.id) {
            throw new NoEncontrado(`El servicio ${servicio.id} no tiene el adicional asignado ${input.id}`)
        }
        verificarVersion('adicional asignado', input.id, antes.version, input.version)
        if (antes.estado === 'baja') {
            throw new ReglaNegocio('El adicional ya está dado de baja', 'adicional_dado_de_baja')
        }
        await darDeBajaAsignacion(t, servicio, antes, 'manual', input.motivo ?? null)
        return verAsignacion(servicio.id, input.id, t.trx)
    }
}
