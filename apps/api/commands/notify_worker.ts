import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace notify:worker`: procesa la cola de envíos de notificaciones (BullMQ).
 * Corre como proceso aparte (servicio `worker` del docker-compose). Lógica en `app/notify`.
 */
export default class NotifyWorker extends BaseCommand {
    static commandName = 'notify:worker'
    static description = 'Worker de notificaciones: entrega los envíos encolados (correo, Telegram)'

    static options: CommandOptions = {
        startApp: true,
        staysAlive: true,
    }

    @flags.number({ description: 'Envíos en paralelo', default: 5 })
    declare concurrencia: number

    async run() {
        const { ColaEnviosBullmq, crearWorkerEnvios } = await import('#notify/cola')
        const cola = new ColaEnviosBullmq()
        const worker = crearWorkerEnvios(cola, { concurrencia: this.concurrencia })
        this.logger.info(`notify:worker escuchando la cola ${cola.cola.name}`)

        const terminar = async () => {
            await worker.close()
            await cola.cerrar()
            await this.terminate()
        }
        process.once('SIGTERM', terminar)
        process.once('SIGINT', terminar)
    }
}
