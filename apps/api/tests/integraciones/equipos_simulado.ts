import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as crearHttps } from 'node:https'
import type { AddressInfo, Server } from 'node:net'

/**
 * SmartOLT y GenieACS simulados: un servidor HTTP local por sistema que registra cada petición y
 * responde con el manejador de su ruta (sin consulta). Las respuestas imitan las documentadas
 * (`https://www.smartolt.com/openapi.json` y la referencia del NBI de GenieACS). Sin manejador: 404.
 */

export interface Peticion {
    metodo: string
    ruta: string
    consulta: URLSearchParams
    cabeceras: Record<string, string | string[] | undefined>
    cuerpo: string
    json: any
    form: URLSearchParams
}

export interface Respuesta {
    status: number
    statusText?: string
    cuerpo?: unknown
}

export type Manejador = (p: Peticion) => Respuesta | Promise<Respuesta>

export class Simulado {
    readonly peticiones: Peticion[] = []
    readonly rutas = new Map<string, Manejador>()
    #servidor: Server | null = null
    url = ''

    /** Con `tls` escucha por HTTPS (como el proxy del NBI de GenieACS en su servidor). */
    async iniciar(opciones: { tls?: { key: string; cert: string } } = {}): Promise<this> {
        const atender = (req: IncomingMessage, res: ServerResponse) => void this.#atender(req, res)
        this.#servidor = opciones.tls ? crearHttps(opciones.tls, atender) : createServer(atender)
        await new Promise<void>((r) => this.#servidor!.listen(0, '127.0.0.1', r))
        const { port } = this.#servidor.address() as AddressInfo
        this.url = `${opciones.tls ? 'https' : 'http'}://127.0.0.1:${port}`
        return this
    }

    responder(ruta: string, manejador: Manejador): this {
        this.rutas.set(ruta, manejador)
        return this
    }

    de(prefijo: string): Peticion[] {
        return this.peticiones.filter((p) => p.ruta.startsWith(prefijo))
    }

    limpiar() {
        this.peticiones.length = 0
        this.rutas.clear()
    }

    async detener() {
        await new Promise<void>((r) => (this.#servidor ? this.#servidor.close(() => r()) : r()))
        this.#servidor = null
    }

    async #atender(req: IncomingMessage, res: ServerResponse) {
        const partes: Buffer[] = []
        for await (const parte of req) partes.push(parte as Buffer)
        const cuerpo = Buffer.concat(partes).toString('utf8')
        let json: unknown = null
        try {
            json = cuerpo ? JSON.parse(cuerpo) : null
        } catch {
            json = null
        }
        const url = new URL(req.url ?? '/', 'http://x')
        const peticion: Peticion = {
            metodo: req.method ?? 'GET',
            ruta: url.pathname,
            consulta: url.searchParams,
            cabeceras: req.headers,
            cuerpo,
            json,
            form: new URLSearchParams(cuerpo),
        }
        this.peticiones.push(peticion)
        // la ruta exacta, o el prefijo más largo registrado con `*` final
        let manejador = this.rutas.get(`${peticion.metodo} ${url.pathname}`)
        if (!manejador) {
            const prefijos = [...this.rutas.keys()]
                .filter(
                    (k) => k.endsWith('*') && `${peticion.metodo} ${url.pathname}`.startsWith(k.slice(0, -1)),
                )
                .sort((a, b) => b.length - a.length)
            if (prefijos[0]) manejador = this.rutas.get(prefijos[0])
        }
        const r = manejador ? await manejador(peticion) : { status: 404, cuerpo: 'No such device' }
        res.writeHead(r.status, r.statusText ?? '', { 'content-type': 'application/json' })
        res.end(
            r.cuerpo === undefined ? '' : typeof r.cuerpo === 'string' ? r.cuerpo : JSON.stringify(r.cuerpo),
        )
    }
}

/** ONU sin configurar como la devuelve `GET /api/onu/unconfigured_onus` (ejemplo de la documentación). */
export function onuSinConfigurar(sn: string, oltId = '1') {
    return {
        id: 0,
        pon_type: 'gpon',
        board: '2',
        port: '3',
        onu: '1',
        sn,
        onu_type_name: 'ZTE-F660V6.0',
        onu_type_id: '75',
        olt_id: oltId,
        is_disabled: 0,
        old_location: null,
        new_location: null,
        external_id: null,
        actions: ['authorize'],
    }
}

/** Dispositivo de GenieACS (TR-098) con la forma de la base: `{ _value, _type, _timestamp }`. */
export function dispositivoTr098(id: string, serie: string, ssid = 'Casa', lastInform = new Date()) {
    const p = (v: string) => ({ _value: v, _type: 'xsd:string', _timestamp: lastInform.toISOString() })
    return {
        _id: id,
        _lastInform: lastInform.toISOString(),
        _deviceId: { _Manufacturer: 'ZTE', _OUI: '00259E', _ProductClass: 'F670L', _SerialNumber: serie },
        InternetGatewayDevice: {
            DeviceInfo: { SoftwareVersion: p('V9.0.10P2N3'), Manufacturer: p('ZTE') },
            LANDevice: { 1: { WLANConfiguration: { 1: { SSID: p(ssid) } } } },
        },
    }
}
