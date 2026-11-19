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
import { bitacoraRed, type OpcionesDispatcher } from '#network/routeros/dispatcher'
import { commentServicio } from '#network/routeros/estado_deseado'
import {
    PUERTO_PROXY_CORTE,
    REGLA_CORTE_IN_PROXY,
    REGLA_INPUT_PROXY,
    REGLA_NAT_HTTP,
    REGLA_NAT_PROXY,
    REGLA_PROXY_SIN_CODIGO,
    ajustePuertoProxy,
    ajusteProxy,
    actionDataRedireccion,
    configCorte,
    urlCorteConCodigo,
} from '#network/routeros/corte_router'
import AplicarRedServicio from '#network/routeros/actions/aplicar_red_servicio'
import { redis } from '#shared/redis'
import { clavePendientes } from '#network/routeros/dispatcher'
import { diagnosticoCorte } from '#network/routeros/diagnostico'
import { generarCodigoCorte, normalizarCodigoCorte } from '#portal/codigos_corte'
import type { EventoEntrante } from '#shared/eventos_bus'

/**
 * Bug del PM en producción (v1.12.0): «toma la IP del server o IP privada y no del servicio asignado».
 * El router hace masquerade hacia el portal y el portal ve su IP pública (o la de Docker detrás de NPM).
 *
 * Modo `codigo` del router (`contratos/corte-identificacion.md`): el HTTP del suspendido va al web proxy
 * del router (puerto 3346) y una regla `/ip proxy access` por servicio lo manda a `/corte?c=<código>`.
 * Aquí con Postgres real y el RouterOS falso: reconciliador, dispatcher por evento, cambio de modo,
 * IP reasignada, auditoría sin el código y el diagnóstico `portal_ip_cliente`.
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

const URL_CORTE = 'https://portal.argosisp.example/corte'
/** Lo que va en `action-data`: sin esquema (RouterOS antepone `http://`; bug v1.19.0 del PM). */
const URL_CORTE_PROXY = 'portal.argosisp.example/corte'

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

test.group('RouterOS · corte por código (proxy del router)', (group) => {
    let falso: RouterOSFalso
    let token: string
    let routerId: number
    let base: string
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
        base = esc.base
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

    async function cambiarEstado(servicioId: number, nuevo: 'activo' | 'suspendido') {
        const ctx = contextoPrueba()
        await new CambiarEstadoServicio().execute({ servicioId, nuevo, motivo: 'prueba' }, ctx)
        return eventosDe(ctx.requestId)
    }

    const reconciliar = () =>
        new ReconciliarRouterOS(OPCIONES).execute({ router_id: routerId, motivo: 'manual' }, contextoPrueba())
    const acceso = () => falso.tabla('/ip/proxy/access').filter((o) => o.dynamic !== 'true')
    /** Posición de la primera escritura que cumple `cumple` en `falso.escrituras` (-1 si no hay). */
    const posicion = (
        cumple: (p: { metodo: string; ruta: string; cuerpo: Record<string, string> | null }) => boolean,
    ) => falso.escrituras.findIndex(cumple)
    const esProxySet = (p: { ruta: string }) => p.ruta === '/rest/ip/proxy/set'
    const esPutAcceso = (p: { metodo: string; ruta: string }) =>
        p.metodo === 'PUT' && p.ruta === '/rest/ip/proxy/access'
    const esPut =
        (ruta: string, comment: string) =>
        (p: { metodo: string; ruta: string; cuerpo: Record<string, string> | null }) =>
            p.metodo === 'PUT' && p.ruta === `/rest${ruta}` && p.cuerpo?.comment === comment
    const esDelete = (ruta: string, id: string) => (p: { metodo: string; ruta: string }) =>
        p.metodo === 'DELETE' && p.ruta === `/rest${ruta}/${encodeURIComponent(id)}`
    const codigoDe = async (servicioId: number) =>
        (await db
            .from('core.codigos_corte')
            .where('servicio_id', servicioId)
            .orderBy('id', 'desc')
            .first()) as {
            codigo: string
            cerrado_en: Date | null
        } | null

    test('reconciliar en modo código: proxy, NAT al proxy, regla final y nada de dst-nat al portal', async ({
        assert,
    }) => {
        const r = await reconciliar()
        assert.isNull(r.error)
        assert.containsSubset(falso.proxy, {
            enabled: 'true',
            port: PUERTO_PROXY_CORTE,
            'max-cache-size': 'none',
        })
        const nat = falso.tabla('/ip/firewall/nat')
        assert.containsSubset(
            nat.find((o) => o.comment === REGLA_NAT_PROXY),
            {
                chain: 'argos-corte-nat',
                protocol: 'tcp',
                'dst-port': '80',
                action: 'redirect',
                'to-ports': PUERTO_PROXY_CORTE,
            },
        )
        assert.isUndefined(nat.find((o) => o.comment === REGLA_NAT_HTTP))
        // IPv6 también al proxy (no hace falta la IPv6 del portal)
        assert.isDefined(falso.tabla('/ipv6/firewall/nat').find((o) => o.comment === REGLA_NAT_PROXY))
        const filtro = falso.tabla('/ip/firewall/filter')
        assert.containsSubset(
            filtro.find((o) => o.comment === REGLA_INPUT_PROXY),
            {
                chain: 'input',
                'dst-port': PUERTO_PROXY_CORTE,
                'connection-nat-state': '!dstnat',
                action: 'drop',
            },
        )
        const comentarios = filtro.map((o) => o.comment)
        assert.isBelow(
            comentarios.indexOf(REGLA_CORTE_IN_PROXY),
            comentarios.indexOf('argosisp: corte-in TCP reset'),
        )
        assert.deepEqual(
            acceso().map((o) => [o.comment, o['local-port'], o.action, o['action-data']]),
            [[REGLA_PROXY_SIN_CODIGO, PUERTO_PROXY_CORTE, 'redirect', URL_CORTE_PROXY]],
        )
        // El 307 que vería el navegador (como RouterOS: antepone `http://`) va a la página por HTTP
        assert.equal(falso.redireccionProxy('10.10.0.99'), `http://${URL_CORTE_PROXY}`)
        // Segunda pasada: nada que corregir
        const otra = await reconciliar()
        assert.lengthOf(otra.correcciones, 0, JSON.stringify(otra.correcciones))
    })

    test('suspender por evento: código nuevo, regla del servicio antes de la final, evento sin el código', async ({
        client,
        assert,
    }) => {
        await reconciliar()
        const servicio = await crearWisp(client)
        const eventos = await cambiarEstado(servicio.id, 'suspendido')
        await entregar(eventos)

        const fila = await codigoDe(servicio.id)
        assert.isNotNull(fila)
        assert.equal(normalizarCodigoCorte(fila!.codigo), fila!.codigo)
        assert.isNull(fila!.cerrado_en)
        const reglas = acceso()
        assert.deepEqual(
            reglas.map((o) => o.comment),
            [commentServicio(servicio.id), REGLA_PROXY_SIN_CODIGO],
        )
        assert.containsSubset(reglas[0], {
            'local-port': PUERTO_PROXY_CORTE,
            'src-address': servicio.ipv4,
            action: 'redirect',
            'action-data': actionDataRedireccion(urlCorteConCodigo(URL_CORTE, fila!.codigo)),
        })
        assert.notMatch(reglas[0]!['action-data']!, /^https?:/i)
        assert.equal(falso.redireccionProxy(servicio.ipv4), `http://${URL_CORTE_PROXY}?c=${fila!.codigo}`)

        // El evento sale por outbox y nunca lleva el código
        const emitido = await db
            .from('audit.outbox')
            .where('evento', 'portal.codigo_corte_emitido')
            .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [servicio.id])
        assert.lengthOf(emitido, 1)
        assert.containsSubset(emitido[0]!.payload, { servicio_id: servicio.id, router_id: routerId })
        assert.notInclude(JSON.stringify(emitido[0]!.payload), fila!.codigo)
        // audit.red: el comando quedó, con el código enmascarado
        const red = await db.from('audit.red').where('servicio_id', servicio.id).where('tipo', 'routeros')
        assert.isTrue(red.some((f) => f.comando.ruta === '/ip/proxy/access'))
        assert.notInclude(JSON.stringify(red), fila!.codigo)

        // Evento repetido: mismo código, nada nuevo en el router
        const antes = falso.escrituras.length
        await entregar(eventos)
        assert.equal((await codigoDe(servicio.id))!.codigo, fila!.codigo)
        assert.equal(falso.escrituras.length, antes)
    })

    test('reactivar: la regla se borra y el código se cierra (sigue resolviendo en la gracia)', async ({
        client,
        assert,
    }) => {
        await reconciliar()
        const servicio = await crearWisp(client)
        await entregar(await cambiarEstado(servicio.id, 'suspendido'))
        assert.lengthOf(acceso(), 2)
        await entregar(await cambiarEstado(servicio.id, 'activo'))
        assert.deepEqual(
            acceso().map((o) => o.comment),
            [REGLA_PROXY_SIN_CODIGO],
        )
        assert.isNotNull((await codigoDe(servicio.id))!.cerrado_en)

        // Nueva suspensión: código nuevo (uno por suspensión)
        const primero = (await codigoDe(servicio.id))!.codigo
        await entregar(await cambiarEstado(servicio.id, 'suspendido'))
        const segundo = (await codigoDe(servicio.id))!.codigo
        assert.notEqual(segundo, primero)
    })

    test('suspendido antes del cambio a código: el reconciliador le da su código y su regla', async ({
        client,
        assert,
    }) => {
        await db.from('network.routers').where('id', routerId).update({ corte_identificacion: 'ip' })
        const servicio = await crearWisp(client)
        await entregar(await cambiarEstado(servicio.id, 'suspendido'))
        assert.isNull(await codigoDe(servicio.id))
        assert.lengthOf(acceso(), 0)

        await db.from('network.routers').where('id', routerId).update({ corte_identificacion: 'codigo' })
        await reconciliar()
        const fila = await codigoDe(servicio.id)
        assert.isNotNull(fila)
        assert.deepEqual(
            acceso().map((o) => o.comment),
            [commentServicio(servicio.id), REGLA_PROXY_SIN_CODIGO],
        )
    })

    test('volver a modo ip: se quitan el proxy, las reglas por servicio y vuelve el dst-nat', async ({
        client,
        assert,
    }) => {
        await reconciliar()
        const servicio = await crearWisp(client)
        await entregar(await cambiarEstado(servicio.id, 'suspendido'))
        assert.lengthOf(acceso(), 2)

        await db.from('network.routers').where('id', routerId).update({ corte_identificacion: 'ip' })
        const r = await reconciliar()
        assert.isNull(r.error)
        assert.lengthOf(acceso(), 0)
        assert.equal(falso.proxy.enabled, 'false')
        const nat = falso.tabla('/ip/firewall/nat')
        assert.isUndefined(nat.find((o) => o.comment === REGLA_NAT_PROXY))
        assert.containsSubset(
            nat.find((o) => o.comment === REGLA_NAT_HTTP),
            {
                action: 'dst-nat',
                'to-addresses': '192.0.2.20',
            },
        )
        assert.isUndefined(falso.tabla('/ip/firewall/filter').find((o) => o.comment === REGLA_INPUT_PROXY))
    })

    test('proxy del operador: solo se agrega el puerto del corte y se respeta lo suyo', async ({
        assert,
    }) => {
        falso.proxy = { enabled: 'true', port: '8080', 'max-cache-size': 'unlimited' }
        falso.tabla('/ip/proxy/access').push({
            '.id': '*AA',
            action: 'deny',
            'dst-host': '*.ejemplo.test',
            comment: 'del operador',
            dynamic: 'false',
            disabled: 'false',
        })
        await reconciliar()
        assert.deepEqual(falso.proxy, {
            enabled: 'true',
            port: `8080,${PUERTO_PROXY_CORTE}`,
            'max-cache-size': 'unlimited',
        })
        // Lo del corte primero; la regla del operador queda, después
        assert.deepEqual(
            acceso().map((o) => o.comment),
            [REGLA_PROXY_SIN_CODIGO, 'del operador'],
        )
        // Al volver a ip solo se quita el puerto del corte; el proxy sigue encendido
        await db.from('network.routers').where('id', routerId).update({ corte_identificacion: 'ip' })
        await reconciliar()
        assert.deepEqual(falso.proxy, { enabled: 'true', port: '8080', 'max-cache-size': 'unlimited' })
        assert.deepEqual(
            acceso().map((o) => o.comment),
            ['del operador'],
        )
    })

    test('IP reasignada: la regla vieja de otro servicio con la misma src-address se borra', async ({
        client,
        assert,
    }) => {
        await reconciliar()
        const servicio = await crearWisp(client)
        // Regla huérfana de otro servicio (reactivado con el router caído) con la misma IP, antes en la tabla
        falso.tabla('/ip/proxy/access').unshift({
            '.id': '*BB',
            'local-port': PUERTO_PROXY_CORTE,
            'src-address': servicio.ipv4,
            action: 'redirect',
            'action-data': `${URL_CORTE}?c=${generarCodigoCorte()}`,
            comment: commentServicio(999999),
            dynamic: 'false',
            disabled: 'false',
        })
        await entregar(await cambiarEstado(servicio.id, 'suspendido'))
        const reglas = acceso()
        assert.deepEqual(
            reglas.map((o) => o.comment),
            [commentServicio(servicio.id), REGLA_PROXY_SIN_CODIGO],
        )
    })

    test('sin URL del portal: la regla final niega (nunca un 3346 que reenvíe a internet)', async ({
        assert,
    }) => {
        delete process.env.PORTAL_URL_PUBLICA
        delete process.env.ROUTERS_SERVICIO_PORTAL_V4
        delete process.env.ROUTERS_SERVICIO_PORTAL_FQDN
        const r = await reconciliar()
        assert.isNull(r.error)
        assert.deepEqual(
            acceso().map((o) => [o.comment, o['local-port'], o.action]),
            [[REGLA_PROXY_SIN_CODIGO, PUERTO_PROXY_CORTE, 'deny']],
        )
        assert.isTrue(r.avisos.some((a) => a.includes('deny')))
        assert.equal(falso.proxy.enabled, 'true')

        // Si alguien la borra, el diagnóstico lo marca en rojo y «Reconciliar» la repone
        falso.borrarAMano('/ip/proxy/access', (o) => o.comment === REGLA_PROXY_SIN_CODIGO)
        const d = await diagnosticoCorte(routerId, OPCIONES)
        const chequeo = d.chequeos.find((c) => c.clave === 'proxy_corte')!
        assert.isFalse(chequeo.ok)
        assert.include(chequeo.detalle, 'falta la regla final')
        await reconciliar()
        assert.equal(acceso()[0]?.action, 'deny')

        // Con URL otra vez, la misma regla pasa a redirigir
        process.env.PORTAL_URL_PUBLICA = ENTORNO.PORTAL_URL_PUBLICA
        await reconciliar()
        assert.containsSubset(acceso()[0], { action: 'redirect', 'action-data': URL_CORTE_PROXY })
    })

    test('action-data sin esquema: sin distinguir mayúsculas y con puerto (unidad)', ({ assert }) => {
        assert.equal(
            actionDataRedireccion('https://portal.isp.gt/corte?c=K7M2'),
            'portal.isp.gt/corte?c=K7M2',
        )
        assert.equal(actionDataRedireccion('HTTPS://portal.isp.gt/corte'), 'portal.isp.gt/corte')
        assert.equal(actionDataRedireccion('Http://192.0.2.20:8088/corte'), '192.0.2.20:8088/corte')
        assert.equal(actionDataRedireccion('portal.isp.gt/corte'), 'portal.isp.gt/corte')
        // La URL que se pasa al script del router (`corte_url`) sale de `new URL`: esquema siempre en
        // minúsculas, así que el `:pick … = "https://"` del .rsc (A6) la reconoce aunque se configure `HTTPS://`.
        assert.equal(
            configCorte({ PORTAL_URL_PUBLICA: 'HTTPS://Portal.ISP.gt' }).corte_url,
            'https://portal.isp.gt/corte',
        )
    })

    test('reglas viejas con esquema (v1.19.0): el diagnóstico lo detecta y «Reconciliar» las corrige una vez', async ({
        client,
        assert,
    }) => {
        await reconciliar()
        const servicio = await crearWisp(client)
        await entregar(await cambiarEstado(servicio.id, 'suspendido'))
        const fila = (await codigoDe(servicio.id))!
        // Como las dejó v1.19.0: la URL completa en `action-data`
        for (const o of acceso()) {
            o['action-data'] =
                o.comment === REGLA_PROXY_SIN_CODIGO ? URL_CORTE : urlCorteConCodigo(URL_CORTE, fila.codigo)
        }
        // Lo que ve el cliente: el host «https» (el bug del PM)
        assert.equal(
            falso.redireccionProxy(servicio.ipv4),
            `http://https//${URL_CORTE_PROXY}?c=${fila.codigo}`,
        )
        assert.equal(falso.redireccionProxy('10.10.0.99'), `http://https//${URL_CORTE_PROXY}`)

        let d = await diagnosticoCorte(routerId, OPCIONES)
        const chequeo = d.chequeos.find((c) => c.clave === 'proxy_corte')!
        assert.isFalse(chequeo.ok)
        assert.include(chequeo.detalle, '2 reglas tienen action-data con esquema')
        assert.include(chequeo.detalle, 'http://https//')
        assert.isTrue(chequeo.reconciliar)

        const r = await reconciliar()
        assert.isNull(r.error)
        assert.deepEqual(
            acceso().map((o) => o['action-data']),
            [`${URL_CORTE_PROXY}?c=${fila.codigo}`, URL_CORTE_PROXY],
        )
        assert.equal(falso.redireccionProxy(servicio.ipv4), `http://${URL_CORTE_PROXY}?c=${fila.codigo}`)
        // Y no vuelve a marcarlas en cada pasada
        const otra = await reconciliar()
        assert.lengthOf(otra.correcciones, 0, JSON.stringify(otra.correcciones))
        d = await diagnosticoCorte(routerId, OPCIONES)
        assert.isTrue(d.chequeos.find((c) => c.clave === 'proxy_corte')!.ok)
    })

    test('regla del operador antes de las del corte: se mueve detrás y el diagnóstico lo detecta', async ({
        client,
        assert,
    }) => {
        await reconciliar()
        const servicio = await crearWisp(client)
        await entregar(await cambiarEstado(servicio.id, 'suspendido'))
        // El operador pone arriba un `allow` sin `local-port`: ganaría en el 3346 (primera que coincide)
        falso.tabla('/ip/proxy/access').unshift({
            '.id': '*CC',
            action: 'allow',
            'dst-host': '*',
            comment: 'permitir todo (operador)',
            dynamic: 'false',
            disabled: 'false',
        })
        let d = await diagnosticoCorte(routerId, OPCIONES)
        const chequeo = d.chequeos.find((c) => c.clave === 'proxy_corte')!
        assert.isFalse(chequeo.ok)
        assert.include(chequeo.detalle, 'antes de las del corte')
        await reconciliar()
        assert.deepEqual(
            acceso().map((o) => o.comment),
            [commentServicio(servicio.id), REGLA_PROXY_SIN_CODIGO, 'permitir todo (operador)'],
        )
        d = await diagnosticoCorte(routerId, OPCIONES)
        assert.isTrue(d.chequeos.find((c) => c.clave === 'proxy_corte')!.ok)
    })

    test('router nuevo en código con el proxy apagado: drop de input, puerto sin encender, reglas, NAT y al final encender', async ({
        assert,
    }) => {
        // Bug v1.16.0 del PM: `failure: invalid local port` si la regla va antes que el puerto
        const r = await reconciliar()
        assert.isNull(r.error)
        const drop = posicion(esPut('/ip/firewall/filter', REGLA_INPUT_PROXY))
        const sets = falso.escrituras.filter(esProxySet)
        assert.deepEqual(
            sets.map((p) => p.cuerpo),
            [
                { port: PUERTO_PROXY_CORTE, 'max-cache-size': 'none' },
                { enabled: 'yes', port: PUERTO_PROXY_CORTE, 'max-cache-size': 'none' },
            ],
        )
        const puerto = posicion(esProxySet)
        const regla = posicion(esPutAcceso)
        const nat = posicion(esPut('/ip/firewall/nat', REGLA_NAT_PROXY))
        const encender = falso.escrituras.findIndex((p) => esProxySet(p) && p.cuerpo?.enabled === 'yes')
        assert.isAbove(drop, -1)
        assert.isBelow(drop, puerto)
        assert.isBelow(puerto, regla)
        assert.isBelow(regla, nat)
        assert.isBelow(nat, encender)
        assert.containsSubset(falso.proxy, { enabled: 'true', port: PUERTO_PROXY_CORTE })
    })

    test('proxy del operador encendido en 8080: el puerto se agrega con el drop puesto y antes de la regla final y del NAT', async ({
        assert,
    }) => {
        falso.proxy = { enabled: 'true', port: '8080', 'max-cache-size': 'unlimited' }
        const r = await reconciliar()
        assert.isNull(r.error)
        const sets = falso.escrituras.filter(esProxySet)
        // Un solo cambio: el puerto; nunca se toca `enabled` ni la caché del operador
        assert.deepEqual(
            sets.map((p) => p.cuerpo),
            [{ port: `8080,${PUERTO_PROXY_CORTE}` }],
        )
        const drop = posicion(esPut('/ip/firewall/filter', REGLA_INPUT_PROXY))
        const puerto = posicion(esProxySet)
        const regla = posicion(esPutAcceso)
        const nat = posicion(esPut('/ip/firewall/nat', REGLA_NAT_PROXY))
        assert.isBelow(drop, puerto)
        assert.isBelow(puerto, regla)
        assert.isBelow(regla, nat)
    })

    test('volver a ip: NAT, reglas del 3346, puerto y por último el drop de input', async ({
        client,
        assert,
    }) => {
        await reconciliar()
        const servicio = await crearWisp(client)
        await entregar(await cambiarEstado(servicio.id, 'suspendido'))
        const idDe = (ruta: Parameters<typeof falso.tabla>[0], comment: string) =>
            falso.tabla(ruta).find((o) => o.comment === comment)!['.id']
        const natId = idDe('/ip/firewall/nat', REGLA_NAT_PROXY)
        const finalId = idDe('/ip/proxy/access', REGLA_PROXY_SIN_CODIGO)
        const servicioId = idDe('/ip/proxy/access', commentServicio(servicio.id))
        const dropId = idDe('/ip/firewall/filter', REGLA_INPUT_PROXY)
        const antes = falso.escrituras.length

        await db.from('network.routers').where('id', routerId).update({ corte_identificacion: 'ip' })
        const r = await reconciliar()
        assert.isNull(r.error)
        const despues = (cumple: (p: any) => boolean) => falso.escrituras.slice(antes).findIndex(cumple)
        const nat = despues(esDelete('/ip/firewall/nat', natId))
        const final = despues(esDelete('/ip/proxy/access', finalId))
        const delServicio = despues(esDelete('/ip/proxy/access', servicioId))
        const puerto = despues(esProxySet)
        const drop = despues(esDelete('/ip/firewall/filter', dropId))
        assert.isAbove(nat, -1)
        assert.isBelow(nat, final)
        assert.isBelow(nat, delServicio)
        assert.isBelow(final, puerto)
        assert.isBelow(delServicio, puerto)
        assert.isBelow(puerto, drop)
        assert.containsSubset(falso.proxy, { enabled: 'false', port: '8080' })
        assert.lengthOf(acceso(), 0)
    })

    test('suspender por evento con el router sin el 3346: sin error, aviso, router pendiente y la regla al reconciliar', async ({
        client,
        assert,
    }) => {
        await redis().del(clavePendientes())
        // Sin reconciliar: el router está en código pero el proxy no tiene el puerto del corte
        const servicio = await crearWisp(client)
        // El cambio de estado sin entregar sus eventos: la acción del dispatcher se corre a mano
        await cambiarEstado(servicio.id, 'suspendido')
        const r = await new AplicarRedServicio(OPCIONES).execute(
            { servicio_id: servicio.id, evento: 'servicio.estado_cambiado' },
            contextoPrueba(),
        )
        const fila = r.routers.find((x) => x.router_id === routerId)!
        assert.isNull(fila.error)
        assert.isTrue(fila.avisos.some((a) => a.includes(PUERTO_PROXY_CORTE)))
        assert.lengthOf(acceso(), 0)
        assert.isFalse(falso.escrituras.some(esPutAcceso))
        assert.include(await redis().smembers(clavePendientes()), String(routerId))

        await reconciliar()
        assert.deepEqual(
            acceso().map((o) => o.comment),
            [commentServicio(servicio.id), REGLA_PROXY_SIN_CODIGO],
        )
        // Con el corte armado, la siguiente suspensión por evento escribe su regla en el acto
        await entregar(await cambiarEstado(servicio.id, 'activo'))
        assert.deepEqual(
            acceso().map((o) => o.comment),
            [REGLA_PROXY_SIN_CODIGO],
        )
        await entregar(await cambiarEstado(servicio.id, 'suspendido'))
        assert.deepEqual(
            acceso().map((o) => o.comment),
            [commentServicio(servicio.id), REGLA_PROXY_SIN_CODIGO],
        )
    })

    test('el falso valida como RouterOS: local-port fuera de /ip proxy port es invalid local port', async ({
        assert,
    }) => {
        const auth = `Basic ${Buffer.from(`${falso.usuario}:${falso.password}`).toString('base64')}`
        const pedir = (metodo: string, ruta: string, cuerpo: Record<string, string>) =>
            fetch(`${falso.url}/rest${ruta}`, {
                method: metodo,
                headers: { authorization: auth, 'content-type': 'application/json' },
                body: JSON.stringify(cuerpo),
            })
        const regla = { 'local-port': PUERTO_PROXY_CORTE, action: 'deny', comment: 'prueba' }
        let r = await pedir('PUT', '/ip/proxy/access', regla)
        assert.equal(r.status, 400)
        assert.include(await r.text(), 'invalid local port')
        // Con el puerto agregado (proxy apagado) sí la acepta
        r = await pedir('POST', '/ip/proxy/set', { port: PUERTO_PROXY_CORTE })
        assert.equal(r.status, 200)
        r = await pedir('PUT', '/ip/proxy/access', regla)
        assert.equal(r.status, 201)
        assert.equal(falso.proxy.enabled, 'false')
        // Quitar el puerto con una regla que lo usa: rechazado
        r = await pedir('POST', '/ip/proxy/set', { port: '8080' })
        assert.equal(r.status, 400)
    })

    test('ajusteProxy: encender, agregar puerto, quitar y apagar', ({ assert }) => {
        assert.deepEqual(ajusteProxy({ enabled: 'false', port: '8080' }, true), {
            enabled: 'yes',
            port: PUERTO_PROXY_CORTE,
            'max-cache-size': 'none',
        })
        assert.deepEqual(ajusteProxy({ enabled: 'true', port: '8080' }, true), {
            port: `8080,${PUERTO_PROXY_CORTE}`,
        })
        assert.isNull(ajusteProxy({ enabled: 'true', port: `8080,${PUERTO_PROXY_CORTE}` }, true))
        // Primer paso: el puerto sin encender
        assert.deepEqual(ajustePuertoProxy({ enabled: 'false', port: '8080' }), {
            port: PUERTO_PROXY_CORTE,
            'max-cache-size': 'none',
        })
        assert.deepEqual(ajustePuertoProxy({ enabled: 'true', port: '8080' }), {
            port: `8080,${PUERTO_PROXY_CORTE}`,
        })
        assert.isNull(ajustePuertoProxy({ enabled: 'false', port: PUERTO_PROXY_CORTE }))
        assert.deepEqual(ajusteProxy({ enabled: 'false', port: PUERTO_PROXY_CORTE }, true), {
            enabled: 'yes',
            port: PUERTO_PROXY_CORTE,
            'max-cache-size': 'none',
        })
        assert.isNull(ajusteProxy({ enabled: 'false', port: '8080' }, false))
        assert.deepEqual(ajusteProxy({ enabled: 'true', port: PUERTO_PROXY_CORTE }, false), {
            enabled: 'no',
            port: '8080',
        })
        assert.deepEqual(ajusteProxy({ enabled: 'true', port: `8080,${PUERTO_PROXY_CORTE}` }, false), {
            port: '8080',
        })
    })

    test('editar el router: codigo sin API es 422; con API emite portal.config_cambiada con router_id', async ({
        client,
        assert,
    }) => {
        const sinApi = await crearEscenarioRouter()
        const vista = await estado(client.get(`/api/v1/routers/${sinApi.routerId}`).bearerToken(token), 200)
        const r = await client
            .put(`/api/v1/routers/${sinApi.routerId}`)
            .bearerToken(token)
            .json({ version: vista.body().version, corte_identificacion: 'codigo' })
        r.assertStatus(422)
        assert.equal(r.body().errors[0].field, 'corte_identificacion')

        await db.from('network.routers').where('id', routerId).update({ corte_identificacion: 'ip' })
        const actual = await estado(client.get(`/api/v1/routers/${routerId}`).bearerToken(token), 200)
        assert.equal(actual.body().corte_identificacion, 'ip')
        const requestId = unico('req')
        const ok = await estado(
            client
                .put(`/api/v1/routers/${routerId}`)
                .bearerToken(token)
                .header('X-Request-Id', requestId)
                .json({ version: actual.body().version, corte_identificacion: 'codigo' }),
            200,
        )
        assert.equal(ok.body().corte_identificacion, 'codigo')
        const eventos = await eventosDe(requestId)
        const evento = eventos.find((e) => e.evento === 'portal.config_cambiada')
        assert.deepEqual(evento?.payload, {
            empresa_id: null,
            campos: ['corte_identificacion'],
            router_id: routerId,
        })
        const cambios = await db
            .from('audit.cambios')
            .where('entidad_tipo', 'router')
            .where('entidad_id', routerId)
            .where('campo', 'corte_identificacion')
        assert.lengthOf(cambios, 1)

        // El evento reconcilia solo ese router: deja el proxy de corte
        await entregar(eventos)
        assert.equal(falso.proxy.enabled, 'true')

        // Quitar la clave de la API con modo código: 422
        const otra = await estado(client.get(`/api/v1/routers/${routerId}`).bearerToken(token), 200)
        const quitar = await client
            .put(`/api/v1/routers/${routerId}`)
            .bearerToken(token)
            .json({ version: otra.body().version, quitar_api_password: true })
        quitar.assertStatus(422)
    })

    test('diagnóstico: el portal ve la IP pública del router (masquerade)', async ({ assert }) => {
        await reconciliar()
        const gateway = `${base}.1`
        // Con masquerade: el portal ve la IP pública del router
        falso.eco = () => JSON.stringify({ ip: '203.0.113.7', infraestructura: null })
        let d = await diagnosticoCorte(routerId, OPCIONES)
        let chequeo = d.chequeos.find((c) => c.clave === 'portal_ip_cliente')!
        assert.isTrue(chequeo.ok, chequeo.detalle)
        assert.include(chequeo.detalle, '203.0.113.7')
        assert.include(chequeo.detalle, 'código')
        const pedido = falso.peticiones.find(
            (p) => p.ruta === '/rest/tool/fetch' && p.cuerpo?.output === 'user',
        )
        assert.containsSubset(pedido?.cuerpo, {
            url: 'https://portal.argosisp.example/api/v1/portal/eco-ip',
            'src-address': gateway,
        })
        assert.isTrue(d.chequeos.find((c) => c.clave === 'proxy_corte')!.ok)

        // El mismo router en modo ip: rojo, con la acción a seguir
        await db.from('network.routers').where('id', routerId).update({ corte_identificacion: 'ip' })
        await reconciliar()
        d = await diagnosticoCorte(routerId, OPCIONES)
        chequeo = d.chequeos.find((c) => c.clave === 'portal_ip_cliente')!
        assert.isFalse(chequeo.ok)
        assert.equal(chequeo.codigo, 'portal_ve_otra_ip')
        assert.include(chequeo.detalle, 'Identificación por código')
        assert.isTrue(d.problemas.some((p) => p.codigo === 'portal_ve_otra_ip'))
        assert.isUndefined(d.chequeos.find((c) => c.clave === 'proxy_corte'))

        // Sin NAT (túnel, ruta privada): el portal ve el gateway → verde
        falso.eco = (src) => JSON.stringify({ ip: src, infraestructura: null })
        d = await diagnosticoCorte(routerId, OPCIONES)
        assert.isTrue(d.chequeos.find((c) => c.clave === 'portal_ip_cliente')!.ok)
    })

    test('diagnóstico en modo código: un suspendido sin su regla es rojo y «Reconciliar» lo arregla', async ({
        client,
        assert,
    }) => {
        await reconciliar()
        const servicio = await crearWisp(client)
        await entregar(await cambiarEstado(servicio.id, 'suspendido'))
        falso.borrarAMano('/ip/proxy/access', (o) => o.comment === commentServicio(servicio.id))
        let d = await diagnosticoCorte(routerId, OPCIONES)
        const chequeo = d.chequeos.find((c) => c.clave === 'proxy_corte')!
        assert.isFalse(chequeo.ok)
        assert.isTrue(chequeo.reconciliar)
        assert.include(chequeo.detalle, String(servicio.id))
        await reconciliar()
        d = await diagnosticoCorte(routerId, OPCIONES)
        assert.isTrue(d.chequeos.find((c) => c.clave === 'proxy_corte')!.ok)
    })
})
