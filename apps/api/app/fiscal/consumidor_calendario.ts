import logger from '@adonisjs/core/services/logger'
import { contextoSistema } from '#shared/contexto'
import type { ConsumidorEventos, EventoEntrante } from '#shared/eventos_bus'
import { OBLIGACIONES_GT } from '#fiscal/l10n/gt/obligaciones'
import GenerarCalendario from '#fiscal/actions/generar_calendario'

/** Parámetros que cambian el calendario: régimen, banderas, inicio de libros y plazos. */
export const CLAVES_CALENDARIO: ReadonlySet<string> = new Set([
    'regimen',
    'agente_retencion_iva',
    'inicio_libros',
    ...OBLIGACIONES_GT.map((d) => d.parametro_plazo),
])

/**
 * Consumidor de `fiscal.parametros_cambiados` (grupo `billing`, en `node ace billing:worker`):
 * cuando cambia el régimen, una bandera, `inicio_libros` o un plazo, regenera al momento el
 * calendario de esa empresa (todas si el valor es global) sin esperar al cron (regla 3). Los
 * feriados recalculan en su propia acción. Idempotente: generar dos veces no cambia nada.
 */
export class ConsumidorCalendario implements ConsumidorEventos {
    readonly nombre = 'fiscal-calendario'

    acepta(evento: string): boolean {
        return evento === 'fiscal.parametros_cambiados'
    }

    async procesar(evento: EventoEntrante): Promise<void> {
        if (!this.acepta(evento.evento)) return
        const claves = Array.isArray(evento.payload.claves) ? (evento.payload.claves as string[]) : []
        if (!claves.some((c) => CLAVES_CALENDARIO.has(c))) return
        const empresaId = typeof evento.payload.empresa_id === 'number' ? evento.payload.empresa_id : null
        const resultado = await new GenerarCalendario().execute(
            { empresa_id: empresaId },
            contextoSistema('worker', `fiscal-calendario-evento-${evento.id}`),
        )
        logger.info(
            { outboxId: evento.id, empresa_id: empresaId, claves, resultado },
            'fiscal: calendario regenerado',
        )
    }
}
