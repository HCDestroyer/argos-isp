import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace billing:worker`: crons de facturación (generar facturas, vencer y aplicar mora,
 * corte a la hora de cada plantilla) con job schedulers de BullMQ. Corre como proceso aparte
 * (servicio `billing-worker` del docker-compose, A6). Lógica en `app/billing` (acciones).
 *
 * Además consume el grupo `billing` del bus de eventos (`pago.registrado` → cumplir promesas,
 * `ConsumidorBilling`; `factura.*`, `pago.*`, `promesa.*` y `servicio.estado_cambiado` →
 * refrescar los resúmenes del dashboard, `ConsumidorResumenes`; `fiscal.parametros_cambiados` →
 * invalidar la caché de parámetros fiscales, `ConsumidorFiscal`; `pago.registrado` → pedir la
 * certificación de los avisos de cobro cubiertos, `ConsumidorFel`); `--sin-eventos` lo apaga.
 *
 * También consume el grupo `lealtad` (`ConsumidorLealtad`: pagos, facturas, notas de crédito y
 * servicios retirados → `lealtad.evaluar_evento`) y agenda los crons `lealtad:antiguedad` y
 * `lealtad:vencer`.
 *
 * `--una-vez <cron>` ejecuta un solo cron (`generar`, `vencer`, `corte`, `promesas`, `conciliar`, `sellar`,
 * `integridad`, `lealtad:antiguedad` o `lealtad:vencer`) y termina:
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

    @flags.string({
        description:
            'Ejecuta un solo cron (generar, vencer, corte, promesas, conciliar, sellar, integridad, lealtad:antiguedad, lealtad:vencer) y termina',
    })
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

        const ejecutores: Array<{ detener(): Promise<void> }> = []
        if (!this.sinEventos) {
            const { EjecutorGrupo } = await import('#shared/eventos_bus')
            const { ConsumidorBilling } = await import('#billing/consumidor')
            const { ConsumidorResumenes } = await import('#billing/reportes/resumenes')
            const { ConsumidorFiscal } = await import('#fiscal/consumidor')
            const { ConsumidorFel } = await import('#fiscal/consumidor_fel')
            // promesas primero (pueden cambiar estados) y después los resúmenes del dashboard
            const grupo = new EjecutorGrupo({
                grupo: 'billing',
                consumidores: [
                    new ConsumidorBilling(),
                    new ConsumidorResumenes(),
                    new ConsumidorFiscal(),
                    new ConsumidorFel(),
                ],
            })
            grupo.iniciar()
            ejecutores.push(grupo)
            this.logger.info(`billing:worker consumiendo el grupo billing de ${grupo.stream}`)

            // programa de lealtad: grupo propio (un fallo de lealtad no reintenta los consumidores de billing)
            const { ConsumidorLealtad } = await import('#lealtad/consumidor')
            const lealtad = new EjecutorGrupo({ grupo: 'lealtad', consumidores: [new ConsumidorLealtad()] })
            lealtad.iniciar()
            ejecutores.push(lealtad)
            this.logger.info(`billing:worker consumiendo el grupo lealtad de ${lealtad.stream}`)
        }

        const terminar = async () => {
            for (const ejecutor of ejecutores) await ejecutor.detener()
            await worker.close()
            await cola.close()
            await this.terminate()
        }
        process.once('SIGTERM', terminar)
        process.once('SIGINT', terminar)
    }
}
