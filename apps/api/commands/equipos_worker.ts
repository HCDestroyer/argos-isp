import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace equipos:worker`: equipos del cliente con SmartOLT y GenieACS (A6, contrato Iris 0.9.0
 * §12). Cola BullMQ `equipos`: aprovisionamientos (A32), cambios de Wi-Fi (A35) y, cada 30 s, todo
 * lo `en_proceso` con su reintento vencido. Lógica en `app/integraciones/equipos/` (acciones).
 */
export default class EquiposWorker extends BaseCommand {
    static commandName = 'equipos:worker'
    static description = 'Worker de equipos: aprovisiona ONT (SmartOLT) y configura routers (GenieACS)'

    static options: CommandOptions = {
        startApp: true,
        staysAlive: true,
    }

    async run() {
        const { iniciarWorkerEquipos } = await import('#integraciones/equipos/cola')
        const { cola, worker } = await iniciarWorkerEquipos()
        this.logger.info('equipos:worker escuchando la cola equipos')
        const terminar = async () => {
            await worker.close()
            await cola.close()
            await this.terminate()
        }
        process.once('SIGTERM', terminar)
        process.once('SIGINT', terminar)
    }
}
