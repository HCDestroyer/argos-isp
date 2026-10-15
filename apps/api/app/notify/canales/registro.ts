import env from '#start/env'
import type { CanalNotificacion } from '#shared/eventos'
import type { Canal } from '#notify/canales/canal'
import { CanalCorreo } from '#notify/canales/correo'
import { CanalTelegram } from '#notify/canales/telegram'

/**
 * Registro de canales disponibles. Se arma una vez desde el entorno:
 *  - correo si hay `SMTP_HOST`
 *  - telegram si hay `TELEGRAM_BOT_TOKEN`
 *  - whatsapp: sin adaptador todavía (los clientes con esa preferencia caen a correo)
 *
 * Las pruebas reemplazan canales con `registrarCanal` y vuelven al entorno con `reiniciarCanales`.
 */
let canales: Map<CanalNotificacion, Canal> | undefined

function desdeEntorno(): Map<CanalNotificacion, Canal> {
    const mapa = new Map<CanalNotificacion, Canal>()
    const host = env.get('SMTP_HOST')
    if (host) {
        mapa.set(
            'correo',
            new CanalCorreo({
                host,
                port: env.get('SMTP_PORT') ?? 1025,
                secure: env.get('SMTP_SECURE') ?? false,
                user: env.get('SMTP_USER') || undefined,
                password: env.get('SMTP_PASSWORD') || undefined,
                remitente: env.get('MAIL_FROM') ?? 'ArgosIsp <no-responder@argosisp.local>',
            }),
        )
    }
    const token = env.get('TELEGRAM_BOT_TOKEN')
    if (token) {
        mapa.set('telegram', new CanalTelegram({ token, apiRoot: env.get('TELEGRAM_API_ROOT') || undefined }))
    }
    return mapa
}

function registro(): Map<CanalNotificacion, Canal> {
    canales ??= desdeEntorno()
    return canales
}

export function obtenerCanal(nombre: CanalNotificacion): Canal | undefined {
    return registro().get(nombre)
}

export function canalDisponible(nombre: CanalNotificacion): boolean {
    return registro().has(nombre)
}

/** Reemplaza (o quita, con `null`) un canal. Para pruebas y para el arranque del worker. */
export function registrarCanal(nombre: CanalNotificacion, canal: Canal | null) {
    if (canal) registro().set(nombre, canal)
    else registro().delete(nombre)
}

/** Vuelve a construir los canales desde el entorno en el próximo uso. */
export function reiniciarCanales() {
    canales = undefined
}
