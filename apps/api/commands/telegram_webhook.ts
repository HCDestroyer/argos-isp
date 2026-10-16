import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace telegram:webhook`: registra el webhook del bot en Telegram (`setWebhook` con
 * `TELEGRAM_WEBHOOK_SECRET`, solo actualizaciones `message`) y la lista de comandos en español.
 * `--info` muestra el estado sin cambiar nada; `--borrar` quita el webhook. Lógica en
 * `app/notify/telegram/webhook.ts`.
 */
export default class TelegramWebhook extends BaseCommand {
    static commandName = 'telegram:webhook'
    static description = 'Registra (o consulta, o borra) el webhook del bot de Telegram'

    static options: CommandOptions = { startApp: true }

    @flags.string({ description: 'URL pública del webhook (por defecto TELEGRAM_WEBHOOK_URL)' })
    declare url: string | undefined

    @flags.boolean({ description: 'Solo mostrar el estado del webhook (getWebhookInfo)', default: false })
    declare info: boolean

    @flags.boolean({ description: 'Quitar el webhook (deleteWebhook)', default: false })
    declare borrar: boolean

    async run() {
        const { borrarWebhook, infoWebhook, registrarWebhook } = await import('#notify/telegram/webhook')
        try {
            if (this.info) {
                const info = await infoWebhook()
                this.logger.info(
                    `url=${info.url || '(ninguna)'} pendientes=${info.pending_update_count}` +
                        (info.last_error_message ? ` ultimo_error="${info.last_error_message}"` : ''),
                )
                return
            }
            if (this.borrar) {
                await borrarWebhook()
                this.logger.success('Webhook de Telegram borrado')
                return
            }
            const resultado = await registrarWebhook({ url: this.url })
            this.logger.success(`Webhook registrado en ${resultado.url} (${resultado.comandos} comandos)`)
        } catch (error) {
            this.logger.error(error instanceof Error ? error.message : String(error))
            this.exitCode = 1
        }
    }
}
