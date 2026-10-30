import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace sesiones:worker`: consume la cola `aaa-accounting` (la llena `services/aaa` con cada
 * Start, Interim-Update, Stop y Accounting-On/Off), escribe `network.sesiones` y emite
 * `sesion.iniciada` / `sesion.terminada`. Proceso aparte en el docker-compose (A6).
 * Además corre el cron de sesiones colgadas (cola `sesiones-cron`, `colgadas.ts`; con lock, se
 * pueden tener varias réplicas). `--sin-cron` lo apaga en esta réplica.
 * Y consume el grupo `sesiones` del bus (`servicio.eliminado` → Disconnect de una sesión que haya
 * quedado viva; `sesiones/consumidor.ts`). `--sin-eventos` lo apaga en esta réplica.
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

    @flags.boolean({ description: 'No correr el cron de sesiones colgadas en esta réplica', default: false })
    declare sinCron: boolean

    @flags.boolean({ description: 'No consumir el grupo sesiones del bus en esta réplica', default: false })
    declare sinEventos: boolean

    async run() {
        const { crearWorkerAccounting } = await import('#network/sesiones/cola')
        const worker = crearWorkerAccounting({ concurrencia: this.concurrencia })
        this.logger.info(`sesiones:worker escuchando la cola ${worker.name}`)

        let cron: { close(): Promise<void> } | null = null
        let colaCron: { close(): Promise<void> } | null = null
        if (!this.sinCron) {
            const { crearWorkerCronSesiones, programarCronSesiones, configColgadas } =
                await import('#network/sesiones/colgadas')
            colaCron = await programarCronSesiones()
            if (configColgadas().cadaMs > 0) {
                cron = crearWorkerCronSesiones()
                this.logger.info(
                    `sesiones:worker cierra sesiones colgadas (> ${configColgadas().umbralS} s sin accounting)`,
                )
            }
        }

        let ejecutor: { detener(): Promise<void> } | null = null
        if (!this.sinEventos) {
            const { EjecutorGrupo } = await import('#shared/eventos_bus')
            const { ConsumidorSesiones, GRUPO_SESIONES } = await import('#network/sesiones/consumidor')
            const grupo = new EjecutorGrupo({
                grupo: GRUPO_SESIONES,
                consumidores: [new ConsumidorSesiones()],
            })
            grupo.iniciar()
            ejecutor = grupo
            this.logger.info(`sesiones:worker consumiendo el grupo ${GRUPO_SESIONES} de ${grupo.stream}`)
        }

        const terminar = async () => {
            await ejecutor?.detener()
            await worker.close()
            await cron?.close()
            await colaCron?.close()
            await this.terminate()
        }
        process.once('SIGTERM', terminar)
        process.once('SIGINT', terminar)
    }
}
