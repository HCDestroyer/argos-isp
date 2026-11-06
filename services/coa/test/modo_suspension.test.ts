import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, beforeEach, describe, it } from 'node:test'
import { Dispatcher } from '../src/dispatcher.ts'
import { cambiaModo, modoDeConfiguracion, ModoSuspensionVigente } from '../src/modo_suspension.ts'
import { ClienteNasUdp } from '../src/nas.ts'
import {
    AlmacenMemoria,
    CLAVE,
    SECRET,
    servicio,
    sesion,
    silencio,
    SUSPENDIDO,
    TIMEOUT_ACK_MS,
} from './ayudas.ts'
import { NasSimulado } from './nas_simulado.ts'

/**
 * Modo de suspensión configurable desde el panel (`.claude/integration/a5.md`, §10.7 de
 * `contratos/control-velocidad.md`): API interna simulada por HTTP con el JSON de `Schema<'PortalCorte'>`.
 */

const TOKEN = 'token-interno-de-prueba'

/** `GET /api/v1/internal/corte/configuracion` simulado: responde `estado` y el JSON de `PortalCorte`. */
class ApiSimulada {
    estado = 200
    modo: string = 'desconectar'
    pedidos = 0
    autorizaciones: string[] = []
    readonly #servidor: Server = createServer((req, res) => {
        if (req.url !== '/api/v1/internal/corte/configuracion') {
            res.writeHead(404).end()
            return
        }
        this.pedidos++
        this.autorizaciones.push(String(req.headers.authorization))
        if (this.estado !== 200) {
            res.writeHead(this.estado).end()
            return
        }
        // Fiel a `Schema<'PortalCorte'>` (apps/api/app/portal/esquemas.ts)
        res.writeHead(200, { 'content-type': 'application/json' }).end(
            JSON.stringify({
                portal_v4: null,
                portal_v6: null,
                portal_puerto: 80,
                modo_suspension: this.modo,
                origen: 'configuracion',
                portal_url: null,
                version: 1,
                updated_at: '2026-11-06T12:00:00.000Z',
            }),
        )
    })

    async iniciar(): Promise<void> {
        await new Promise<void>((r) => this.#servidor.listen(0, '127.0.0.1', r))
    }
    get url(): string {
        return `http://127.0.0.1:${(this.#servidor.address() as AddressInfo).port}/api/v1/`
    }
    cerrar(): Promise<void> {
        return new Promise((r) => this.#servidor.close(() => r()))
    }
}

function vigente(api: ApiSimulada | null, respaldo: 'coa' | 'disconnect' = 'coa', url?: string) {
    return new ModoSuspensionVigente({
        respaldo,
        api:
            api || url
                ? { url: url ?? api!.url, token: TOKEN, timeoutMs: 500, reintentos: 1, esperaMs: 5 }
                : null,
        log: silencio,
        esperaArranqueMs: 20,
        esperaMaximaMs: 40,
    })
}

async function esperar(condicion: () => boolean, ms = 3000) {
    const limite = Date.now() + ms
    while (!condicion()) {
        if (Date.now() > limite) throw new Error('no se cumplió a tiempo')
        await new Promise((r) => setTimeout(r, 10))
    }
}

describe('modo de suspensión (contrato)', () => {
    it('desconectar → disconnect, coa → coa; otro valor no cumple el contrato', () => {
        assert.equal(modoDeConfiguracion({ modo_suspension: 'desconectar' }), 'disconnect')
        assert.equal(modoDeConfiguracion({ modo_suspension: 'coa' }), 'coa')
        assert.equal(modoDeConfiguracion({ modo_suspension: 'disconnect' }), null)
        assert.equal(modoDeConfiguracion(null), null)
    })

    it('portal.config_cambiada relee con modo_suspension o sin campos; no con los del NAT', () => {
        assert.equal(cambiaModo({ empresa_id: null, campos: ['modo_suspension'] }), true)
        assert.equal(cambiaModo({ empresa_id: null, campos: ['portal_v4', 'modo_suspension'] }), true)
        assert.equal(cambiaModo({ empresa_id: null }), true)
        assert.equal(cambiaModo({ empresa_id: null, campos: ['portal_v4', 'portal_puerto'] }), false)
        assert.equal(cambiaModo({ empresa_id: 3, campos: ['url_corte'] }), false)
    })
})

describe('ModoSuspensionVigente (API interna simulada)', () => {
    const api = new ApiSimulada()
    const abiertos: ModoSuspensionVigente[] = []

    before(() => api.iniciar())
    after(async () => {
        for (const m of abiertos) await m.detener()
        await api.cerrar()
    })
    beforeEach(() => {
        api.estado = 200
        api.modo = 'desconectar'
        api.pedidos = 0
        api.autorizaciones.length = 0
    })

    it('al arrancar lee la API con el Bearer interno y reemplaza el respaldo del entorno', async () => {
        const m = vigente(api, 'coa')
        assert.equal(m.valor, 'coa')
        const r = await m.iniciar()
        assert.deepEqual(r, { ok: true, valor: 'disconnect' })
        assert.equal(m.valor, 'disconnect')
        assert.equal(m.origen, 'api')
        assert.deepEqual(api.autorizaciones, [`Bearer ${TOKEN}`])
    })

    it('API caída al arrancar: queda COA_SUSPENDER y reintenta en segundo plano hasta leerla', async () => {
        api.estado = 503
        const m = vigente(api, 'coa')
        abiertos.push(m)
        const r = await m.iniciar()
        assert.equal(r.ok, false)
        assert.equal(api.pedidos, 2, 'el primer intento y un reintento (COA_API_REINTENTOS=1)')
        assert.equal(m.valor, 'coa')
        assert.equal(m.origen, 'entorno')
        api.estado = 200
        await esperar(() => m.origen === 'api')
        assert.equal(m.valor, 'disconnect')
        const pedidos = api.pedidos
        await new Promise((r) => setTimeout(r, 100))
        assert.equal(api.pedidos, pedidos, 'tras leerla deja de reintentar')
    })

    it('API inalcanzable (sin servidor): respaldo del entorno', async () => {
        const m = vigente(null, 'disconnect', 'http://127.0.0.1:1/api/v1/')
        abiertos.push(m)
        assert.equal((await m.iniciar()).ok, false)
        assert.equal(m.valor, 'disconnect')
        await m.detener()
    })

    it('sin API_INTERNAL_URL: solo el entorno, sin pedir nada', async () => {
        const m = vigente(null, 'disconnect')
        assert.deepEqual(await m.iniciar(), { ok: false, error: 'sin API_INTERNAL_URL' })
        assert.deepEqual(await m.releer(), { ok: false, error: 'sin API_INTERNAL_URL' })
        assert.equal(m.valor, 'disconnect')
    })

    it('releer cambia el valor en memoria; si la API falla conserva el último', async () => {
        const m = vigente(api, 'disconnect')
        await m.iniciar()
        assert.equal(m.valor, 'disconnect')
        api.modo = 'coa'
        assert.deepEqual(await m.releer(), { ok: true, valor: 'coa' })
        assert.equal(m.valor, 'coa')
        api.estado = 500
        assert.equal((await m.releer()).ok, false)
        assert.equal(m.valor, 'coa')
        api.estado = 401
        api.pedidos = 0
        assert.equal((await m.releer()).ok, false)
        assert.equal(api.pedidos, 1, 'un 4xx no se reintenta')
        assert.equal(m.valor, 'coa')
    })

    it('respuesta sin modo válido: error y conserva el último', async () => {
        const m = vigente(api, 'coa')
        await m.iniciar()
        api.modo = 'otro'
        assert.equal((await m.releer()).ok, false)
        assert.equal(m.valor, 'disconnect')
    })
})

describe('Dispatcher con el modo del panel (portal.config_cambiada)', () => {
    const api = new ApiSimulada()
    const nas = new NasSimulado({ ip: '127.0.0.1', secret: SECRET })
    let almacen: AlmacenMemoria
    let modo: ModoSuspensionVigente
    let dispatcher: Dispatcher

    before(async () => {
        await api.iniciar()
        await nas.iniciar()
    })
    after(async () => {
        await api.cerrar()
        await nas.cerrar()
    })
    beforeEach(async () => {
        api.estado = 200
        api.modo = 'coa'
        api.pedidos = 0
        nas.modo = 'ack'
        nas.recibidos.length = 0
        almacen = new AlmacenMemoria()
        almacen.servicios.set(101, servicio({ estado: 'suspendido' }))
        almacen.sesiones.set(101, [sesion()])
        modo = vigente(api, 'disconnect')
        await modo.iniciar()
        dispatcher = new Dispatcher({
            almacen,
            nas: new ClienteNasUdp(),
            claveSecretos: CLAVE,
            suspendido: SUSPENDIDO,
            suspender: modo,
            suspenderConIpv6: 'coa',
            puertoNas: nas.puerto,
            timeoutMs: TIMEOUT_ACK_MS,
            reintentos: 0,
            esperaMs: 10,
            log: silencio,
        })
    })

    const suspender = (id: number) => ({
        id,
        evento: 'servicio.estado_cambiado',
        payload: { servicio_id: 101, de: 'activo', a: 'suspendido', motivo: 'corte' },
        requestId: `req-${id}`,
    })
    const portal = (id: number, campos?: string[]) => ({
        id,
        evento: 'portal.config_cambiada',
        payload: campos ? { empresa_id: null, campos } : { empresa_id: null },
        requestId: `req-${id}`,
    })

    it('acepta portal.config_cambiada', () => {
        assert.equal(dispatcher.acepta('portal.config_cambiada'), true)
    })

    it('coa → desconectar desde el panel: la siguiente suspensión va por Disconnect, sin tocar sesiones', async () => {
        assert.equal(dispatcher.modoSuspension, 'coa')
        const antes = await dispatcher.procesar(suspender(1))
        assert.deepEqual(
            antes.sesiones.map((s) => [s.tipo, s.resultado]),
            [['coa', 'ack']],
        )

        api.modo = 'desconectar'
        nas.recibidos.length = 0
        const r = await dispatcher.procesar(portal(2, ['modo_suspension']))
        assert.equal(r.decision?.accion, 'nada')
        assert.deepEqual(r.sesiones, [])
        assert.equal(nas.recibidos.length, 0, 'cambiar el modo no re-suspende a nadie')
        assert.equal(dispatcher.modoSuspension, 'disconnect')

        const despues = await dispatcher.procesar(suspender(3))
        assert.deepEqual(
            despues.sesiones.map((s) => [s.tipo, s.resultado]),
            [['disconnect', 'ack']],
        )
        assert.equal(nas.recibidos[0]?.codigo, 'Disconnect-Request')
    })

    it('idempotente: el mismo evento dos veces relee y deja el valor vigente', async () => {
        api.modo = 'desconectar'
        await dispatcher.procesar(portal(4, ['modo_suspension']))
        await dispatcher.procesar(portal(4, ['modo_suspension']))
        assert.equal(dispatcher.modoSuspension, 'disconnect')
        assert.equal(api.pedidos, 3, 'arranque y una relectura por entrega')
    })

    it('sin campos relee; con solo campos del NAT o url_corte no pide nada', async () => {
        api.modo = 'desconectar'
        await dispatcher.procesar(portal(5, ['portal_v4', 'portal_puerto']))
        await dispatcher.procesar({
            ...portal(6, ['url_corte']),
            payload: { empresa_id: 3, campos: ['url_corte'] },
        })
        assert.equal(api.pedidos, 1)
        assert.equal(dispatcher.modoSuspension, 'coa')
        await dispatcher.procesar(portal(7))
        assert.equal(api.pedidos, 2)
        assert.equal(dispatcher.modoSuspension, 'disconnect')
    })

    it('API caída al releer: conserva el último modo y confirma el evento (no lanza)', async () => {
        api.estado = 503
        const r = await dispatcher.procesar(portal(8, ['modo_suspension']))
        assert.equal(r.decision?.accion, 'nada')
        assert.equal(dispatcher.modoSuspension, 'coa')
    })

    it('modo fijo (sin fuente): portal.config_cambiada no hace nada', async () => {
        const fijo = new Dispatcher({
            almacen,
            nas: new ClienteNasUdp(),
            claveSecretos: CLAVE,
            suspendido: SUSPENDIDO,
            suspender: 'disconnect',
            puertoNas: nas.puerto,
            timeoutMs: TIMEOUT_ACK_MS,
            reintentos: 0,
            esperaMs: 10,
            log: silencio,
        })
        const r = await fijo.procesar(portal(9, ['modo_suspension']))
        assert.equal(r.decision?.razon, 'no cambia el modo de suspensión')
        assert.equal(api.pedidos, 1)
    })
})
