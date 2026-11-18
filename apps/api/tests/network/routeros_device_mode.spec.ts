import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar, claveDesdeTexto } from '#shared/cifrado'
import env from '#start/env'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila, routerConTipo } from '#tests/core/fabricas'
import CambiarEstadoServicio from '#core/actions/cambiar_estado_servicio'
import { RouterOSFalso } from '#network/routeros/falso'
import { clienteDeRouter } from '#network/routeros/router'
import { ConsumidorRouterOS } from '#network/routeros/consumidor'
import ReconciliarRouterOS from '#network/routeros/actions/reconciliar_router'
import AplicarRedServicio from '#network/routeros/actions/aplicar_red_servicio'
import { bitacoraRed, type OpcionesDispatcher } from '#network/routeros/dispatcher'
import { commentServicio } from '#network/routeros/estado_deseado'
import {
    MENSAJE_PROXY_DEVICE_MODE,
    PUERTO_PROXY_CORTE,
    REGLA_INPUT_PROXY,
    REGLA_NAT_HTTP,
    REGLA_NAT_PROXY,
    REGLA_PROXY_SIN_CODIGO,
    proxyBloqueadoPorDeviceMode,
} from '#network/routeros/corte_router'
import { diagnosticoCorte, vistaPreviaReconciliar } from '#network/routeros/diagnostico'
import { diagnosticarErrorRouterOS } from '#network/diagnostico_routeros'
import { RouterOSInalcanzable, RouterOSSolicitud } from '#network/routeros/errores'
import type { EventoEntrante } from '#shared/eventos_bus'

/**
 * Bug del PM en producción (v1.17.0, RouterOS 7): `failure: invalid local port` al crear las reglas de
 * `/ip proxy access` del corte por código. `/ip proxy print` decía `;;; inactivated, not allowed by
 * device-mode`: en RouterOS 7.17+ el device-mode puede no permitir el proxy web y RouterOS rechaza todo
 * `local-port`. Aquí, con Postgres real y el RouterOS falso con `device-mode proxy=no`:
 *
 * - la reconciliación no intenta las reglas del proxy, avisa `proxy_corte` en `errores` y corta el router
 *   como en modo ip (dst-nat del HTTP al portal, nunca un redirect al 3346 de un proxy que no escucha);
 * - un comando que el router rechaza no aborta lo demás (se sigue y se reporta);
 * - «Sincronizar con el router» dice qué rechazó RouterOS, nunca «no responde».
 */

const OPCIONES: OpcionesDispatcher = {
    clientes: (router) =>
        clienteDeRouter(router, {
            clave: claveDesdeTexto(env.get('AAA_PPP_KEY')),
            bitacora: bitacoraRed,
            timeoutMs: 500,
            reintentos: 1,
            esperaMs: 5,
        }),
    red: { interfaz_clientes: 'ether-clientes', dhcp_servidor: 'dhcp-clientes' },
}

const ENTORNO = {
    ROUTERS_SERVICIO_PORTAL_V4: '192.0.2.20',
    ROUTERS_SERVICIO_PORTAL_FQDN: 'portal.argosisp.example',
    ROUTERS_SERVICIO_WALLED_GARDEN: '',
    ROUTERS_SERVICIO_DNS_V4: '',
    ROUTERS_SERVICIO_CLIENTES_V4: '10.10.0.0/16',
    PORTAL_URL_PUBLICA: 'https://portal.argosisp.example',
}

async function eventosDe(requestId: string): Promise<EventoEntrante[]> {
    const filas = await db.from('audit.outbox').where('request_id', requestId).orderBy('id')
    return filas.map((f) => ({
        id: Number(f.id),
        evento: f.evento,
        payload: f.payload,
        requestId: f.request_id,
    }))
}

async function entregar(eventos: EventoEntrante[]) {
    const consumidor = new ConsumidorRouterOS(OPCIONES, async () => {})
    for (const e of eventos) if (consumidor.acepta(e.evento)) await consumidor.procesar(e)
}

test.group('RouterOS · device-mode sin proxy web (invalid local port)', (group) => {
    let falso: RouterOSFalso
    let token: string
    let routerId: number
    let planId: number
    let clienteId: number
    const previo: Record<string, string | undefined> = {}

    group.each.setup(async () => {
        for (const [k, v] of Object.entries(ENTORNO)) {
            previo[k] = process.env[k]
            process.env[k] = v
        }
        falso = new RouterOSFalso()
        await falso.levantar()
        ;({ token } = await usuarioConRoles(['admin']))
        const esc = await crearEscenarioRouter()
        routerId = esc.routerId
        await db
            .from('network.routers')
            .where('id', routerId)
            .update({
                host: falso.url,
                api_usuario: falso.usuario,
                api_password: cifrar(falso.password),
                corte_identificacion: 'codigo',
            })
        planId = await crearPlanFila()
        clienteId = await crearClienteFila()
        return async () => {
            for (const [k, v] of Object.entries(previo)) {
                if (v === undefined) delete process.env[k]
                else process.env[k] = v
            }
            await falso.cerrar()
        }
    })

    async function crearWisp(client: any) {
        const requestId = unico('req')
        await routerConTipo(routerId, 'ip_estatica')
        const r = await estado(
            client.post('/api/v1/servicios').bearerToken(token).header('X-Request-Id', requestId).json({
                plantilla_facturacion_id: null,
                cliente_id: clienteId,
                router_id: routerId,
                plan_id: planId,
                tipo_conexion: 'ip_estatica',
            }),
            201,
        )
        await entregar(await eventosDe(requestId))
        return r.body() as { id: number; ipv4: string }
    }

    async function suspender(servicioId: number) {
        const ctx = contextoPrueba()
        await new CambiarEstadoServicio().execute({ servicioId, nuevo: 'suspendido', motivo: 'prueba' }, ctx)
        return eventosDe(ctx.requestId)
    }

    const reconciliar = () =>
        new ReconciliarRouterOS(OPCIONES).execute({ router_id: routerId, motivo: 'manual' }, contextoPrueba())
    const acceso = () => falso.tabla('/ip/proxy/access').filter((o) => o.dynamic !== 'true')
    const putsAcceso = () =>
        falso.escrituras.filter((p) => p.metodo === 'PUT' && p.ruta === '/rest/ip/proxy/access')
    const nat = (comment: string) => falso.tabla('/ip/firewall/nat').find((o) => o.comment === comment)

    test('el falso imita RouterOS 7.17+: con device-mode proxy=no rechaza todo local-port', async ({
        assert,
    }) => {
        falso.proxy = { ...falso.proxy, enabled: 'true', port: PUERTO_PROXY_CORTE }
        falso.deviceMode = { mode: 'home', proxy: 'false' }
        const r = await fetch(`${falso.url}/rest/ip/proxy/access`, {
            method: 'PUT',
            headers: {
                authorization: `Basic ${Buffer.from(`${falso.usuario}:${falso.password}`).toString('base64')}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({ 'local-port': PUERTO_PROXY_CORTE, action: 'deny' }),
        })
        assert.equal(r.status, 400)
        assert.include(await r.text(), 'invalid local port')
    })

    test('reconciliar con device-mode sin proxy: proxy_corte en errores, corte como en modo ip, nada al 3346', async ({
        client,
        assert,
    }) => {
        falso.deviceMode = { mode: 'home', proxy: 'false' }
        const servicio = await crearWisp(client)
        await entregar(await suspender(servicio.id))

        const r = await reconciliar()
        assert.isNull(r.error)
        assert.deepEqual(
            r.errores.filter((e) => e.operacion === 'proxy_corte'),
            [{ operacion: 'proxy_corte', mensaje: MENSAJE_PROXY_DEVICE_MODE }],
        )
        assert.include(MENSAJE_PROXY_DEVICE_MODE, '/system/device-mode/update proxy=yes')
        // Ningún intento de `/ip proxy access` (sin el error repetido) ni redirect al 3346.
        assert.lengthOf(putsAcceso(), 0)
        assert.lengthOf(acceso(), 0)
        assert.isUndefined(nat(REGLA_NAT_PROXY))
        // El suspendido sigue cortado: lista y dst-nat del HTTP al portal (modo ip).
        assert.isDefined(nat(REGLA_NAT_HTTP))
        assert.isTrue(
            falso
                .tabla('/ip/firewall/address-list')
                .some((o) => o.list === 'suspendidos' && o.address === servicio.ipv4),
        )
        // Evento para la alerta, con la operación clara
        const fallido = await db
            .from('audit.outbox')
            .where('evento', 'routeros.fallido')
            .whereRaw(`payload->>'operacion' = 'proxy_corte'`)
            .whereRaw(`(payload->>'router_id')::bigint = ?`, [routerId])
        assert.isAbove(fallido.length, 0)

        // El operador confirma el device-mode: la siguiente pasada arma el corte por código.
        falso.deviceMode = { mode: 'advanced', proxy: 'true' }
        const despues = await reconciliar()
        assert.deepEqual(despues.errores, [])
        assert.deepEqual(
            acceso().map((o) => o.comment),
            [commentServicio(servicio.id), REGLA_PROXY_SIN_CODIGO],
        )
        assert.isDefined(nat(REGLA_NAT_PROXY))
        assert.isUndefined(nat(REGLA_NAT_HTTP))
    })

    test('suspender por evento con device-mode sin proxy: no intenta la regla, errores proxy_corte, cola y lista sí', async ({
        client,
        assert,
    }) => {
        await reconciliar()
        const servicio = await crearWisp(client)
        falso.deviceMode = { mode: 'home', proxy: 'false' }
        const antes = putsAcceso().length
        const ctx = contextoPrueba()
        await new CambiarEstadoServicio().execute(
            { servicioId: servicio.id, nuevo: 'suspendido', motivo: 'prueba' },
            ctx,
        )
        const r = await new AplicarRedServicio(OPCIONES).execute(
            { servicio_id: servicio.id, evento: 'servicio.estado_cambiado' },
            contextoPrueba(),
        )
        const fila = r.routers.find((x) => x.router_id === routerId)!
        assert.isNull(fila.error)
        assert.deepEqual(fila.errores, [{ operacion: 'proxy_corte', mensaje: MENSAJE_PROXY_DEVICE_MODE }])
        assert.lengthOf(putsAcceso(), antes)
        assert.isTrue(
            falso
                .tabla('/ip/firewall/address-list')
                .some((o) => o.list === 'suspendidos' && o.address === servicio.ipv4),
        )

        // «Sincronizar con el router»: el motivo claro, nunca «no responde».
        const s = await estado(
            client.post(`/api/v1/servicios/${servicio.id}/sincronizar-router`).bearerToken(token),
            200,
        )
        assert.deepEqual(s.body().error, { motivo: 'device_mode', detalle: MENSAJE_PROXY_DEVICE_MODE })
    })

    test('un comando rechazado no aborta la reconciliación: se reporta y lo que depende de él se salta', async ({
        client,
        assert,
    }) => {
        const servicio = await crearWisp(client)
        await entregar(await suspender(servicio.id))
        falso.rechazos.set('/ip/proxy/access', 'failure: invalid local port')

        const r = await reconciliar()
        assert.isNull(r.error)
        const delProxy = r.errores.filter((e) => e.operacion.startsWith('/ip/proxy/access'))
        assert.isAbove(delProxy.length, 0)
        assert.include(delProxy[0]!.mensaje, 'invalid local port')
        // Lo que no depende del proxy sí se escribió: filtros (con el drop del 3346), lista y cola.
        assert.isDefined(falso.tabla('/ip/firewall/filter').find((o) => o.comment === REGLA_INPUT_PROXY))
        assert.isTrue(
            falso
                .tabla('/ip/firewall/address-list')
                .some((o) => o.list === 'suspendidos' && o.address === servicio.ipv4),
        )
        assert.isAbove(falso.conComment('/queue/simple', commentServicio(servicio.id)).length, 0)
        // Sin regla final, nunca el redirect al 3346 ni el proxy encendido.
        assert.isUndefined(nat(REGLA_NAT_PROXY))
        assert.notEqual(falso.proxy.enabled, 'true')
        // Cada rechazo quedó en audit.red (ok = false) y en routeros.fallido.
        const red = await db
            .from('audit.red')
            .where('router_id', routerId)
            .where('ok', false)
            .whereRaw(`comando->>'ruta' = '/ip/proxy/access'`)
        assert.isAbove(red.length, 0)
        const fallidos = await db
            .from('audit.outbox')
            .where('evento', 'routeros.fallido')
            .whereRaw(`(payload->>'router_id')::bigint = ?`, [routerId])
            .whereRaw(`payload->>'operacion' LIKE '/ip/proxy/access%'`)
        assert.isAbove(fallidos.length, 0)
        // Auditoría de la reconciliación con los errores
        const accion = await db
            .from('audit.acciones')
            .where({ accion: 'routeros.reconciliar', entidad_id: routerId })
            .orderBy('id', 'desc')
            .first()
        assert.isNotNull(accion)
    })

    test('sincronizar con un comando rechazado: dice cuál y el texto de RouterOS, nunca «no responde»', async ({
        client,
        assert,
    }) => {
        await reconciliar()
        const servicio = await crearWisp(client)
        falso.rechazos.set('/ip/proxy/access', 'failure: invalid local port')
        const ctx = contextoPrueba()
        await new CambiarEstadoServicio().execute(
            { servicioId: servicio.id, nuevo: 'suspendido', motivo: 'prueba' },
            ctx,
        )
        const s = await estado(
            client.post(`/api/v1/servicios/${servicio.id}/sincronizar-router`).bearerToken(token),
            200,
        )
        const error = s.body().error
        assert.equal(error.motivo, 'rechazado')
        assert.include(error.detalle, 'RouterOS rechazó «ip/proxy/access add»')
        assert.include(error.detalle, 'failure: invalid local port')
        assert.include(error.detalle, 'device-mode')
        assert.notInclude(error.detalle, 'no responde')
    })

    test('diagnóstico y vista previa: chequeo proxy_device_mode no reconciliable, con comandos y el paso físico', async ({
        client,
        assert,
    }) => {
        const servicio = await crearWisp(client)
        await entregar(await suspender(servicio.id))
        falso.deviceMode = { mode: 'home', proxy: 'false' }

        const d = await diagnosticoCorte(routerId, OPCIONES)
        const chequeo = d.chequeos.find((c) => c.clave === 'proxy_device_mode')
        assert.containsSubset(chequeo, {
            ok: false,
            codigo: 'proxy_device_mode',
            reconciliar: false,
            comandos: ['/system/device-mode/print', '/system/device-mode/update proxy=yes'],
        })
        assert.include(chequeo!.detalle, '5 minutos')
        assert.isUndefined(d.chequeos.find((c) => c.clave === 'proxy_corte'))
        assert.isTrue(d.problemas.some((p) => p.codigo === 'proxy_device_mode' && !p.reconciliar))

        const v = await vistaPreviaReconciliar(routerId, OPCIONES)
        assert.isTrue(v.avisos.some((a) => a.includes('device-mode')))
        assert.isFalse(v.cambios.some((c) => c.ruta === '/ip/proxy/access' && c.accion === 'crear'))
        assert.isFalse(v.cambios.some((c) => c.clave === REGLA_NAT_PROXY && c.accion === 'crear'))

        falso.deviceMode = { mode: 'advanced', proxy: 'true' }
        const bien = await diagnosticoCorte(routerId, OPCIONES)
        assert.containsSubset(
            bien.chequeos.find((c) => c.clave === 'proxy_device_mode'),
            { ok: true },
        )
    })

    test('RouterOS sin /system/device-mode (anterior a 7.13): se trata como permitido', async ({
        assert,
    }) => {
        falso.deviceMode = null
        const r = await reconciliar()
        assert.deepEqual(r.errores, [])
        assert.deepEqual(
            acceso().map((o) => o.comment),
            [REGLA_PROXY_SIN_CODIGO],
        )
    })
})

test.group('RouterOS · device-mode y diagnóstico de errores (unidad)', () => {
    test('proxyBloqueadoPorDeviceMode: campo proxy, marca de inactivo y versiones viejas', ({ assert }) => {
        assert.isTrue(proxyBloqueadoPorDeviceMode({ proxy: 'false' }, null))
        assert.isTrue(proxyBloqueadoPorDeviceMode({ proxy: 'no' }, null))
        assert.isFalse(proxyBloqueadoPorDeviceMode({ proxy: 'true' }, { enabled: 'true' }))
        assert.isFalse(proxyBloqueadoPorDeviceMode({ mode: 'enterprise' }, { enabled: 'true' }))
        assert.isFalse(proxyBloqueadoPorDeviceMode(null, null))
        assert.isTrue(proxyBloqueadoPorDeviceMode(null, { inactivated: 'true' }))
        assert.isTrue(
            proxyBloqueadoPorDeviceMode(null, { comment: 'inactivated, not allowed by device-mode' }),
        )
    })

    test('diagnosticarErrorRouterOS: rechazado con el comando, device_mode y no_responde solo si es de red', ({
        assert,
    }) => {
        const e = new RouterOSSolicitud(400, 'Bad Request', 'failure: invalid local port')
        e.operacion = 'ip/proxy/access add'
        const d = diagnosticarErrorRouterOS(e)
        assert.equal(d.motivo, 'rechazado')
        assert.include(d.detalle, 'RouterOS rechazó «ip/proxy/access add»: failure: invalid local port')
        assert.include(d.detalle, '/system/device-mode')

        const otro = diagnosticarErrorRouterOS(
            new RouterOSSolicitud(400, 'Bad Request', 'failure: already have such entry'),
        )
        assert.equal(otro.motivo, 'rechazado')
        assert.include(otro.detalle, 'already have such entry')

        assert.equal(
            diagnosticarErrorRouterOS({ message: 'inactivated, not allowed by device-mode' }).motivo,
            'device_mode',
        )
        // Solo el texto, sin tipo ni código de red: nunca «no responde».
        assert.notEqual(diagnosticarErrorRouterOS({ message: 'algo raro' }).motivo, 'no_responde')
        assert.equal(
            diagnosticarErrorRouterOS(new RouterOSInalcanzable('GET x: socket hang up', null)).motivo,
            'no_responde',
        )
        assert.equal(
            diagnosticarErrorRouterOS({ message: 'connect EHOSTUNREACH 10.0.0.1:443' }).motivo,
            'no_responde',
        )
    })
})
