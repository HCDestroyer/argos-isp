import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace horus:worker`: conector Horus (A6, `contratos/horus.md`). Consume el grupo `horus` del
 * bus (`argos:eventos`): recarga la configuración con `horus.config_cambiada` y registra los
 * webhooks hacia Horus; y cada pocos segundos entrega los pendientes, firmados, con reintentos a
 * 1 min, 5 min, 30 min, 2 h y 12 h. Con el conector apagado no envía nada. Lógica en
 * `app/integraciones/horus`.
 */
export default class HorusWorker extends BaseCommand {
    static commandName = 'horus:worker'
    static description = 'Worker del conector Horus: webhooks firmados hacia Horus con reintentos'

    static options: CommandOptions = {
        startApp: true,
        staysAlive: true,
    }

    @flags.number({ description: 'Cada cuántos ms se buscan envíos pendientes', default: 5000 })
    declare cadaMs: number

    async run() {
        const { EjecutorGrupo } = await import('#shared/eventos_bus')
        const { ConsumidorHorus, GRUPO_HORUS } = await import('#integraciones/horus/consumidor')
        const { entregarPendientes } = await import('#integraciones/horus/envios')
        const { escucharInvalidacionesHorus, dejarDeEscucharHorus } =
            await import('#integraciones/horus/configuracion')
        await escucharInvalidacionesHorus()

        const grupo = new EjecutorGrupo({ grupo: GRUPO_HORUS, consumidores: [new ConsumidorHorus()] })
        grupo.iniciar()
        this.logger.info(`horus:worker consumiendo el grupo ${grupo.grupo} de ${grupo.stream}`)

        let activo = true
        const ciclo = async () => {
            while (activo) {
                try {
                    // vacía lo que toca ahora, de 50 en 50
                    for (;;) {
                        const r = await entregarPendientes({ limite: 50 })
                        const total = r.enviados + r.reintentar + r.fallidos + r.descartados
                        if (total < 50 || !activo) break
                    }
                } catch (error) {
                    this.logger.error(`horus:worker: error entregando webhooks: ${(error as Error).message}`)
                }
                await new Promise((r) => setTimeout(r, this.cadaMs))
            }
        }
        const vuelta = ciclo()

        const terminar = async () => {
            activo = false
            await grupo.detener()
            await vuelta
            await dejarDeEscucharHorus()
            await this.terminate()
        }
        process.once('SIGTERM', terminar)
        process.once('SIGINT', terminar)
    }
}
