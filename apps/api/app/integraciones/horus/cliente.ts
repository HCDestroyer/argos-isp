import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import { TABLA_SALUD, type ConfigHorus } from '#integraciones/horus/configuracion'

/**
 * Cliente HTTP de la API de Horus (`contratos/horus.md` §3): `Authorization: Bearer hf_pat_…`,
 * timeout corto y **espera exponencial** compartida por todos los procesos.
 *
 * - Un fallo transitorio (sin red, timeout, 5xx, 429) suma un fallo en `integraciones.horus_salud`
 *   y pausa las llamadas `15 s × 2^(fallos − 1)`, como mucho 15 min. Mientras dura la pausa no se
 *   llama: quien consulta muestra el último dato conocido marcado `stale` sin esperar.
 * - Una respuesta (aunque sea 4xx) prueba que Horus está vivo: reinicia los fallos.
 * - Nada crítico de Argos (AAA, facturación, corte, portal) llama aquí.
 */

/** Timeout de cada llamada a Horus. */
export const TIMEOUT_MS = 4000
/** Tope de la espera exponencial (contrato §0: máx. 15 min). */
export const PAUSA_MAXIMA_S = 900
/** Primera espera tras un fallo. */
export const PAUSA_INICIAL_S = 15

export type TipoErrorHorus = 'config' | 'pausa' | 'red' | 'timeout' | 'http'

export class ErrorHorus extends Error {
    constructor(
        message: string,
        readonly tipo: TipoErrorHorus,
        readonly status: number | null = null,
        readonly cuerpo: unknown = null,
    ) {
        super(message)
    }

    /** Horus no respondió o respondió con un error suyo: se reintenta con espera. */
    get transitorio(): boolean {
        return (
            this.tipo === 'red' ||
            this.tipo === 'timeout' ||
            this.tipo === 'pausa' ||
            (this.tipo === 'http' && this.status !== null && (this.status >= 500 || this.status === 429))
        )
    }
}

export interface SaludHorus {
    fallos_seguidos: number
    pausa_hasta: Date | null
    ultimo_error: string | null
    ultimo_error_en: Date | null
    ultimo_exito_en: Date | null
}

export async function leerSalud(): Promise<SaludHorus> {
    const fila = (await db
        .from(TABLA_SALUD)
        .where('id', 1)
        .select('fallos_seguidos', 'pausa_hasta', 'ultimo_error', 'ultimo_error_en', 'ultimo_exito_en')
        .first()) as SaludHorus | null
    return (
        fila ?? {
            fallos_seguidos: 0,
            pausa_hasta: null,
            ultimo_error: null,
            ultimo_error_en: null,
            ultimo_exito_en: null,
        }
    )
}

/** Suma un fallo y fija la pausa exponencial (la expresión usa los fallos de antes del UPDATE). */
export async function registrarFallo(error: string): Promise<void> {
    await db.rawQuery(
        `INSERT INTO ${TABLA_SALUD} AS s (id, fallos_seguidos, pausa_hasta, ultimo_error, ultimo_error_en)
         VALUES (1, 1, now() + make_interval(secs => ?::float8), ?, now())
         ON CONFLICT (id) DO UPDATE
            SET fallos_seguidos = s.fallos_seguidos + 1,
                pausa_hasta = now() + make_interval(
                    secs => least(?::float8, ?::float8 * power(2, s.fallos_seguidos))
                ),
                ultimo_error = EXCLUDED.ultimo_error,
                ultimo_error_en = now(),
                updated_at = now()`,
        [PAUSA_INICIAL_S, error.slice(0, 500), PAUSA_MAXIMA_S, PAUSA_INICIAL_S],
    )
}

/** Horus respondió: sin fallos ni pausa. Solo escribe si algo cambia o pasó un minuto. */
export async function registrarExito(): Promise<void> {
    await db.rawQuery(
        `UPDATE ${TABLA_SALUD}
            SET fallos_seguidos = 0, pausa_hasta = NULL, ultimo_exito_en = now(), updated_at = now()
          WHERE id = 1
            AND (fallos_seguidos > 0 OR pausa_hasta IS NOT NULL OR ultimo_exito_en IS NULL
                 OR ultimo_exito_en < now() - interval '1 minute')`,
    )
}

export interface RespuestaHorus<T> {
    status: number
    datos: T
}

/**
 * Llama a `config.urlBase + ruta` con el token del conector. Lanza `ErrorHorus` si no hay
 * configuración, si está en pausa (salvo `ignorarPausa`), si no responde o si responde fuera de
 * 2xx. No mira `activo`: eso lo decide quien llama (la prueba de conexión funciona apagado).
 */
export async function llamarHorus<T = unknown>(
    config: ConfigHorus,
    metodo: 'GET' | 'POST',
    ruta: string,
    cuerpo?: unknown,
    opciones: { ignorarPausa?: boolean; timeoutMs?: number } = {},
): Promise<RespuestaHorus<T>> {
    if (!config.urlBase || !config.token) {
        throw new ErrorHorus('El conector no tiene URL de Horus o código de conexión', 'config')
    }
    if (!opciones.ignorarPausa) {
        const salud = await leerSalud()
        if (salud.pausa_hasta && salud.pausa_hasta.getTime() > Date.now()) {
            throw new ErrorHorus(
                `Horus no respondió (${salud.ultimo_error ?? 'sin detalle'}); se reintenta después de ${salud.pausa_hasta.toISOString()}`,
                'pausa',
            )
        }
    }

    const url = `${config.urlBase}${ruta}`
    let respuesta: Response
    try {
        respuesta = await fetch(url, {
            method: metodo,
            headers: {
                authorization: `Bearer ${config.token}`,
                accept: 'application/json',
                ...(cuerpo === undefined ? {} : { 'content-type': 'application/json' }),
            },
            body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
            signal: AbortSignal.timeout(opciones.timeoutMs ?? TIMEOUT_MS),
            redirect: 'error',
        })
    } catch (error) {
        const nombre = (error as Error).name
        const fallo =
            nombre === 'TimeoutError' || nombre === 'AbortError'
                ? new ErrorHorus(`Horus no respondió en ${opciones.timeoutMs ?? TIMEOUT_MS} ms`, 'timeout')
                : new ErrorHorus(`No se pudo conectar con Horus: ${causa(error)}`, 'red')
        await registrarFallo(fallo.message)
        throw fallo
    }

    const texto = await respuesta.text().catch(() => '')
    let datos: unknown = null
    try {
        datos = texto ? JSON.parse(texto) : null
    } catch {
        datos = texto
    }
    if (respuesta.ok) {
        await registrarExito()
        return { status: respuesta.status, datos: datos as T }
    }

    const detalle = detalleError(datos) ?? respuesta.statusText
    const error = new ErrorHorus(
        `Horus respondió ${respuesta.status}${detalle ? `: ${detalle}` : ''}`,
        'http',
        respuesta.status,
        datos,
    )
    if (error.transitorio) await registrarFallo(error.message)
    else await registrarExito()
    logger.debug({ status: respuesta.status, ruta }, 'horus: respuesta de error')
    throw error
}

/** `ECONNREFUSED`, `ENOTFOUND`… o el mensaje del error. */
function causa(error: unknown): string {
    const origen = (error as { cause?: { code?: string; message?: string } }).cause
    return origen?.code ?? origen?.message ?? (error as Error).message ?? String(error)
}

/** Mensaje de un problem+json o `{ error }` / `{ message }` de Horus. */
function detalleError(datos: unknown): string | null {
    if (!datos || typeof datos !== 'object') {
        return typeof datos === 'string' && datos ? datos.slice(0, 300) : null
    }
    const d = datos as Record<string, unknown>
    for (const clave of ['detail', 'message', 'error', 'title']) {
        if (typeof d[clave] === 'string' && d[clave]) return String(d[clave]).slice(0, 300)
    }
    return null
}
