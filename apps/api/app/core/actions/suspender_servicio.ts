import type { EstadoServicio } from '#shared/eventos'
import { TransicionManual } from '#core/transicion_manual'

/**
 * Suspende (corta) un servicio activo o limitado por decisión del operador.
 * Permiso `servicios.suspender`. Ver `TransicionManual`.
 */
export default class SuspenderServicio extends TransicionManual {
    readonly nombre = 'servicios.suspender'
    readonly destino = 'suspendido'
    readonly origenes: readonly EstadoServicio[] = ['activo', 'limitado']
    protected readonly verbo = 'suspender'
    protected override readonly marcaManual = 'poner'
}
