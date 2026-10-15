import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace billing:worker`: crons de facturación (generar facturas, vencer y aplicar mora,
 * corte a la hora de cada plantilla) con job schedulers de BullMQ. Corre como proceso aparte
 * (servicio `billing-worker` del docker-compose, A6). Lógica en `app/billing` (acciones).
 *
 * `--una-vez <cron>` ejecuta un solo cron (`generar`, `vencer` o `corte`) y termina: útil en el
 * laboratorio y en scripts.
 */
export default class BillingWorker extends BaseCommand {
    static commandName = 'billing:worker'
    static description = 'Worker de facturación: genera facturas, vence con mora y ejecuta el corte'

    static options: CommandOptions = {
        startApp: true,
        staysAlive: true,
    }

    @flags.string({ description: 'Ejecuta un solo cron (generar, vencer, corte) y termina' })
    declare unaVez?: string

    async run() {
        const { crearWorkerBilling, ejecutarCron, programarCronsBilling, NOMBRE_COLA_BILLING } =
            await import('#billing/jobs')

        if (this.unaVez) {
            const salida = await ejecutarCron(this.unaVez)
            this.logger.info(JSON.stringify(salida))
            await this.terminate()
            return
        }

        const cola = await programarCronsBilling()
        const worker = crearWorkerBilling()
        this.logger.info(`billing:worker escuchando la cola ${NOMBRE_COLA_BILLING}`)

        const terminar = async () => {
            await worker.close()
            await cola.close()
            await this.terminate()
        }
        process.once('SIGTERM', terminar)
        process.once('SIGINT', terminar)
    }
}
