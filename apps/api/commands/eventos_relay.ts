import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace eventos:relay`: publica `audit.outbox` en el stream `argos:eventos` (un solo relay
 * activo por lock en Redis) y consume el grupo `aaa-cache` (reescribe `aaa:user:*`).
 * Corre como proceso aparte. Lógica en `app/shared/relay_outbox.ts` y `app/shared/eventos_bus.ts`.
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

    async run() {
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

        const terminar = async () => {
            await Promise.all([relay.detener(), grupo?.detener()])
            await this.terminate()
        }
        process.once('SIGTERM', terminar)
        process.once('SIGINT', terminar)
    }
}
