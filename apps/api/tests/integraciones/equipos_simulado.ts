import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as crearHttps } from 'node:https'
import type { AddressInfo, Server } from 'node:net'
import db from '@adonisjs/lucid/services/db'
import { cifrar } from '#shared/cifrado'

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

// ── Configuración de pruebas: instancia de SmartOLT y ACS por separado ─────────────────────────

export interface PerfilPrueba {
    smartolt_olt_id: string
    plan_id?: number | null
    authorization_preset_id: number
    pon_type?: 'gpon' | 'epon'
}

/**
 * SmartOLT y ACS **ya configurados y probados** para las pruebas, sin pasar por la API (las acciones
 * de configuración tienen sus propias pruebas). Cada simulado de SmartOLT es una instancia (su propio
 * puerto: «subdominio»); si la URL ya está registrada en otra empresa, la instancia pasa a compartida
 * (`empresa_id` null), como hace la migración. Devuelve el id de la instancia (o null).
 */
export async function configurarEquipos(opciones: {
    empresaId?: number
    smartolt?: {
        url: string
        token?: string
        nombre?: string
        compartida?: boolean
        activo?: boolean
        probado?: boolean
        perfiles?: PerfilPrueba[]
    } | null
    acs?: {
        url: string
        usuario?: string | null
        clave?: string | null
        activo?: boolean
        probado?: boolean
        pppoe_por_acs?: boolean
    } | null
}): Promise<{ instanciaId: number | null }> {
    const empresaId = opciones.empresaId ?? 1
    const ahora = new Date()
    let instanciaId: number | null = null
    if (opciones.smartolt) {
        const so = opciones.smartolt
        const probado = so.probado ?? true
        const existente = await db
            .from('integraciones.smartolt_instancias')
            .whereRaw('lower(url) = lower(?)', [so.url])
            .first()
        if (existente) {
            instanciaId = Number(existente.id)
            if (existente.empresa_id !== null && Number(existente.empresa_id) !== empresaId) {
                await db
                    .from('integraciones.smartolt_instancias')
                    .where('id', instanciaId)
                    .update({ empresa_id: null })
            }
        } else {
            const [fila] = await db
                .table('integraciones.smartolt_instancias')
                .insert({
                    empresa_id: so.compartida ? null : empresaId,
                    nombre: so.nombre ?? `SmartOLT ${new URL(so.url).port || 'principal'}`,
                    url: so.url,
                    token_cifrado: cifrar(so.token ?? 'token-smartolt-secreto-123'),
                    activo: so.activo ?? true,
                    probado_en: probado ? ahora : null,
                    prueba_ok: probado ? true : null,
                })
                .returning('id')
            instanciaId = Number(fila.id)
        }
        for (const p of so.perfiles ?? []) {
            await db
                .knexQuery()
                .table('integraciones.smartolt_olts')
                .insert({ instancia_id: instanciaId, smartolt_olt_id: p.smartolt_olt_id, origen: 'manual' })
                .onConflict(['instancia_id', 'smartolt_olt_id'])
                .ignore()
            const ref = await db
                .from('integraciones.smartolt_olts')
                .where({ instancia_id: instanciaId, smartolt_olt_id: p.smartolt_olt_id })
                .firstOrFail()
            await db.table('integraciones.equipos_perfiles').insert({
                smartolt_olt_ref_id: ref.id,
                plan_id: p.plan_id ?? null,
                authorization_preset_id: p.authorization_preset_id,
                pon_type: p.pon_type ?? 'gpon',
            })
        }
    }
    if (opciones.acs) {
        const a = opciones.acs
        const probado = a.probado ?? true
        await db
            .knexQuery()
            .table('integraciones.acs_config')
            .insert({
                empresa_id: empresaId,
                activo: a.activo ?? true,
                url: a.url,
                usuario: a.usuario ?? null,
                clave_cifrada: a.clave ? cifrar(a.clave) : null,
                probado_en: probado ? ahora : null,
                prueba_ok: probado ? true : null,
                pppoe_por_acs: a.pppoe_por_acs ?? false,
            })
            .onConflict('empresa_id')
            .merge()
    }
    return { instanciaId }
}

/** Borra la configuración de equipos de todas las empresas (entre pruebas). */
export async function limpiarEquipos() {
    await db.from('integraciones.equipos_perfiles').delete()
    await db.from('integraciones.smartolt_olts').delete()
    await db.from('integraciones.smartolt_instancias').delete()
    await db.from('integraciones.acs_config').delete()
}

/** Apaga SmartOLT y el ACS de una empresa (sus instancias propias y su ACS). */
export async function apagarEquipos(empresaId: number) {
    await db
        .from('integraciones.smartolt_instancias')
        .where('empresa_id', empresaId)
        .update({ activo: false })
    await db.from('integraciones.acs_config').where('empresa_id', empresaId).update({ activo: false })
}

/** Borra SmartOLT (instancias propias) y el ACS de una empresa. */
export async function borrarEquiposDe(empresaId: number) {
    await db.from('integraciones.smartolt_instancias').where('empresa_id', empresaId).delete()
    await db.from('integraciones.acs_config').where('empresa_id', empresaId).delete()
}
