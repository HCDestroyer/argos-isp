import { ErrorEquipos, llamar, type RespuestaEquipos } from '#integraciones/equipos/http'
import type { ConfigSmartOlt } from '#integraciones/equipos/configuracion'

/**
 * Adaptador de la API REST de SmartOLT. Cada ruta sale de la especificación oficial
 * (`https://www.smartolt.com/openapi.json`, OpenAPI 3.0.3 «SmartOLT API 1.0», enlazada desde
 * `https://api.smartolt.com`): base `https://<subdominio>.smartolt.com`, cabecera `X-Token`, cuerpos
 * `application/x-www-form-urlencoded` y respuestas `{ status, response | error, error_code }`.
 *
 * | Uso en Argos | Ruta de SmartOLT |
 * | --- | --- |
 * | Probar conexión (manual, no como latido) | `GET /api/system/get_olts` |
 * | Buscar la ONU sin autorizar por serie | `GET /api/onu/unconfigured_onus?sn=` |
 * | ¿La serie ya está autorizada? (idempotencia, en uso) | `GET /api/onu/get_onus_details_by_sn/{sn}` |
 * | Autorizar con un perfil (preset) | `POST /api/onu/authorize_onu` |
 * | Estado en vivo (A33) | `GET /api/onu/get_onu_status/{onu_external_id}` |
 * | Señal (A33) | `GET /api/onu/get_onu_signal/{onu_external_id}` |
 * | Modelo y SSID (A33) | `GET /api/onu/get_onu_details/{onu_external_id}` |
 *
 * SmartOLT pide no usar las lecturas de una ONU en sondeos: Argos solo lee a pedido (A33, con la
 * lectura de menos de 60 s guardada) y al aprovisionar. Límite documentado: 1000 llamadas por hora y
 * 15 por segundo (429 con `retry_after`).
 */

/** El id externo de la ONU que pone Argos: solo alfanumérico (lo exige SmartOLT). */
export function idExternoOnu(servicioId: number): string {
    return `argos${servicioId}`
}

/** Autorizar en línea tarda «decenas de segundos» según la documentación. */
export const TIMEOUT_AUTORIZAR_MS = Number(process.env.SMARTOLT_TIMEOUT_AUTORIZAR_MS ?? 120_000)
export const TIMEOUT_LECTURA_MS = Number(process.env.SMARTOLT_TIMEOUT_MS ?? 15_000)

interface RespuestaSmartOlt {
    status?: boolean
    response?: unknown
    error?: string
    error_code?: string
    [k: string]: unknown
}

export class ErrorSmartOlt extends Error {
    constructor(
        message: string,
        /** `error_code` de SmartOLT si vino */
        readonly codigo: string | null,
        readonly status: number | null,
    ) {
        super(message)
    }
}

async function pedir(
    config: ConfigSmartOlt,
    metodo: 'GET' | 'POST',
    ruta: string,
    opciones: {
        form?: Record<string, string>
        servicioId?: number | null
        timeoutMs?: number
        reintentos?: number
    } = {},
): Promise<RespuestaSmartOlt> {
    let r: RespuestaEquipos<RespuestaSmartOlt>
    try {
        r = await llamar<RespuestaSmartOlt>({
            sistema: 'smartolt',
            metodo,
            base: config.url,
            ruta,
            cabeceras: {
                'X-Token': config.token,
                ...(opciones.form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
            },
            cuerpo: opciones.form ? new URLSearchParams(opciones.form).toString() : undefined,
            cuerpoAuditado: opciones.form,
            servicioId: opciones.servicioId,
            timeoutMs: opciones.timeoutMs ?? TIMEOUT_LECTURA_MS,
            reintentos: opciones.reintentos,
        })
    } catch (error) {
        if (
            error instanceof ErrorEquipos &&
            error.tipo === 'http' &&
            error.datos &&
            typeof error.datos === 'object'
        ) {
            const d = error.datos as RespuestaSmartOlt
            throw new ErrorSmartOlt(
                d.error ? `SmartOLT: ${d.error}` : error.message,
                d.error_code ?? null,
                error.status,
            )
        }
        throw error
    }
    if (r.datos && typeof r.datos === 'object' && r.datos.status === false) {
        throw new ErrorSmartOlt(
            `SmartOLT: ${r.datos.error ?? 'respuesta con status false'}`,
            r.datos.error_code ?? null,
            r.status,
        )
    }
    return r.datos ?? {}
}

export interface OltSmartOlt {
    id: string
    name: string
    /** `olt_hardware_version` */
    hardware: string | null
    ip: string | null
}

/** Las OLT de la cuenta (prueba y sincronización a la vez; nunca como latido). */
export async function listarOlts(config: ConfigSmartOlt): Promise<OltSmartOlt[]> {
    const d = await pedir(config, 'GET', '/api/system/get_olts', { reintentos: 0 })
    const lista = Array.isArray(d.response) ? (d.response as Array<Record<string, unknown>>) : []
    const texto = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : null)
    return lista.map((o) => ({
        id: String(o.id),
        name: String(o.name ?? ''),
        hardware: texto(o.olt_hardware_version),
        ip: texto(o.ip),
    }))
}

export interface OnuSinConfigurar {
    olt_id: string
    pon_type: 'gpon' | 'epon'
    board: string
    port: string
    sn: string
    onu_type_name: string | null
}

/** La ONU de esa serie en la lista de no configuradas (la búsqueda de SmartOLT es «contiene»). */
export async function buscarSinConfigurar(
    config: ConfigSmartOlt,
    serie: string,
    servicioId: number,
): Promise<OnuSinConfigurar | null> {
    const d = await pedir(config, 'GET', `/api/onu/unconfigured_onus?sn=${encodeURIComponent(serie)}`, {
        servicioId,
    })
    const lista = Array.isArray(d.response) ? (d.response as Array<Record<string, unknown>>) : []
    const fila = lista.find((o) => String(o.sn ?? '').toUpperCase() === serie.toUpperCase())
    if (!fila) return null
    return {
        olt_id: String(fila.olt_id),
        pon_type: fila.pon_type === 'epon' ? 'epon' : 'gpon',
        board: String(fila.board),
        port: String(fila.port),
        sn: String(fila.sn),
        onu_type_name: typeof fila.onu_type_name === 'string' ? fila.onu_type_name : null,
    }
}

export interface DetalleOnu {
    unique_external_id: string | null
    sn: string
    olt_id: string | null
    onu_type_name: string | null
    tr069: string | null
    wifi_ssid: string | null
    status: string | null
    last_status_change: string | null
}

function detalleDe(o: Record<string, unknown>): DetalleOnu {
    const wifi = Array.isArray(o.wifi_ports) ? (o.wifi_ports as Array<Record<string, unknown>>) : []
    const ssid = wifi.map((w) => w.ssid ?? w.reported_ssid).find((s) => typeof s === 'string' && s)
    return {
        unique_external_id:
            typeof o.unique_external_id === 'string' && o.unique_external_id ? o.unique_external_id : null,
        sn: String(o.sn ?? ''),
        olt_id: o.olt_id === undefined || o.olt_id === null ? null : String(o.olt_id),
        onu_type_name: typeof o.onu_type_name === 'string' ? o.onu_type_name : null,
        tr069: typeof o.tr069 === 'string' ? o.tr069 : null,
        wifi_ssid: typeof ssid === 'string' ? ssid : null,
        status: typeof o.status === 'string' ? o.status : null,
        last_status_change: typeof o.last_status_change === 'string' ? o.last_status_change : null,
    }
}

/** ONUs ya autorizadas con esa serie (vacío si ninguna). */
export async function detallesPorSerie(
    config: ConfigSmartOlt,
    serie: string,
    servicioId: number,
): Promise<DetalleOnu[]> {
    const d = await pedir(config, 'GET', `/api/onu/get_onus_details_by_sn/${encodeURIComponent(serie)}`, {
        servicioId,
    })
    const lista = Array.isArray(d.onus) ? (d.onus as Array<Record<string, unknown>>) : []
    return lista.map(detalleDe)
}

export async function detalles(
    config: ConfigSmartOlt,
    externo: string,
    servicioId: number,
): Promise<DetalleOnu | null> {
    const d = await pedir(config, 'GET', `/api/onu/get_onu_details/${encodeURIComponent(externo)}`, {
        servicioId,
    })
    return d.onu_details && typeof d.onu_details === 'object'
        ? detalleDe(d.onu_details as Record<string, unknown>)
        : null
}

export interface EntradaAutorizar {
    olt_id: string
    pon_type: 'gpon' | 'epon'
    sn: string
    board: string
    port: string
    authorization_preset_id: number
    onu_external_id: string
    onu_type?: string | null
}

/**
 * Autoriza en línea (con `board` y `port`) usando el perfil de autorización. Solo se mandan los
 * campos que el perfil nunca fija (SmartOLT responde 400 `authorization_preset_conflicting_parameter`
 * si se repite uno del perfil); `onu_type` solo cuando SmartOLT lo pide (`specify_onu_type`).
 * Sin reintentos automáticos: una repetición podría chocar con la autorización en curso.
 */
export async function autorizar(
    config: ConfigSmartOlt,
    e: EntradaAutorizar,
    servicioId: number,
): Promise<void> {
    const form: Record<string, string> = {
        olt_id: e.olt_id,
        pon_type: e.pon_type,
        sn: e.sn,
        authorization_preset_id: String(e.authorization_preset_id),
        board: e.board,
        port: e.port,
        onu_external_id: e.onu_external_id,
    }
    if (e.onu_type) form.onu_type = e.onu_type
    await pedir(config, 'POST', '/api/onu/authorize_onu', {
        form,
        servicioId,
        timeoutMs: TIMEOUT_AUTORIZAR_MS,
        reintentos: 0,
    })
}

/** `Online`, `Power fail`, `LOS` u `Offline`, con su último cambio. */
export async function estado(
    config: ConfigSmartOlt,
    externo: string,
    servicioId: number,
): Promise<{ estado: string | null; ultimo_cambio: string | null }> {
    const d = await pedir(config, 'GET', `/api/onu/get_onu_status/${encodeURIComponent(externo)}`, {
        servicioId,
        reintentos: 1,
    })
    return {
        estado: typeof d.onu_status === 'string' ? d.onu_status : null,
        ultimo_cambio: typeof d.last_status_change === 'string' ? d.last_status_change : null,
    }
}

/** `-19.80 dBm` → -19.8 */
function dbm(valor: unknown): number | null {
    if (typeof valor !== 'string') return null
    const m = /(-?\d+(?:\.\d+)?)/.exec(valor)
    return m ? Number(m[1]) : null
}

/**
 * Señal de la ONU. SmartOLT da `onu_signal_1490` (lo que recibe la ONU: rx) y `onu_signal_1310`
 * (lo que la OLT recibe de la ONU). El contrato pide `{ rx_dbm, tx_dbm }`: rx = 1490; `tx_dbm` sale
 * de 1310 (pendiente confirmar con el PM si prefiere la potencia de transmisión de la ONU, que la
 * API solo da en el texto de `get_onu_full_status_info`).
 */
export async function senal(
    config: ConfigSmartOlt,
    externo: string,
    servicioId: number,
): Promise<{ rx_dbm: number | null; tx_dbm: number | null } | null> {
    const d = await pedir(config, 'GET', `/api/onu/get_onu_signal/${encodeURIComponent(externo)}`, {
        servicioId,
        reintentos: 1,
    })
    const rx = dbm(d.onu_signal_1490)
    const tx = dbm(d.onu_signal_1310)
    return rx === null && tx === null ? null : { rx_dbm: rx, tx_dbm: tx }
}

/** `2025-12-30 12:00:00` (sin zona; SmartOLT no la documenta) → ISO UTC, o null. */
export function instanteSmartOlt(valor: string | null): string | null {
    if (!valor || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(valor)) return null
    const d = new Date(`${valor.replace(' ', 'T')}Z`)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
