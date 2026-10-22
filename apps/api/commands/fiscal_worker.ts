import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace fiscal:worker`: cola FEL (contrato de localización fiscal §8.3). Cada minuto pide la
 * certificación de los avisos de cobro cubiertos, envía los DTE pendientes, reintenta los que
 * tuvieron error temporal (1, 5, 15, 60 min y luego cada hora) y envía las anulaciones. Cada hora
 * (y al arrancar) corre el cron `fiscal:calendario`: calendario fiscal y alertas de vencimiento y
 * del límite del pequeño contribuyente (fase 7 PR A). Proceso aparte (servicio `fiscal-worker` del
 * compose, A6), con lock: una sola instancia trabaja a la vez.
 *
 * `--una-vez` procesa la cola y el calendario una vez y termina (laboratorio y scripts).
 */
export default class FiscalWorker extends BaseCommand {
    static commandName = 'fiscal:worker'
    static description =
        'Worker fiscal: certifica, reintenta y anula DTE; calendario fiscal y alertas de vencimiento'

    static options: CommandOptions = {
        startApp: true,
        staysAlive: true,
    }

    @flags.boolean({ description: 'Procesa la cola FEL y el calendario una vez y termina' })
    declare unaVez?: boolean

    async run() {
        const {
            crearWorkerFel,
            ejecutarCalendarioFiscal,
            ejecutarColaFel,
            programarColaFel,
            NOMBRE_COLA_FEL,
        } = await import('#fiscal/jobs')
        if (this.unaVez) {
            this.logger.info(JSON.stringify(await ejecutarColaFel()))
            this.logger.info(JSON.stringify(await ejecutarCalendarioFiscal()))
            await this.terminate()
            return
        }
        const cola = await programarColaFel()
        const worker = crearWorkerFel()
        this.logger.info(`fiscal:worker escuchando la cola ${NOMBRE_COLA_FEL}`)
        const terminar = async () => {
            await worker.close()
            await cola.close()
            await this.terminate()
        }
        process.once('SIGTERM', terminar)
        process.once('SIGINT', terminar)
    }
}
