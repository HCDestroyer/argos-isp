import type { ConsumidorEventos, EventoEntrante } from '#shared/eventos_bus'
import { publicarAaa, refrescarAaa } from '#core/aaa'

/**
 * Grupo `aaa-cache` (A1): por cada `servicio.*` o `asignacion.cambiada` vuelve a escribir
 * `aaa:user:<user_ppp>` desde Postgres. Es la red de seguridad del write-through que hacen las
 * acciones después del COMMIT (si Redis falló en ese momento). Idempotente: siempre escribe el
 * estado actual de la base, con el SET condicionado por `version`.
 * Los cambios de velocidad de un plan llegan como `plan.velocidad_cambiada` (semana 2): se
 * reescriben los servicios del plan (en ese router si trae `router_id`). Otros cambios del plan
 * (pools, perfil sin velocidad) los cubre el gancho de `EditarPlan` e `ImplementarPlan`.
 */
export class ConsumidorAaaCache implements ConsumidorEventos {
    readonly nombre = 'aaa-cache'

    acepta(evento: string): boolean {
        return (
            // los adicionales (streaming, IPTV) no cambian nada de RADIUS
            (evento.startsWith('servicio.') && !evento.startsWith('servicio.adicional_')) ||
            evento === 'asignacion.cambiada' ||
            evento === 'plan.velocidad_cambiada'
        )
    }

    async procesar(evento: EventoEntrante): Promise<void> {
        if (evento.evento === 'plan.velocidad_cambiada') {
            const planId = Number(evento.payload.plan_id)
            if (!Number.isInteger(planId) || planId <= 0) return
            const routerId = evento.payload.router_id === null ? undefined : Number(evento.payload.router_id)
            await refrescarAaa([{ planId, routerId: Number.isInteger(routerId) ? routerId : undefined }])
            return
        }
        const id = Number(evento.payload.servicio_id)
        if (!Number.isInteger(id) || id <= 0) return
        await publicarAaa([id])
    }
}
