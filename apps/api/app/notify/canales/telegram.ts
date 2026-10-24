import { Api, GrammyError } from 'grammy'
import { ErrorCanal, type Canal, type EstadoEntrega, type ResultadoEnvio } from '#notify/canales/canal'

export interface ConfigTelegram {
    token: string
    /** raíz de la Bot API; por defecto https://api.telegram.org */
    apiRoot?: string
    /** `fetch` a usar (las pruebas pasan uno simulado) */
    fetch?: typeof fetch
}

/** Límite de Telegram para el texto de un mensaje. */
export const MAXIMO_TEXTO = 4096

/**
 * Canal de Telegram (grammY, solo la Bot API, sin polling). El destino es el `chat_id`
 * (`core.clientes.telegram_chat_id` o el chat del equipo para alertas). Texto plano: sin
 * `parse_mode`, así los datos del cliente no se interpretan como Markdown/HTML.
 */
export class CanalTelegram implements Canal {
    readonly nombre = 'telegram' as const
    readonly #api: Api

    constructor(config: ConfigTelegram) {
        this.#api = new Api(config.token, {
            apiRoot: config.apiRoot,
            fetch: config.fetch,
            timeoutSeconds: 20,
        })
    }

    async enviar(destino: string, asunto: string | null, cuerpo: string): Promise<ResultadoEnvio> {
        const texto = (asunto ? `${asunto}\n\n${cuerpo}` : cuerpo).slice(0, MAXIMO_TEXTO)
        try {
            const mensaje = await this.#api.sendMessage(destino, texto, {
                link_preview_options: { is_disabled: true },
            })
            return { id: `${mensaje.chat.id}:${mensaje.message_id}` }
        } catch (error) {
            if (error instanceof GrammyError) {
                // 400 (chat inexistente) y 403 (bot bloqueado) no se arreglan reintentando; 429 y 5xx sí.
                const permanente = error.error_code === 400 || error.error_code === 403
                throw new ErrorCanal('telegram', `${error.error_code} ${error.description}`, permanente, {
                    cause: error,
                })
            }
            const mensaje = error instanceof Error ? error.message : String(error)
            throw new ErrorCanal('telegram', mensaje, false, { cause: error })
        }
    }

    async estado(_id: string): Promise<EstadoEntrega> {
        return 'enviado'
    }
}
