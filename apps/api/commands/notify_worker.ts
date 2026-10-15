import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace notify:worker`: procesa la cola de envíos de notificaciones (BullMQ) y el cron de
 * recordatorios de pago, y consume el grupo `notify` del bus de eventos. Corre como proceso aparte (servicio `worker` del docker-compose).
 * Lógica en `app/notify`.
 */
export default class NotifyWorker extends BaseCommand {
    static commandName = 'notify:worker'
    static description =
        'Worker de notificaciones: entrega envíos (correo, Telegram) y corre los recordatorios'

    static options: CommandOptions = {
        startApp: true,
        staysAlive: true,
    }

    @flags.number({ description: 'Envíos en paralelo', default: 5 })
    declare concurrencia: number

    @flags.boolean({ description: 'No correr el cron de recordatorios en este proceso', default: false })
    declare sinCron: boolean

    @flags.boolean({ description: 'No consumir el grupo notify del bus de eventos', default: false })
    declare sinEventos: boolean

    async run() {
        const { ColaEnviosBullmq, crearWorkerEnvios } = await import('#notify/cola')
        const { crearWorkerCron, programarCronRecordatorios } = await import('#notify/recordatorios')

        const cola = new ColaEnviosBullmq()
        const workers = [crearWorkerEnvios(cola, { concurrencia: this.concurrencia })]
        this.logger.info(`notify:worker escuchando la cola ${cola.cola.name}`)

        const colaCron = this.sinCron ? null : await programarCronRecordatorios()
        if (colaCron) {
            workers.push(crearWorkerCron(cola))
            this.logger.info(`notify:worker con cron de recordatorios (${colaCron.name})`)
        }

        // Grupo `notify` del bus de eventos (contrato en .claude/integration/contratos/eventos.md, A1)
        const { EjecutorGrupo } = await import('#shared/eventos_bus')
        const { ConsumidorNotify } = await import('#notify/consumidor')
        const grupo = this.sinEventos
            ? null
            : new EjecutorGrupo({ grupo: 'notify', consumidores: [new ConsumidorNotify(cola)] })
        if (grupo) {
            grupo.iniciar()
            this.logger.info(`notify:worker consumiendo el grupo ${grupo.grupo} de ${grupo.stream}`)
        }

        const terminar = async () => {
            await grupo?.detener()
            await Promise.all(workers.map((w) => w.close()))
            await colaCron?.close()
            await cola.cerrar()
            await this.terminate()
        }
        process.once('SIGTERM', terminar)
        process.once('SIGINT', terminar)
    }
}
