import { ErrorEquipos, llamar } from '#integraciones/equipos/http'
import type { ConfigGenieAcs } from '#integraciones/equipos/configuracion'

/**
 * Adaptador del NBI de GenieACS (puerto 7557). Fuentes:
 *
 * - Referencia oficial del API (`https://docs.genieacs.com/en/latest/api-reference.html`):
 *   `GET /<colección>/?query=<JSON>&projection=`, `POST /devices/<id>/tasks?connection_request`
 *   con `setParameterValues` (`parameterValues: [[ruta, valor, tipo]]`) y `refreshObject`,
 *   `DELETE /tasks/<id>`, `DELETE /faults/<id>` y el ejemplo de Wi-Fi en TR-098
 *   (`InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID`).
 * - Código del NBI (`lib/nbi.ts` de genieacs/genieacs): `200` si la tarea se ejecutó, `202` con
 *   `statusText` «Task queued but not processed» (el equipo no abrió sesión a tiempo) o «Task faulted»
 *   (el equipo la rechazó); `404 No such device`; `?timeout=` = ms que espera la sesión; `limit` en
 *   las búsquedas. `lib/db/synth.ts`: `DeviceID.SerialNumber` se guarda como `_deviceId._SerialNumber`.
 *   `lib/cwmp/db.ts`: cada parámetro es `{ _value, _type, _timestamp, _writable }`.
 * - Variables de entorno (`environment-variables.html`): **el NBI no tiene autenticación** y por
 *   defecto escucha solo en 127.0.0.1. Si Argos no está en el mismo host, va detrás de un proxy con
 *   autenticación básica: Argos manda `Authorization: Basic` cuando la empresa guarda usuario y clave.
 * - Claves Wi-Fi: `InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase` (TR-098) y
 *   `Device.WiFi.AccessPoint.1.Security.KeyPassphrase` (TR-181), del ejemplo «editable virtual
 *   parameter for WPA passphrase» de `virtual-parameters.html`. El SSID en TR-181
 *   (`Device.WiFi.SSID.1.SSID`) y PPPoE (`…WANPPPConnection.1.Username/Password` en TR-098,
 *   `Device.PPP.Interface.1.Username/Password` en TR-181) son del modelo de datos de Broadband
 *   Forum, no de la documentación de GenieACS: pendientes de verificar con los equipos reales.
 */

export const TIMEOUT_TAREA_MS = Number(process.env.GENIEACS_TIMEOUT_TAREA_MS ?? 140_000)
export const TIMEOUT_LECTURA_MS = Number(process.env.GENIEACS_TIMEOUT_MS ?? 15_000)
/** ms que el NBI espera a que el equipo abra sesión tras el connection request (`?timeout=`). */
export const ESPERA_SESION_MS = Number(process.env.GENIEACS_ESPERA_SESION_MS ?? 10_000)

export type ModeloDatos = 'tr098' | 'tr181'

/** Parámetros por modelo de datos (primera red Wi-Fi, primera conexión PPP). */
export const PARAMETROS: Record<
    ModeloDatos,
    { ssid: string; clave: string; pppUsuario: string; pppClave: string; firmware: string }
> = {
    tr098: {
        ssid: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID',
        clave: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase',
        pppUsuario: 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username',
        pppClave: 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Password',
        firmware: 'InternetGatewayDevice.DeviceInfo.SoftwareVersion',
    },
    tr181: {
        ssid: 'Device.WiFi.SSID.1.SSID',
        clave: 'Device.WiFi.AccessPoint.1.Security.KeyPassphrase',
        pppUsuario: 'Device.PPP.Interface.1.Username',
        pppClave: 'Device.PPP.Interface.1.Password',
        firmware: 'Device.DeviceInfo.SoftwareVersion',
    },
}

const PROYECCION = [
    '_id',
    '_lastInform',
    '_deviceId',
    PARAMETROS.tr098.ssid,
    PARAMETROS.tr098.firmware,
    PARAMETROS.tr181.ssid,
    PARAMETROS.tr181.firmware,
    'InternetGatewayDevice.DeviceInfo.Manufacturer',
    'Device.DeviceInfo.Manufacturer',
].join(',')

function cabeceras(config: ConfigGenieAcs, json = false): Record<string, string> {
    const h: Record<string, string> = {}
    if (config.usuario) {
        h.authorization = `Basic ${Buffer.from(`${config.usuario}:${config.clave ?? ''}`).toString('base64')}`
    }
    if (json) h['content-type'] = 'application/json'
    return h
}

export interface DispositivoAcs {
    id: string
    modelo_datos: ModeloDatos | null
    ultimo_contacto: string | null
    fabricante: string | null
    clase_producto: string | null
    serie: string | null
    ssid: string | null
    firmware: string | null
}

function valor(doc: Record<string, unknown>, ruta: string): unknown {
    let actual: unknown = doc
    for (const parte of ruta.split('.')) {
        if (!actual || typeof actual !== 'object') return undefined
        actual = (actual as Record<string, unknown>)[parte]
    }
    if (actual && typeof actual === 'object' && '_value' in (actual as Record<string, unknown>)) {
        return (actual as Record<string, unknown>)._value
    }
    return actual
}

function texto(v: unknown): string | null {
    return typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : null
}

export function dispositivoDe(doc: Record<string, unknown>): DispositivoAcs {
    const modelo: ModeloDatos | null =
        'InternetGatewayDevice' in doc ? 'tr098' : 'Device' in doc ? 'tr181' : null
    const id = (doc._deviceId ?? {}) as Record<string, unknown>
    const p = modelo ? PARAMETROS[modelo] : null
    const ultimo = doc._lastInform
    return {
        id: String(doc._id),
        modelo_datos: modelo,
        ultimo_contacto:
            typeof ultimo === 'string' || ultimo instanceof Date ? new Date(ultimo).toISOString() : null,
        fabricante: texto(id._Manufacturer),
        clase_producto: texto(id._ProductClass),
        serie: texto(id._SerialNumber),
        ssid: p ? texto(valor(doc, p.ssid)) : null,
        firmware: p ? texto(valor(doc, p.firmware)) : null,
    }
}

async function buscar(
    config: ConfigGenieAcs,
    consulta: Record<string, unknown>,
    servicioId: number | null,
): Promise<DispositivoAcs[]> {
    const ruta = `/devices/?query=${encodeURIComponent(JSON.stringify(consulta))}&projection=${encodeURIComponent(PROYECCION)}&limit=2`
    const r = await llamar<unknown>({
        sistema: 'genieacs',
        metodo: 'GET',
        base: config.url,
        ruta,
        cabeceras: cabeceras(config),
        ca: config.ca,
        servicioId,
        timeoutMs: TIMEOUT_LECTURA_MS,
    })
    return Array.isArray(r.datos) ? (r.datos as Array<Record<string, unknown>>).map(dispositivoDe) : []
}

/** Prueba de conexión: una búsqueda de un solo dispositivo. */
export async function probar(config: ConfigGenieAcs): Promise<{ dispositivos: number }> {
    const r = await llamar<unknown>({
        sistema: 'genieacs',
        metodo: 'GET',
        base: config.url,
        ruta: `/devices/?query=${encodeURIComponent('{}')}&projection=_id&limit=1`,
        cabeceras: cabeceras(config),
        ca: config.ca,
        timeoutMs: TIMEOUT_LECTURA_MS,
        reintentos: 0,
    })
    if (!Array.isArray(r.datos)) {
        throw new ErrorEquipos('GenieACS respondió algo que no es una lista', 'genieacs', 'http', r.status)
    }
    return { dispositivos: r.datos.length }
}

/** El dispositivo por su serie (`DeviceID.SerialNumber`). */
export async function porSerie(config: ConfigGenieAcs, serie: string, servicioId: number | null) {
    const lista = await buscar(config, { '_deviceId._SerialNumber': serie }, servicioId)
    return lista[0] ?? null
}

/** El dispositivo por la MAC de su WAN (rutas del ejemplo de la documentación y su par TR-181). */
export async function porMac(config: ConfigGenieAcs, mac: string, servicioId: number | null) {
    const lista = await buscar(
        config,
        {
            $or: [
                {
                    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.MACAddress':
                        mac,
                },
                {
                    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.MACAddress':
                        mac,
                },
                { 'Device.Ethernet.Interface.1.MACAddress': mac },
            ],
        },
        servicioId,
    )
    return lista[0] ?? null
}

export async function porId(config: ConfigGenieAcs, id: string, servicioId: number | null) {
    const lista = await buscar(config, { _id: id }, servicioId)
    return lista[0] ?? null
}

/** Resultado de una tarea: aplicada en el acto, sin respuesta del equipo o rechazada por él. */
export type ResultadoTarea = 'aplicada' | 'sin_respuesta' | 'rechazada'

/**
 * Manda una tarea con connection request y espera su resultado. Si no se aplicó en esta sesión, la
 * tarea se borra de la cola de GenieACS (y su falla): así no se aplica sola en el próximo inform
 * después de que Argos ya contestó «fallido».
 */
export async function tarea(
    config: ConfigGenieAcs,
    dispositivo: string,
    cuerpo: Record<string, unknown>,
    servicioId: number | null,
): Promise<ResultadoTarea> {
    const id = encodeURIComponent(dispositivo)
    const r = await llamar<Record<string, unknown> | null>({
        sistema: 'genieacs',
        metodo: 'POST',
        base: config.url,
        ruta: `/devices/${id}/tasks?connection_request&timeout=${ESPERA_SESION_MS}`,
        cabeceras: cabeceras(config, true),
        ca: config.ca,
        cuerpo: JSON.stringify(cuerpo),
        cuerpoAuditado: cuerpo,
        servicioId,
        timeoutMs: TIMEOUT_TAREA_MS,
        reintentos: 0,
    })
    if (r.status === 200) return 'aplicada'
    const resultado: ResultadoTarea = /fault/i.test(r.statusText) ? 'rechazada' : 'sin_respuesta'
    const tareaId = r.datos && typeof r.datos === 'object' ? r.datos._id : null
    if (typeof tareaId === 'string' && tareaId) {
        for (const ruta of [
            `/tasks/${encodeURIComponent(tareaId)}`,
            ...(resultado === 'rechazada'
                ? [`/faults/${encodeURIComponent(`${dispositivo}:task_${tareaId}`)}`]
                : []),
        ]) {
            await llamar({
                sistema: 'genieacs',
                metodo: 'DELETE',
                base: config.url,
                ruta,
                cabeceras: cabeceras(config),
                ca: config.ca,
                servicioId,
                timeoutMs: TIMEOUT_LECTURA_MS,
                reintentos: 1,
            }).catch(() => undefined)
        }
    }
    return resultado
}

/** `setParameterValues` con el tipo `xsd:string` de cada valor. */
export function setParametros(valores: Array<[string, string]>): Record<string, unknown> {
    return { name: 'setParameterValues', parameterValues: valores.map(([p, v]) => [p, v, 'xsd:string']) }
}
