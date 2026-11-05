import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace iris:worker`: webhooks Argos → Iris (A6, `contratos/iris.md` §2.3). Consume el grupo
 * `iris` del bus (`argos:eventos`) y registra los webhooks de los eventos de §2.3; cada pocos
 * segundos entrega los pendientes, firmados, con reintentos a 1 min, 5 min, 30 min, 2 h y 12 h.
 * Sin conector activo con receptor no envía nada. Lógica en `app/integraciones/iris/envios.ts`
 * (motor común con Horus: `app/integraciones/webhooks_salientes.ts`).
 *
 * Contrato 0.6.0 (§6): en la misma vuelta entrega los permisos de contacto por WhatsApp pendientes
 * (`#notify/consentimientos`) y, cada hora, concilia los avisos de WhatsApp que esperan acuse de
 * Iris hace más de 24 h (`ConciliarAvisosIris`).
 */
export default class IrisWorker extends BaseCommand {
    static commandName = 'iris:worker'
    static description = 'Worker del conector Iris: webhooks firmados hacia Iris con reintentos'

    static options: CommandOptions = {
        startApp: true,
        staysAlive: true,
    }

    @flags.number({ description: 'Cada cuántos ms se buscan envíos pendientes', default: 5000 })
    declare cadaMs: number

    async run() {
        const { EjecutorGrupo } = await import('#shared/eventos_bus')
        const { ConsumidorIris, GRUPO_IRIS } = await import('#integraciones/iris/consumidor')
        const { entregarPendientesIris } = await import('#integraciones/iris/envios')
        const { entregarConsentimientosIris } = await import('#notify/consentimientos')
        const { default: ConciliarAvisosIris } = await import('#notify/actions/conciliar_avisos_iris')
        const { contextoSistema } = await import('#shared/contexto')
        const CADA_CONCILIACION_MS = 3600 * 1000
        let ultimaConciliacion = 0

        const grupo = new EjecutorGrupo({ grupo: GRUPO_IRIS, consumidores: [new ConsumidorIris()] })
        grupo.iniciar()
        this.logger.info(`iris:worker consumiendo el grupo ${grupo.grupo} de ${grupo.stream}`)

        let activo = true
        const ciclo = async () => {
            while (activo) {
                try {
                    // vacía lo que toca ahora, de 50 en 50
                    for (;;) {
                        const r = await entregarPendientesIris({ limite: 50 })
                        const total = r.enviados + r.reintentar + r.fallidos + r.descartados
                        if (total < 50 || !activo) break
                    }
                } catch (error) {
                    this.logger.error(`iris:worker: error entregando webhooks: ${(error as Error).message}`)
                }
                try {
                    await entregarConsentimientosIris({ limite: 50 })
                } catch (error) {
                    this.logger.error(
                        `iris:worker: error entregando consentimientos: ${(error as Error).message}`,
                    )
                }
                if (Date.now() - ultimaConciliacion >= CADA_CONCILIACION_MS) {
                    ultimaConciliacion = Date.now()
                    try {
                        await new ConciliarAvisosIris().execute(
                            {},
                            contextoSistema('worker', `iris-conciliar-${ultimaConciliacion}`),
                        )
                    } catch (error) {
                        this.logger.error(
                            `iris:worker: error conciliando avisos: ${(error as Error).message}`,
                        )
                    }
                }
                await new Promise((r) => setTimeout(r, this.cadaMs))
            }
        }
        const vuelta = ciclo()

        const terminar = async () => {
            activo = false
            await grupo.detener()
            await vuelta
            await this.terminate()
        }
        process.once('SIGTERM', terminar)
        process.once('SIGINT', terminar)
    }
}
