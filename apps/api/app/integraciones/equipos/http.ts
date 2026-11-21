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

export type TipoFallo = 'red' | 'timeout' | 'http'

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
    const origen = (error as { cause?: { code?: string; message?: string } }).cause
    return origen?.code ?? origen?.message ?? (error as Error).message ?? String(error)
}

function nombre(sistema: SistemaEquipos) {
    return sistema === 'smartolt' ? 'SmartOLT' : 'GenieACS'
}

/** Para pruebas: sin esperas entre reintentos. */
let esperaBaseMs = 500
export function fijarEsperaReintentos(ms: number) {
    esperaBaseMs = ms
}

/**
 * Hace la llamada con reintentos acotados. Lanza `ErrorEquipos` si no hubo respuesta o si fue
 * fuera de 2xx; si no, devuelve el cuerpo ya interpretado (JSON o texto).
 */
export async function llamar<T = unknown>(p: PeticionEquipos): Promise<RespuestaEquipos<T>> {
    const reintentos = Math.max(0, p.reintentos ?? 2)
    const timeoutMs = p.timeoutMs ?? 15_000
    let ultimo: ErrorEquipos | null = null
    for (let intento = 1; intento <= reintentos + 1; intento++) {
        if (intento > 1) await new Promise((r) => setTimeout(r, esperaBaseMs * 2 ** (intento - 2)))
        let respuesta: Response
        try {
            respuesta = await fetch(`${p.base}${p.ruta}`, {
                method: p.metodo,
                headers: { accept: 'application/json', ...(p.cabeceras ?? {}) },
                body: p.cuerpo,
                signal: AbortSignal.timeout(timeoutMs),
                redirect: 'error',
            })
        } catch (error) {
            const n = (error as Error).name
            ultimo =
                n === 'TimeoutError' || n === 'AbortError'
                    ? new ErrorEquipos(
                          `${nombre(p.sistema)} no respondió en ${timeoutMs} ms`,
                          p.sistema,
                          'timeout',
                      )
                    : new ErrorEquipos(
                          `No se pudo conectar con ${nombre(p.sistema)}: ${causa(error)}`,
                          p.sistema,
                          'red',
                      )
            await auditarRed(p, { error: ultimo.message }, false, intento)
            continue
        }
        const texto = await respuesta.text().catch(() => '')
        let datos: unknown = texto
        try {
            datos = texto ? JSON.parse(texto) : null
        } catch {
            datos = texto.slice(0, 1000)
        }
        const ok = respuesta.ok
        await auditarRed(
            p,
            { status: respuesta.status, status_text: respuesta.statusText, cuerpo: datos },
            ok,
            intento,
        )
        if (ok) return { status: respuesta.status, statusText: respuesta.statusText, datos: datos as T }
        ultimo = new ErrorEquipos(
            `${nombre(p.sistema)} respondió ${respuesta.status}${detalleDe(datos)}`,
            p.sistema,
            'http',
            respuesta.status,
            datos,
        )
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
