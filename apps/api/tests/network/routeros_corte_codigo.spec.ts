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
    ajusteProxy,
    urlCorteConCodigo,
} from '#network/routeros/corte_router'
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
            [[REGLA_PROXY_SIN_CODIGO, PUERTO_PROXY_CORTE, 'redirect', URL_CORTE]],
        )
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
            'action-data': urlCorteConCodigo(URL_CORTE, fila!.codigo),
        })

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
