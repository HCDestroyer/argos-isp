import { Decimal } from 'decimal.js'
import logger from '@adonisjs/core/services/logger'
import { contextoSistema } from '#shared/contexto'
import RegistrarAlerta, { EVENTOS_ALERTA, type EventoAlerta } from '#notify/actions/registrar_alerta'
import type { ColaEnvios } from '#notify/cola'
import type { ConsumidorEventos, EventoEntrante } from '#shared/eventos_bus'

/**
 * Consumidor de alertas internas (grupo `notify` del bus, junto a `ConsumidorNotify`): `aaa.caido`,
 * `aaa.recuperado`, `coa.fallido` y `caja.cerrada` con diferencia. La lógica está en la acción
 * `RegistrarAlerta` (idempotente por `outbox:<id>`). Si falla, lanza y el evento se reintenta.
 */
export class ConsumidorAlertas implements ConsumidorEventos {
    readonly nombre = 'alertas'

    constructor(private readonly cola: ColaEnvios) {}

    acepta(evento: string): boolean {
        return (EVENTOS_ALERTA as readonly string[]).includes(evento)
    }

    async procesar(evento: EventoEntrante): Promise<void> {
        if (!this.acepta(evento.evento)) return
        const payload = evento.payload ?? {}
        // Un cierre de caja cuadrado no es un incidente: ni siquiera se audita.
        if (evento.evento === 'caja.cerrada' && esCero(payload.diferencia)) return

        const resultado = await new RegistrarAlerta().execute(
            { origen: `outbox:${evento.id}`, evento: evento.evento as EventoAlerta, payload },
            contextoSistema('worker', evento.requestId || `outbox-${evento.id}`),
        )
        await this.cola.encolar(resultado.encolar)
        if (resultado.alerta) {
            logger.warn(
                {
                    outboxId: evento.id,
                    evento: evento.evento,
                    incidenteId: resultado.incidenteId,
                    requestId: evento.requestId ?? null,
                },
                'Alerta interna al equipo',
            )
        }
    }
}

function esCero(valor: unknown): boolean {
    try {
        return new Decimal(String(valor ?? '0')).isZero()
    } catch {
        return false
    }
}
