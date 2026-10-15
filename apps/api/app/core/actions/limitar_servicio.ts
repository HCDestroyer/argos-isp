import type { EstadoServicio } from '#shared/eventos'
import { TransicionManual } from '#core/transicion_manual'

/**
 * Limita la velocidad de un servicio activo (o reconecta con velocidad limitada uno suspendido).
 * Permiso `servicios.limitar`. Ver `TransicionManual`.
 */
export default class LimitarServicio extends TransicionManual {
    readonly nombre = 'servicios.limitar'
    readonly destino = 'limitado'
    readonly origenes: readonly EstadoServicio[] = ['activo', 'suspendido']
    protected readonly verbo = 'limitar'
}
