import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace sesiones:worker`: consume la cola `aaa-accounting` (la llena `services/aaa` con cada
 * Start, Interim-Update, Stop y Accounting-On/Off), escribe `network.sesiones` y emite
 * `sesion.iniciada` / `sesion.terminada`. Proceso aparte en el docker-compose (A6).
 * Lógica en `app/network/sesiones`.
 */
export default class SesionesWorker extends BaseCommand {
    static commandName = 'sesiones:worker'
    static description = 'Worker de accounting RADIUS: escribe network.sesiones y emite eventos de sesión'

    static options: CommandOptions = {
        startApp: true,
        staysAlive: true,
    }

    @flags.number({ description: 'Paquetes de accounting en paralelo', default: 4 })
    declare concurrencia: number

    async run() {
        const { crearWorkerAccounting } = await import('#network/sesiones/cola')
        const worker = crearWorkerAccounting({ concurrencia: this.concurrencia })
        this.logger.info(`sesiones:worker escuchando la cola ${worker.name}`)

        const terminar = async () => {
            await worker.close()
            await this.terminate()
        }
        process.once('SIGTERM', terminar)
        process.once('SIGINT', terminar)
    }
}
