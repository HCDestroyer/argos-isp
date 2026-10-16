import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace routeros:worker`: dispatcher de servicios sin PPPoE (A2, semana 2). Consume el grupo
 * `routeros` del bus de eventos (`ConsumidorRouterOS` → `AplicarRedServicio`) y corre los crons
 * del reconciliador (`recuperar` cada 30 s, `reconciliar` cada 15 min) y la cola `routeros-prefijos`
 * (prefijo delegado de las sesiones en modo `radius_pool`). Proceso aparte en el
 * docker-compose (servicio `routeros-worker`, A6). Lógica en `app/network/routeros`.
 *
 * `--una-vez reconciliar|recuperar` ejecuta un cron y termina (laboratorio, scripts).
 */
export default class RouterOSWorker extends BaseCommand {
    static commandName = 'routeros:worker'
    static description =
        'Dispatcher de RouterOS: aplica el estado de los servicios sin PPPoE por evento y reconcilia los routers'

    static options: CommandOptions = {
        startApp: true,
        staysAlive: true,
    }

    @flags.string({ description: 'Ejecuta un solo cron (reconciliar, recuperar) y termina' })
    declare unaVez?: string

    @flags.boolean({ description: 'No consume el grupo routeros del bus de eventos' })
    declare sinEventos?: boolean

    async run() {
        const {
            crearWorkerRouterOS,
            ejecutarCronRouterOS,
            programarCronsRouterOS,
            cerrarColaCambios,
            NOMBRE_COLA_ROUTEROS,
        } = await import('#network/routeros/jobs')

        if (this.unaVez) {
            const salida = await ejecutarCronRouterOS(this.unaVez)
            this.logger.info(JSON.stringify(salida))
            await this.terminate()
            return
        }

        const { crearWorkerPrefijos, cerrarColaPrefijos } = await import('#network/routeros/prefijos')
        const cola = await programarCronsRouterOS()
        const worker = crearWorkerRouterOS()
        const prefijos = crearWorkerPrefijos()
        this.logger.info(`routeros:worker escuchando la cola ${NOMBRE_COLA_ROUTEROS}`)

        let ejecutor: { detener(): Promise<void> } | null = null
        if (!this.sinEventos) {
            const { EjecutorGrupo } = await import('#shared/eventos_bus')
            const { ConsumidorRouterOS } = await import('#network/routeros/consumidor')
            const grupo = new EjecutorGrupo({ grupo: 'routeros', consumidores: [new ConsumidorRouterOS()] })
            grupo.iniciar()
            ejecutor = grupo
            this.logger.info(`routeros:worker consumiendo el grupo routeros de ${grupo.stream}`)
        }

        const terminar = async () => {
            await ejecutor?.detener()
            await worker.close()
            await prefijos.close()
            await cerrarColaPrefijos()
            await cerrarColaCambios()
            await cola.close()
            await this.terminate()
        }
        process.once('SIGTERM', terminar)
        process.once('SIGINT', terminar)
    }
}
