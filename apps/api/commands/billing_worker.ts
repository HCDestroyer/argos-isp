import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace billing:worker`: crons de facturación (generar facturas, vencer y aplicar mora,
 * corte a la hora de cada plantilla) con job schedulers de BullMQ. Corre como proceso aparte
 * (servicio `billing-worker` del docker-compose, A6). Lógica en `app/billing` (acciones).
 *
 * Además consume el grupo `billing` del bus de eventos (`pago.registrado` → cumplir promesas,
 * `ConsumidorBilling`; `factura.*`, `pago.*`, `promesa.*` y `servicio.estado_cambiado` →
 * refrescar los resúmenes del dashboard, `ConsumidorResumenes`); `--sin-eventos` lo apaga.
 *
 * `--una-vez <cron>` ejecuta un solo cron (`generar`, `vencer`, `corte` o `promesas`) y termina:
 * útil en el laboratorio y en scripts.
 */
export default class BillingWorker extends BaseCommand {
    static commandName = 'billing:worker'
    static description =
        'Worker de facturación: genera facturas, vence con mora, ejecuta el corte, cierra promesas y consume el grupo billing'

    static options: CommandOptions = {
        startApp: true,
        staysAlive: true,
    }

    @flags.string({ description: 'Ejecuta un solo cron (generar, vencer, corte, promesas) y termina' })
    declare unaVez?: string

    @flags.boolean({ description: 'No consume el grupo billing del bus de eventos' })
    declare sinEventos?: boolean

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

        let ejecutor: { detener(): Promise<void> } | null = null
        if (!this.sinEventos) {
            const { EjecutorGrupo } = await import('#shared/eventos_bus')
            const { ConsumidorBilling } = await import('#billing/consumidor')
            const { ConsumidorResumenes } = await import('#billing/reportes/resumenes')
            // promesas primero (pueden cambiar estados) y después los resúmenes del dashboard
            const grupo = new EjecutorGrupo({
                grupo: 'billing',
                consumidores: [new ConsumidorBilling(), new ConsumidorResumenes()],
            })
            grupo.iniciar()
            ejecutor = grupo
            this.logger.info(`billing:worker consumiendo el grupo billing de ${grupo.stream}`)
        }

        const terminar = async () => {
            await ejecutor?.detener()
            await worker.close()
            await cola.close()
            await this.terminate()
        }
        process.once('SIGTERM', terminar)
        process.once('SIGINT', terminar)
    }
}
