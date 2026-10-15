import type { EstadoServicio } from '#shared/eventos'
import { TransicionManual } from '#core/transicion_manual'

/**
 * Quita el límite de velocidad de un servicio limitado: lo lleva a `activo`.
 * Permiso `servicios.quitar_limite`. Ver `TransicionManual`.
 */
export default class QuitarLimiteServicio extends TransicionManual {
    readonly nombre = 'servicios.quitar_limite'
    readonly destino = 'activo'
    readonly origenes: readonly EstadoServicio[] = ['limitado']
    protected readonly verbo = 'quitar el límite a'
}
