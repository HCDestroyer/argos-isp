import type { EstadoServicio } from '#shared/eventos'
import { TransicionManual } from '#core/transicion_manual'

/**
 * Reactiva un servicio suspendido o limitado: lo lleva a `activo`.
 * Permiso `servicios.reactivar`. Ver `TransicionManual`.
 */
export default class ReactivarServicio extends TransicionManual {
    readonly nombre = 'servicios.reactivar'
    readonly destino = 'activo'
    readonly origenes: readonly EstadoServicio[] = ['suspendido', 'limitado']
    protected readonly verbo = 'reactivar'
}
