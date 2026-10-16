import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace aaa:vigilar`: health check de los nodos `aaa` (`AAA_SALUD_NODOS`). Si un nodo no responde
 * durante `AAA_CAIDO_TRAS_MS` (60 s) emite `aaa.caido` por outbox; al volver, `aaa.recuperado`.
 * A6 los manda por Telegram. Un solo vigía activo (lock en Redis); se pueden correr varios.
 * Lógica en `app/network/sesiones/vigia_aaa.ts`.
 */
export default class AaaVigilar extends BaseCommand {
    static commandName = 'aaa:vigilar'
    static description = 'Health check de los nodos aaa: emite aaa.caido y aaa.recuperado'

    static options: CommandOptions = {
        startApp: true,
        staysAlive: true,
    }

    @flags.string({ description: 'Nodos `nombre=url` separados por coma (por defecto AAA_SALUD_NODOS)' })
    declare nodos?: string

    async run() {
        const { default: env } = await import('#start/env')
        const { parsearNodos, VigiaAaa } = await import('#network/sesiones/vigia_aaa')
        const nodos = parsearNodos(this.nodos ?? env.get('AAA_SALUD_NODOS') ?? 'aaa=http://127.0.0.1:3100')
        const vigia = new VigiaAaa({
            nodos,
            caidoTrasMs: env.get('AAA_CAIDO_TRAS_MS') ?? 60_000,
            cadaMs: env.get('AAA_SALUD_CADA_MS') ?? 5000,
        })
        vigia.iniciar()
        this.logger.info(`aaa:vigilar: ${nodos.map((n) => `${n.nombre} (${n.url})`).join(', ')}`)

        const terminar = async () => {
            await vigia.detener()
            await this.terminate()
        }
        process.once('SIGTERM', terminar)
        process.once('SIGINT', terminar)
    }
}
