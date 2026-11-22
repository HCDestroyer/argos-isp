import { request as solicitudHttp } from 'node:http'
import { request as solicitudHttps } from 'node:https'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'

/**
 * Cliente HTTP común de SmartOLT y GenieACS: timeout por llamada, reintentos acotados solo en
 * fallos transitorios y **cada llamada en `audit.red`** (tipo `smartolt` o `genieacs`) con la
 * respuesta del equipo, sin secretos.
 *
 * - El registro en `audit.red` se escribe fuera de la transacción de la acción: la llamada ya
 *   ocurrió aunque la acción se revierta (igual que `bitacoraRed` de RouterOS).
 * - Sin secretos: el comando guarda método, ruta sin credenciales y el cuerpo con
 *   `limpiarSecretos` (contraseñas, claves, tokens y la clave Wi-Fi como `***`); la respuesta,
 *   limpia igual y recortada. Nunca se guardan cabeceras (`X-Token`, `Authorization`).
 * - Reintentos: red, timeout, 5xx y 429, con espera 0,5 s × 2^n. Una escritura que no se puede
 *   repetir sin riesgo (autorizar una ONU) se llama con `reintentos: 0`.
 */

export type SistemaEquipos = 'smartolt' | 'genieacs'

export type TipoFallo = 'red' | 'timeout' | 'http' | 'tls'

export class ErrorEquipos extends Error {
    constructor(
        message: string,
        readonly sistema: SistemaEquipos,
        readonly tipo: TipoFallo,
        readonly status: number | null = null,
        readonly datos: unknown = null,
    ) {
        super(message)
    }

    /** El sistema no respondió o respondió con un error suyo: tiene sentido reintentar. */
    get transitorio(): boolean {
        if (this.tipo === 'tls') return false
        return this.tipo !== 'http' || (this.status !== null && (this.status >= 500 || this.status === 429))
    }
}

export interface PeticionEquipos {
    sistema: SistemaEquipos
    metodo: 'GET' | 'POST' | 'PUT' | 'DELETE'
    /** origen ya normalizado, sin barra final */
    base: string
    /** ruta con su consulta; se guarda tal cual en `audit.red` (nunca lleva secretos) */
    ruta: string
    cabeceras?: Record<string, string>
    /** cuerpo ya serializado */
    cuerpo?: string
    /** cuerpo para la auditoría (se limpia de secretos) */
    cuerpoAuditado?: unknown
    servicioId?: number | null
    /** autoridad propia en PEM para validar el certificado (además de las del sistema) */
    ca?: string | null
    timeoutMs?: number
    reintentos?: number
}

export interface RespuestaEquipos<T = unknown> {
    status: number
    statusText: string
    datos: T
}

const CLAVES_SECRETAS = /(password|passphrase|presharedkey|secret|token|clave|psk|key_?passphrase)/i
const MAX_RESPUESTA = 6000

/** Reemplaza por `***` el valor de toda clave que parezca secreta, en cualquier profundidad. */
export function limpiarSecretos(valor: unknown, profundidad = 0): unknown {
    if (profundidad > 12) return '…'
    if (Array.isArray(valor)) {
        // setParameterValues de GenieACS: [ruta, valor, tipo]
        if (
            typeof valor[0] === 'string' &&
            valor.length >= 2 &&
            valor.length <= 3 &&
            CLAVES_SECRETAS.test(valor[0])
        ) {
            return [valor[0], '***', ...valor.slice(2)]
        }
        return valor.map((v) => limpiarSecretos(v, profundidad + 1))
    }
    if (valor && typeof valor === 'object') {
        const salida: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
            salida[k] =
                CLAVES_SECRETAS.test(k) && v !== null && v !== ''
                    ? '***'
                    : limpiarSecretos(v, profundidad + 1)
        }
        return salida
    }
    return valor
}

function recortar(valor: unknown): unknown {
    const texto = JSON.stringify(valor ?? null)
    if (texto.length <= MAX_RESPUESTA) return valor
    return { recortado: true, bytes: texto.length, inicio: texto.slice(0, 500) }
}

async function auditarRed(p: PeticionEquipos, respuesta: unknown, ok: boolean, intento: number) {
    try {
        await db.table('audit.red').insert({
            tipo: p.sistema,
            router_id: null,
            servicio_id: p.servicioId ?? null,
            comando: JSON.stringify({
                sistema: p.sistema,
                metodo: p.metodo,
                ruta: p.ruta,
                cuerpo: p.cuerpoAuditado === undefined ? null : limpiarSecretos(p.cuerpoAuditado),
                intento,
            }),
            respuesta: JSON.stringify(recortar(limpiarSecretos(respuesta))),
            ok,
        })
    } catch (error) {
        logger.error({ err: error, sistema: p.sistema }, 'equipos: no se pudo escribir audit.red')
    }
}

/** `ECONNREFUSED`, `ENOTFOUND`… o el mensaje del error. */
function causa(error: unknown): string {
    const e = error as { code?: string; cause?: { code?: string; message?: string }; message?: string }
    return e.code ?? e.cause?.code ?? e.cause?.message ?? e.message ?? String(error)
}

function nombre(sistema: SistemaEquipos) {
    return sistema === 'smartolt' ? 'SmartOLT' : 'GenieACS'
}

/** Códigos de OpenSSL/Node de un certificado que no se puede confiar. */
const ERRORES_TLS: Record<string, string> = {
    DEPTH_ZERO_SELF_SIGNED_CERT: 'es autofirmado',
    SELF_SIGNED_CERT_IN_CHAIN: 'lo firma una autoridad que Argos no conoce',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'no se pudo verificar quién lo firmó',
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'no se pudo verificar quién lo firmó',
    CERT_HAS_EXPIRED: 'está vencido',
    CERT_NOT_YET_VALID: 'todavía no es válido (revisa la hora del servidor)',
    ERR_TLS_CERT_ALTNAME_INVALID: 'no es del nombre de la URL',
}

function mensajeTls(sistema: SistemaEquipos, codigo: string): string {
    return (
        `El certificado HTTPS de ${nombre(sistema)} no es válido: ${ERRORES_TLS[codigo]} (${codigo}). ` +
        'Usa un certificado válido para ese nombre (p. ej. Let’s Encrypt) o, si es de una autoridad propia, ' +
        'pega su certificado raíz en la configuración'
    )
}

/** Para pruebas: sin esperas entre reintentos. */
let esperaBaseMs = 500
export function fijarEsperaReintentos(ms: number) {
    esperaBaseMs = ms
}

interface RespuestaCruda {
    status: number
    statusText: string
    texto: string
}

/**
 * Una petición con `node:http(s)`: permite confiar en una autoridad propia (`ca`, PEM) sin tocar la
 * del proceso, no sigue redirecciones y corta a los `timeoutMs`.
 */
function enviar(p: PeticionEquipos, timeoutMs: number): Promise<RespuestaCruda> {
    const url = new URL(`${p.base}${p.ruta}`)
    const cabeceras: Record<string, string> = { accept: 'application/json', ...(p.cabeceras ?? {}) }
    if (p.cuerpo !== undefined) cabeceras['content-length'] = String(Buffer.byteLength(p.cuerpo))
    const opciones = { method: p.metodo, headers: cabeceras, ...(p.ca ? { ca: p.ca } : {}) }
    return new Promise((resolver, rechazar) => {
        const req = (url.protocol === 'https:' ? solicitudHttps : solicitudHttp)(url, opciones, (res) => {
            const partes: Buffer[] = []
            res.on('data', (c: Buffer) => partes.push(c))
            res.on('end', () =>
                resolver({
                    status: res.statusCode ?? 0,
                    statusText: res.statusMessage ?? '',
                    texto: Buffer.concat(partes).toString('utf8'),
                }),
            )
            res.on('error', rechazar)
        })
        req.setTimeout(timeoutMs, () =>
            req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT_EQUIPOS' })),
        )
        req.on('error', rechazar)
        if (p.cuerpo !== undefined) req.write(p.cuerpo)
        req.end()
    })
}

/**
 * Hace la llamada con reintentos acotados. Lanza `ErrorEquipos` si no hubo respuesta o si fue
 * fuera de 2xx; si no, devuelve el cuerpo ya interpretado (JSON o texto). Errores con texto claro
 * para la persona: certificado inválido (no se reintenta), credenciales rechazadas (401) o acceso
 * negado por el proxy (403).
 */
export async function llamar<T = unknown>(p: PeticionEquipos): Promise<RespuestaEquipos<T>> {
    const reintentos = Math.max(0, p.reintentos ?? 2)
    const timeoutMs = p.timeoutMs ?? 15_000
    let ultimo: ErrorEquipos | null = null
    for (let intento = 1; intento <= reintentos + 1; intento++) {
        if (intento > 1) await new Promise((r) => setTimeout(r, esperaBaseMs * 2 ** (intento - 2)))
        let respuesta: RespuestaCruda
        try {
            respuesta = await enviar(p, timeoutMs)
        } catch (error) {
            const codigo = causa(error)
            if (codigo in ERRORES_TLS) {
                ultimo = new ErrorEquipos(mensajeTls(p.sistema, codigo), p.sistema, 'tls')
                await auditarRed(p, { error: ultimo.message }, false, intento)
                throw ultimo
            }
            ultimo =
                codigo === 'ETIMEDOUT_EQUIPOS'
                    ? new ErrorEquipos(
                          `${nombre(p.sistema)} no respondió en ${timeoutMs} ms`,
                          p.sistema,
                          'timeout',
                      )
                    : new ErrorEquipos(
                          `No se pudo conectar con ${nombre(p.sistema)}: ${codigo}`,
                          p.sistema,
                          'red',
                      )
            await auditarRed(p, { error: ultimo.message }, false, intento)
            continue
        }
        let datos: unknown = respuesta.texto
        try {
            datos = respuesta.texto ? JSON.parse(respuesta.texto) : null
        } catch {
            datos = respuesta.texto.slice(0, 1000)
        }
        const ok = respuesta.status >= 200 && respuesta.status < 300
        await auditarRed(
            p,
            { status: respuesta.status, status_text: respuesta.statusText, cuerpo: datos },
            ok,
            intento,
        )
        if (ok) return { status: respuesta.status, statusText: respuesta.statusText, datos: datos as T }
        const mensaje =
            respuesta.status === 401
                ? `${nombre(p.sistema)} rechazó el usuario o la clave (401): revísalos en la configuración`
                : respuesta.status === 403 && p.sistema === 'genieacs'
                  ? 'GenieACS negó el acceso (403): la IP de Argos no está permitida en el proxy del ACS'
                  : `${nombre(p.sistema)} respondió ${respuesta.status}${detalleDe(datos)}`
        ultimo = new ErrorEquipos(mensaje, p.sistema, 'http', respuesta.status, datos)
        if (!ultimo.transitorio) throw ultimo
    }
    throw ultimo!
}

/** `: <mensaje>` de un error de SmartOLT (`error`) o de GenieACS (texto). */
function detalleDe(datos: unknown): string {
    if (typeof datos === 'string' && datos) return `: ${datos.slice(0, 200)}`
    if (datos && typeof datos === 'object') {
        const d = datos as Record<string, unknown>
        for (const k of ['error', 'message', 'response']) {
            if (typeof d[k] === 'string' && d[k]) return `: ${String(d[k]).slice(0, 200)}`
        }
    }
    return ''
}
