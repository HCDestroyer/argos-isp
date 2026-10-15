import type { ConsumidorEventos, EventoEntrante } from '#shared/eventos_bus'
import { publicarAaa } from '#core/aaa'

/**
 * Grupo `aaa-cache` (A1): por cada `servicio.*` o `asignacion.cambiada` vuelve a escribir
 * `aaa:user:<user_ppp>` desde Postgres. Es la red de seguridad del write-through que hacen las
 * acciones después del COMMIT (si Redis falló en ese momento). Idempotente: siempre escribe el
 * estado actual de la base, con el SET condicionado por `version`.
 * Los cambios de plan no tienen evento en el catálogo: los cubre el gancho de `EditarPlan` e
 * `ImplementarPlan`.
 */
export class ConsumidorAaaCache implements ConsumidorEventos {
    readonly nombre = 'aaa-cache'

    acepta(evento: string): boolean {
        return evento.startsWith('servicio.') || evento === 'asignacion.cambiada'
    }

    async procesar(evento: EventoEntrante): Promise<void> {
        const id = Number(evento.payload.servicio_id)
        if (!Number.isInteger(id) || id <= 0) return
        await publicarAaa([id])
    }
}
