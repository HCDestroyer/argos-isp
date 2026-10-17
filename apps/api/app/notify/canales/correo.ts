import nodemailer, { type Transporter } from 'nodemailer'
import { ErrorCanal, type Canal, type EstadoEntrega, type ResultadoEnvio } from '#notify/canales/canal'

/** Remitente: `ArgosIsp <no-responder@dominio>` o nombre visible y dirección por separado. */
export type Remitente = string | { name: string; address: string }

export interface ConfigCorreo {
    host: string
    port: number
    /** TLS desde el inicio (465). Equivale a `tls: 'tls'`. */
    secure?: boolean
    /** modo TLS (`configuracion.ts`, `MODOS_TLS`); por defecto `auto` */
    tls?: 'auto' | 'starttls' | 'tls' | 'ninguno'
    user?: string
    password?: string
    remitente: Remitente
}

/**
 * Canal de correo por SMTP (nodemailer). El cuerpo es texto plano.
 * En desarrollo y pruebas el SMTP es Mailpit (`infra/docker-compose.yml`).
 */
export class CanalCorreo implements Canal {
    readonly nombre = 'correo' as const
    readonly #transporte: Transporter
    readonly #remitente: Remitente

    constructor(config: ConfigCorreo | { transporte: Transporter; remitente: Remitente }) {
        if ('transporte' in config) {
            this.#transporte = config.transporte
        } else {
            const tls = config.tls ?? (config.secure ? 'tls' : 'auto')
            this.#transporte = nodemailer.createTransport({
                host: config.host,
                port: config.port,
                secure: tls === 'tls',
                requireTLS: tls === 'starttls',
                ignoreTLS: tls === 'ninguno',
                auth: config.user ? { user: config.user, pass: config.password ?? '' } : undefined,
                connectionTimeout: 10_000,
                greetingTimeout: 10_000,
                socketTimeout: 20_000,
            })
        }
        this.#remitente = config.remitente
    }

    async enviar(destino: string, asunto: string | null, cuerpo: string): Promise<ResultadoEnvio> {
        try {
            const info = (await this.#transporte.sendMail({
                from: this.#remitente,
                to: destino,
                subject: asunto ?? '',
                text: cuerpo,
            })) as { messageId?: string; rejected?: unknown[] }
            if (Array.isArray(info.rejected) && info.rejected.length > 0) {
                throw new ErrorCanal('correo', `destino rechazado: ${destino}`, true)
            }
            return { id: info.messageId ?? '' }
        } catch (error) {
            if (error instanceof ErrorCanal) throw error
            const codigo = (error as { responseCode?: unknown }).responseCode
            // 5xx SMTP: rechazo definitivo (buzón inexistente, dominio inválido). 4xx y red: reintentar.
            const permanente = typeof codigo === 'number' && codigo >= 500
            const mensaje = error instanceof Error ? error.message : String(error)
            throw new ErrorCanal('correo', mensaje, permanente, { cause: error })
        }
    }

    async estado(_id: string): Promise<EstadoEntrega> {
        return 'enviado'
    }

    async cerrar() {
        this.#transporte.close()
    }
}
