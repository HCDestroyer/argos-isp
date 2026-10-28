import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import { descifrar } from '#shared/cifrado'
import { MASCARA } from '#shared/enmascarar'
import { ConflictoVersion } from '#shared/errores'
import { urlPublicaApi } from '#integraciones/horus/panel'

/**
 * Configuración del conector Iris (`integraciones.iris_conector`, una sola fila), editable desde el
 * panel (`iris.configurar`). Contrato `contratos/iris.md` §1 (mismo patrón que Horus §1).
 *
 * - **Apagado por defecto.** Sin fila, o con `activo = false`, Argos no llama a Iris, no le envía
 *   webhooks y no acepta tickets de autologin de un conector preparado con enlace.
 * - **Sin caché.** Se lee de la base en cada uso (pocas llamadas: "Ver en Iris", envíos de
 *   webhooks), así no hay nada que invalidar (regla 5).
 * - Los secretos en claro nunca salen del proceso: la vista del panel los muestra como `***`.
 */

export const TABLA_CONECTOR_IRIS = 'integraciones.iris_conector'
/** Receptor de webhooks Iris → Argos (reservado: el contrato 0.2.0 aún no define eventos de Iris). */
export const RUTA_RECEPTOR_IRIS = '/api/v1/integraciones/iris/webhook'
/** Formato del token de Iris para Argos (§1.2): `iris_pat_<32B base62>`. */
export const FORMATO_TOKEN_IRIS = /^iris_pat_[A-Za-z0-9]{16,}$/

export interface FilaConectorIris {
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
    version: number
    created_at: Date
    updated_at: Date
}

/** Configuración efectiva con los secretos en claro. Nunca sale del proceso (ni al log). */
export interface ConfigIris {
    activo: boolean
    /** origen de la API de Iris, sin `/` final ni `/api/v1` */
    urlBase: string | null
    token: string | null
    webhookSalidaUrl: string | null
    webhookSalidaSecreto: string | null
    conectorId: string | null
}

export async function leerFilaIris(
    cliente: QueryClientContract = db.connection(),
): Promise<FilaConectorIris | null> {
    return (
        ((await cliente.from(TABLA_CONECTOR_IRIS).where('id', 1).first()) as FilaConectorIris | null) ?? null
    )
}

function descifrarCampo(valor: string | null, campo: string): string | null {
    if (valor === null) return null
    try {
        return descifrar(valor)
    } catch {
        logger.error({ campo }, 'iris: no se pudo descifrar un secreto del conector (¿cambió AAA_PPP_KEY?)')
        return null
    }
}

/** Configuración vigente leída de la base (sin caché). */
export async function configIris(cliente: QueryClientContract = db.connection()): Promise<ConfigIris> {
    const fila = await leerFilaIris(cliente)
    return {
        activo: fila?.activo ?? false,
        urlBase: fila?.url_base ?? null,
        token: fila ? descifrarCampo(fila.token_cifrado, 'token') : null,
        webhookSalidaUrl: fila?.webhook_salida_url ?? null,
        webhookSalidaSecreto: fila
            ? descifrarCampo(fila.webhook_salida_secreto_cifrado, 'webhook_salida_secreto')
            : null,
        conectorId: fila?.conector_id ?? null,
    }
}

/**
 * Interfaz para A6 (webhooks salientes Argos → Iris, contrato Iris §2.3): URL del receptor de Iris,
 * secreto con que se firma (HMAC `v1=`, `cabecerasFirmadas` de `#integraciones/horus/firma`) y el
 * id del conector. null si el conector está apagado o le falta el receptor: no se envía nada.
 */
export interface DestinoWebhooksIris {
    url: string
    secreto: string
    conector_id: string
}

export async function destinoWebhooksIris(
    cliente: QueryClientContract = db.connection(),
): Promise<DestinoWebhooksIris | null> {
    const config = await configIris(cliente)
    if (!config.activo || !config.webhookSalidaUrl || !config.webhookSalidaSecreto || !config.conectorId) {
        return null
    }
    return {
        url: config.webhookSalidaUrl,
        secreto: config.webhookSalidaSecreto,
        conector_id: config.conectorId,
    }
}

/**
 * `http://` solo con `IRIS_PERMITIR_HTTP=true` (laboratorio; se lee en cada llamada para que las
 * pruebas lo cambien sin reiniciar). En producción, solo `https://`.
 */
export function permiteHttpIris(): boolean {
    const valor = process.env.IRIS_PERMITIR_HTTP
    return valor === 'true' || valor === '1'
}

/** Mensaje de error si la URL no sirve para hablar con Iris; null si está bien. */
export function errorUrlIris(valor: string): string | null {
    let url: URL
    try {
        url = new URL(valor)
    } catch {
        return 'No es una URL válida'
    }
    if (url.protocol === 'https:') return null
    if (url.protocol === 'http:' && permiteHttpIris()) return null
    if (url.protocol === 'http:') return 'Solo https:// (http:// solo en laboratorio con IRIS_PERMITIR_HTTP)'
    return 'Solo https://'
}

/**
 * Origen de la API de Iris (`https://host[:puerto]`), sin ruta, consulta, fragmento ni credenciales.
 * Se tolera que venga con `/api/v1` (o una `/` final), que se quita.
 */
export function origenIris(valor: string): { origen: string; error: null } | { origen: null; error: string } {
    const error = errorUrlIris(valor)
    if (error) return { origen: null, error }
    const url = new URL(valor)
    if (url.username || url.password) return { origen: null, error: 'La URL no lleva usuario ni contraseña' }
    if (url.search || url.hash) return { origen: null, error: 'La URL no lleva consulta ni fragmento' }
    const ruta = url.pathname.replace(/\/+$/, '')
    if (ruta !== '' && ruta !== '/api/v1') {
        return { origen: null, error: 'Se espera el origen de Iris (https://host[:puerto]), sin ruta' }
    }
    return { origen: url.origin, error: null }
}

// ── Escritura ────────────────────────────────────────────────────────────────────────────────

/** Bloquea la fila del conector (candado + FOR UPDATE) para configurar o canjear. */
export async function bloquearConectorIris(t: Transaccion): Promise<FilaConectorIris | null> {
    await t.trx.rawQuery('SELECT pg_advisory_xact_lock(hashtext(?))', ['integraciones:iris:conector'])
    return (
        ((await t.trx
            .from(TABLA_CONECTOR_IRIS)
            .where('id', 1)
            .forUpdate()
            .first()) as FilaConectorIris | null) ?? null
    )
}

/**
 * Guarda cambios en la fila (la crea si no existe), con control de `version` si se pide y diff en
 * `audit.cambios` (secretos como `***`). La configuración es de la instalación, no de una empresa.
 */
export async function guardarConectorIris(
    t: Transaccion,
    antes: FilaConectorIris | null,
    cambios: Record<string, unknown>,
    opciones: { version?: number } = {},
): Promise<FilaConectorIris> {
    if (opciones.version !== undefined && (antes?.version ?? 0) !== opciones.version) {
        throw new ConflictoVersion(TABLA_CONECTOR_IRIS, 1)
    }
    let despues: FilaConectorIris
    if (antes) {
        const [fila] = (await t.trx
            .from(TABLA_CONECTOR_IRIS)
            .where('id', 1)
            .update(
                {
                    ...cambios,
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                },
                ['*'],
            )) as FilaConectorIris[]
        despues = fila!
    } else {
        const [fila] = (await t.trx
            .table(TABLA_CONECTOR_IRIS)
            .insert({ id: 1, ...cambios })
            .returning('*')) as FilaConectorIris[]
        despues = fila!
    }
    t.fijarEntidad('conector_iris', 1)
    t.fijarEmpresa(null)
    await t.registrarCambios({ tipo: 'conector_iris', id: 1 }, antes, despues)
    return despues
}

// ── Vista del panel ──────────────────────────────────────────────────────────────────────────

export interface VistaConectorIris {
    activo: boolean
    url_base: string | null
    token: '***' | null
    webhook_salida_url: string | null
    webhook_salida_secreto: '***' | null
    webhook_entrada_url: string | null
    webhook_entrada_secreto: '***' | null
    conector_id: string | null
    conectado_por_enlace_en: string | null
    token_argos_id: number | null
    version: number
}

function mascara(valor: string | null | undefined): '***' | null {
    return valor ? (MASCARA as '***') : null
}

export function vistaConectorIris(fila: FilaConectorIris | null): VistaConectorIris {
    const base = urlPublicaApi()
    return {
        activo: fila?.activo ?? false,
        url_base: fila?.url_base ?? null,
        token: mascara(fila?.token_cifrado),
        webhook_salida_url: fila?.webhook_salida_url ?? null,
        webhook_salida_secreto: mascara(fila?.webhook_salida_secreto_cifrado),
        webhook_entrada_url: base ? `${base}${RUTA_RECEPTOR_IRIS}` : null,
        webhook_entrada_secreto: mascara(fila?.webhook_entrada_secreto_cifrado),
        conector_id: fila?.conector_id ?? null,
        conectado_por_enlace_en: fila?.conectado_por_enlace_en
            ? new Date(fila.conectado_por_enlace_en).toISOString()
            : null,
        token_argos_id:
            fila?.token_argos_id === null || fila?.token_argos_id === undefined
                ? null
                : Number(fila.token_argos_id),
        version: fila?.version ?? 0,
    }
}

export async function verConectorIris(): Promise<VistaConectorIris> {
    return vistaConectorIris(await leerFilaIris())
}

/** Para quien solo tiene `iris.abrir`: si "Ver en Iris" puede funcionar. Sin URL ni secretos. */
export async function estadoConectorIris(): Promise<{ activo: boolean }> {
    const config = await configIris()
    return { activo: config.activo && Boolean(config.urlBase && config.token) }
}
