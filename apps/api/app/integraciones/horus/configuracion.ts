import type { Redis } from 'ioredis'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { descifrar } from '#shared/cifrado'
import { nuevaConexionRedis, prefijoColas, redis } from '#shared/redis'

/**
 * Configuración del conector Horus (`integraciones.horus_conector`, una sola fila), editable
 * desde el panel (`integraciones.horus.configurar`). Contrato `contratos/horus.md`.
 *
 * - **Apagado por defecto.** Sin fila, o con `activo = false`, Argos no llama a Horus, no le envía
 *   webhooks y rechaza los que lleguen (503).
 * - **Caché por proceso, invalidada por evento (regla 5, sin TTL).** Se lee una vez con los
 *   secretos descifrados. Se invalida con `horus.config_cambiada` (grupo `horus` del bus, en
 *   `node ace horus:worker`) y con un aviso por Redis Pub/Sub (`<COLAS_PREFIJO>:horus:config`)
 *   para los demás procesos. Al reconectar el suscriptor también se invalida.
 * - Los secretos en claro nunca salen del proceso: la vista del panel los muestra como `***`.
 */

export const TABLA_CONECTOR = 'integraciones.horus_conector'
export const TABLA_SALUD = 'integraciones.horus_salud'

/** Fila de `integraciones.horus_conector`. */
export interface FilaConector {
    id: number
    activo: boolean
    url_base: string | null
    token_cifrado: string | null
    webhook_salida_url: string | null
    webhook_salida_secreto_cifrado: string | null
    webhook_entrada_secreto_cifrado: string | null
    conector_id: string
    token_argos_id: number | null
    conectado_por_enlace_en: Date | null
    ultima_prueba_en: Date | null
    ultima_prueba_ok: boolean | null
    ultima_prueba_error: string | null
    version: number
    created_at: Date
    updated_at: Date
}

/** Configuración efectiva con los secretos en claro. Nunca sale del proceso (ni al log). */
export interface ConfigHorus {
    activo: boolean
    /** sin `/` final; p. ej. `https://horus.isp.example` */
    urlBase: string | null
    token: string | null
    webhookSalidaUrl: string | null
    webhookSalidaSecreto: string | null
    webhookEntradaSecreto: string | null
    version: number
    /** secretos guardados que no se pudieron descifrar (cambió `AAA_PPP_KEY`) */
    erroresCifrado: string[]
}

export const CONFIG_APAGADA: ConfigHorus = Object.freeze({
    activo: false,
    urlBase: null,
    token: null,
    webhookSalidaUrl: null,
    webhookSalidaSecreto: null,
    webhookEntradaSecreto: null,
    version: 0,
    erroresCifrado: [],
}) as ConfigHorus

function descifrarCampo(valor: string | null, campo: string, errores: string[]): string | null {
    if (valor === null) return null
    try {
        return descifrar(valor)
    } catch {
        errores.push(campo)
        return null
    }
}

export function desdeFila(fila: FilaConector | null): ConfigHorus {
    if (!fila) return CONFIG_APAGADA
    const errores: string[] = []
    const config: ConfigHorus = {
        activo: fila.activo,
        urlBase: fila.url_base ? fila.url_base.replace(/\/+$/, '') : null,
        token: descifrarCampo(fila.token_cifrado, 'token', errores),
        webhookSalidaUrl: fila.webhook_salida_url,
        webhookSalidaSecreto: descifrarCampo(
            fila.webhook_salida_secreto_cifrado,
            'webhook_salida_secreto',
            errores,
        ),
        webhookEntradaSecreto: descifrarCampo(
            fila.webhook_entrada_secreto_cifrado,
            'webhook_entrada_secreto',
            errores,
        ),
        version: fila.version,
        erroresCifrado: errores,
    }
    if (errores.length > 0) {
        logger.error(
            { campos: errores },
            'horus: no se pudieron descifrar secretos del conector (¿cambió AAA_PPP_KEY?)',
        )
    }
    return config
}

export async function leerFila(cliente: QueryClientContract = db.connection()): Promise<FilaConector | null> {
    return ((await cliente.from(TABLA_CONECTOR).where('id', 1).first()) as FilaConector | null) ?? null
}

/**
 * `http://` solo con `HORUS_PERMITIR_HTTP=true` (flag de laboratorio; se lee en cada llamada
 * para que las pruebas lo cambien sin reiniciar). En producción, solo `https://`.
 */
export function permiteHttp(): boolean {
    const valor = process.env.HORUS_PERMITIR_HTTP
    return valor === 'true' || valor === '1'
}

/** Mensaje de error si la URL no sirve para hablar con Horus; null si está bien. */
export function errorUrl(valor: string): string | null {
    let url: URL
    try {
        url = new URL(valor)
    } catch {
        return 'No es una URL válida'
    }
    if (url.protocol === 'https:') return null
    if (url.protocol === 'http:' && permiteHttp()) return null
    if (url.protocol === 'http:') return 'Solo https:// (http:// solo en laboratorio con HORUS_PERMITIR_HTTP)'
    return 'Solo https://'
}

// ── Caché ────────────────────────────────────────────────────────────────────────────────────

let actual: ConfigHorus | null = null
let carga: Promise<ConfigHorus> | null = null
let generacion = 0

async function cargar(): Promise<ConfigHorus> {
    // Si se invalidó mientras se leía, se vuelve a leer: nunca se guarda una lectura vieja.
    for (;;) {
        const vista = generacion
        const config = desdeFila(await leerFila())
        if (vista === generacion) {
            actual = config
            return config
        }
    }
}

/** Configuración vigente (se lee de la base la primera vez y tras cada invalidación). */
export function configHorus(): Promise<ConfigHorus> {
    if (actual) return Promise.resolve(actual)
    carga ??= cargar().finally(() => {
        carga = null
    })
    return carga
}

/** Descarta la caché de este proceso; la próxima lectura va a la base. */
export function invalidarConfigHorus(): void {
    generacion++
    actual = null
}

export function canalInvalidacion(): string {
    return `${prefijoColas()}:horus:config`
}

/** Avisa a los demás procesos que relean. Si Redis falla queda en el log (el evento llega igual). */
export async function publicarInvalidacionHorus(): Promise<void> {
    try {
        await redis().publish(canalInvalidacion(), String(Date.now()))
    } catch (error) {
        logger.warn({ err: error }, 'horus: no se pudo publicar la invalidación de la configuración')
    }
}

let suscriptor: Redis | null = null

/** Suscribe este proceso a las invalidaciones de los demás. Idempotente. */
export async function escucharInvalidacionesHorus(): Promise<void> {
    if (suscriptor) return
    const conexion = nuevaConexionRedis({ maxRetriesPerRequest: null })
    suscriptor = conexion
    let primera = true
    conexion.on('ready', () => {
        if (primera) {
            primera = false
            return
        }
        // un aviso publicado mientras estaba desconectado se pierde: se relee
        invalidarConfigHorus()
    })
    conexion.on('message', (canal: string) => {
        if (canal === canalInvalidacion()) invalidarConfigHorus()
    })
    try {
        await conexion.subscribe(canalInvalidacion())
    } catch (error) {
        logger.warn({ err: error }, 'horus: no se pudo suscribir a las invalidaciones de configuración')
    }
}

export async function dejarDeEscucharHorus(): Promise<void> {
    const conexion = suscriptor
    suscriptor = null
    if (!conexion) return
    try {
        await conexion.quit()
    } catch {
        conexion.disconnect()
    }
}
