import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ReglaNegocio } from '#shared/errores'
import type { EstadoServicio } from '#shared/eventos'
import { verServicio } from '#core/consultas/servicios'

/** Estados entre los que se mueve un servicio vivo. `retirado` solo se alcanza con `RetirarServicio`. */
export type EstadoOperativo = Exclude<EstadoServicio, 'retirado'>

export const ESTADOS_OPERATIVOS: readonly EstadoOperativo[] = ['activo', 'limitado', 'suspendido']

export interface EntradaCambiarEstado {
    servicioId: number
    nuevo: EstadoOperativo
    motivo: string
}

export interface ResultadoCambiarEstado {
    servicioId: number
    de: EstadoServicio
    a: EstadoServicio
    /** false si el servicio ya estaba en `nuevo`: no se escribe nada ni se emite evento */
    cambiado: boolean
}

/**
 * Máquina de estados del servicio (tarea 8 de A1). Ejecuta la transición; **no decide cuándo**:
 * eso es `evaluarEstadoServicio` de billing, que la llama anidada con `{ trx }`.
 *
 * - Transiciones válidas: entre `activo`, `limitado` y `suspendido` en cualquier sentido (una
 *   plantilla con `facturas_para_limitar = 0` pasa de activo a suspendido sin limitar).
 * - Desde `retirado` no hay vuelta: 422 `servicio_retirado`. Para retirar se usa `RetirarServicio`.
 * - Mismo estado: no hace nada (`cambiado: false`), para que los llamadores sean idempotentes.
 * - Bloquea la fila (`FOR UPDATE`) para que dos evaluaciones concurrentes no se pisen.
 * - Emite `servicio.estado_cambiado` por outbox y registra el diff en `audit.cambios`.
 */
export default class CambiarEstadoServicio extends DomainAction<
    EntradaCambiarEstado,
    ResultadoCambiarEstado
> {
    readonly nombre = 'servicios.cambiar_estado'

    protected async handle(input: EntradaCambiarEstado, t: Transaccion): Promise<ResultadoCambiarEstado> {
        t.fijarEntidad('servicio', input.servicioId)
        if (!ESTADOS_OPERATIVOS.includes(input.nuevo)) {
            throw new ReglaNegocio(`Estado destino no válido: ${String(input.nuevo)}`, 'estado_invalido')
        }
        const fila = (await t.trx
            .from('core.servicios')
            .where('id', input.servicioId)
            .forUpdate()
            .select('estado')
            .first()) as { estado: EstadoServicio } | null
        if (!fila) throw new NoEncontrado(`El servicio ${input.servicioId} no existe`)
        if (fila.estado === 'retirado') {
            throw new ReglaNegocio('El servicio está retirado y no cambia de estado', 'servicio_retirado')
        }
        if (fila.estado === input.nuevo) {
            return { servicioId: input.servicioId, de: fila.estado, a: fila.estado, cambiado: false }
        }

        const antes = await verServicio(input.servicioId, t.trx)
        await t.trx
            .from('core.servicios')
            .where('id', input.servicioId)
            .update({
                estado: input.nuevo,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        const despues = await verServicio(input.servicioId, t.trx)
        await t.registrarCambios({ tipo: 'servicio', id: input.servicioId }, antes, despues)
        await t.emit('servicio.estado_cambiado', {
            servicio_id: input.servicioId,
            de: fila.estado,
            a: input.nuevo,
            motivo: input.motivo,
        })
        return { servicioId: input.servicioId, de: fila.estado, a: input.nuevo, cambiado: true }
    }
}
