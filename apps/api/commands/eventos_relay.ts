import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace eventos:relay`: publica `audit.outbox` en el stream `argos:eventos` (un solo relay
 * activo por lock en Redis), consume el grupo `aaa-cache` (reescribe `aaa:user:*`) y atiende los
 * crons del núcleo (`core-cron`: inicio y fin de planes temporales, `app/core/jobs.ts`).
 * Corre como proceso aparte. Lógica en `app/shared/relay_outbox.ts`, `app/shared/eventos_bus.ts` y
 * `app/core/jobs.ts`. `--una-vez planes_temporales` corre ese cron una vez y termina.
 */
export default class EventosRelay extends BaseCommand {
    static commandName = 'eventos:relay'
    static description = 'Relay del outbox a Redis Streams y consumidor del grupo aaa-cache'

    static options: CommandOptions = {
        startApp: true,
        staysAlive: true,
    }

    @flags.boolean({ description: 'No consumir el grupo aaa-cache en este proceso', default: false })
    declare sinAaaCache: boolean

    @flags.boolean({
        description: 'No atender los crons del núcleo (core-cron) en este proceso',
        default: false,
    })
    declare sinCrons: boolean

    @flags.string({ description: 'Ejecuta un solo cron del núcleo (planes_temporales) y termina' })
    declare unaVez?: string

    async run() {
        const { crearWorkerCore, ejecutarCronCore, programarCronsCore, NOMBRE_COLA_CORE } =
            await import('#core/jobs')
        if (this.unaVez) {
            this.logger.info(JSON.stringify(await ejecutarCronCore(this.unaVez)))
            await this.terminate()
            return
        }

        const { RelayOutbox } = await import('#shared/relay_outbox')
        const { EjecutorGrupo } = await import('#shared/eventos_bus')
        const { ConsumidorAaaCache } = await import('#core/consumidor_aaa')

        const relay = new RelayOutbox()
        relay.iniciar()
        this.logger.info(`eventos:relay publicando en ${relay.stream}`)

        const grupo = this.sinAaaCache
            ? null
            : new EjecutorGrupo({ grupo: 'aaa-cache', consumidores: [new ConsumidorAaaCache()] })
        if (grupo) {
            grupo.iniciar()
            this.logger.info(`eventos:relay consumiendo el grupo ${grupo.grupo}`)
        }

        const cola = this.sinCrons ? null : await programarCronsCore()
        const worker = this.sinCrons ? null : crearWorkerCore()
        if (worker) this.logger.info(`eventos:relay atendiendo la cola ${NOMBRE_COLA_CORE}`)

        const terminar = async () => {
            await Promise.all([relay.detener(), grupo?.detener(), worker?.close()])
            await cola?.close()
            await this.terminate()
        }
        process.once('SIGTERM', terminar)
        process.once('SIGINT', terminar)
    }
}
