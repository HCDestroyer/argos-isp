import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar, claveDesdeTexto } from '#shared/cifrado'
import env from '#start/env'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'
import { RouterOSFalso } from '#network/routeros/falso'
import { clienteDeRouter } from '#network/routeros/router'
import { ConsumidorRouterOS } from '#network/routeros/consumidor'
import ReconciliarRouterOS from '#network/routeros/actions/reconciliar_router'
import { bitacoraRed, type OpcionesDispatcher } from '#network/routeros/dispatcher'
import { planesDeRouter, servicioRed } from '#network/routeros/consultas'
import { commentServicio, RUTAS_SERVICIO } from '#network/routeros/estado_deseado'
import type { EventoEntrante } from '#shared/eventos_bus'

/**
 * Servicio `pendiente_instalacion` en el dispatcher de RouterOS (`contratos/instalacion.md` §3):
 * `routeros.aplicar_servicio` y `routeros.reconciliar` no crean cola, address-list, lease ni ARP
 * mientras está pendiente, y los crean con `servicio.estado_cambiado` (`motivo: instalacion`) al
 * activarse por `POST /servicios/:id/activar-instalacion`.
 */

const MAC = 'AA:BB:CC:00:44:55'

const OPCIONES: OpcionesDispatcher = {
    clientes: (router) =>
        clienteDeRouter(router, {
            clave: claveDesdeTexto(env.get('AAA_PPP_KEY')),
            bitacora: bitacoraRed,
            timeoutMs: 500,
            reintentos: 3,
            esperaMs: 5,
        }),
    red: { interfaz_clientes: 'ether-clientes', dhcp_servidor: 'dhcp-clientes' },
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
    const consumidor = new ConsumidorRouterOS(OPCIONES)
    for (const e of eventos) if (consumidor.acepta(e.evento)) await consumidor.procesar(e)
}

test.group('RouterOS · servicio pendiente de instalación', (group) => {
    let falso: RouterOSFalso
    let token: string
    let routerId: number
    let planId: number
    let clienteId: number

    group.each.setup(async () => {
        falso = new RouterOSFalso()
        await falso.levantar()
        ;({ token } = await usuarioConRoles(['soporte']))
        const esc = await crearEscenarioRouter()
        routerId = esc.routerId
        await db
            .from('network.routers')
            .where('id', routerId)
            .update({ host: falso.url, api_usuario: falso.usuario, api_password: cifrar(falso.password) })
        planId = await crearPlanFila({
            bajada_kbps: 20000,
            subida_kbps: 5000,
            bajada_limitada_kbps: 2000,
            subida_limitada_kbps: 1000,
        })
        clienteId = await crearClienteFila()
        return () => falso.cerrar()
    })

    async function crearPendiente(client: any, cuerpo: Record<string, unknown>) {
        const requestId = unico('req')
        const r = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .header('X-Request-Id', requestId)
                .json({
                    plantilla_facturacion_id: null,
                    cliente_id: clienteId,
                    router_id: routerId,
                    plan_id: planId,
                    estado_inicial: 'pendiente_instalacion',
                    ...cuerpo,
                }),
            201,
        )
        return { servicio: r.body(), eventos: await eventosDe(requestId) }
    }

    async function activar(client: any, servicio: { id: number; version: number }) {
        const requestId = unico('req')
        await estado(
            client
                .post(`/api/v1/servicios/${servicio.id}/activar-instalacion`)
                .bearerToken(token)
                .header('X-Request-Id', requestId)
                .header('Idempotency-Key', unico('iris:instalacion'))
                .json({ version: servicio.version, origen_tipo: 'iris_orden', origen_id: 'orden-1' }),
            200,
        )
        return eventosDe(requestId)
    }

    const objetos = (id: number) =>
        Object.fromEntries(
            RUTAS_SERVICIO.map((ruta) => [ruta, falso.conComment(ruta, commentServicio(id)).length]),
        )

    test('dhcp_fija con amarre: nada en el router mientras está pendiente; al activar, cola, lease y ARP', async ({
        client,
        assert,
    }) => {
        const { servicio, eventos } = await crearPendiente(client, {
            tipo_conexion: 'dhcp_fija',
            mac: MAC,
            amarre_ip_mac: true,
        })
        assert.equal(servicio.estado, 'pendiente_instalacion')
        assert.isString(servicio.ipv4, 'el pendiente ya tiene IP asignada (IPAM)')
        assert.isTrue(eventos.some((e) => e.evento === 'servicio.creado'))
        await entregar(eventos)
        assert.equal(falso.escrituras.length, 0)
        assert.deepEqual(objetos(servicio.id), {
            '/queue/simple': 0,
            '/ip/firewall/address-list': 0,
            '/ipv6/firewall/address-list': 0,
            '/ip/dhcp-server/lease': 0,
            '/ip/arp': 0,
        })
        // Sin cambios no deja fila (regla 9: estado deseado sin cambios)
        const sinFila = await db
            .from('audit.acciones')
            .where('accion', 'routeros.aplicar_servicio')
            .where('entidad_id', servicio.id)
        assert.lengthOf(sinFila, 0)

        const activacion = await activar(client, servicio)
        const cambio = activacion.find((e) => e.evento === 'servicio.estado_cambiado')
        assert.containsSubset(cambio?.payload, {
            de: 'pendiente_instalacion',
            a: 'activo',
            motivo: 'instalacion',
        })
        await entregar(activacion)

        const comment = commentServicio(servicio.id)
        assert.containsSubset(falso.conComment('/queue/simple', comment), [
            { name: `argosisp-servicio-${servicio.id}`, target: `${servicio.ipv4}/32` },
        ])
        assert.containsSubset(falso.conComment('/ip/dhcp-server/lease', comment), [
            { address: servicio.ipv4, 'mac-address': MAC, server: 'dhcp-clientes' },
        ])
        assert.containsSubset(falso.conComment('/ip/arp', comment), [
            { address: servicio.ipv4, 'mac-address': MAC, interface: 'ether-clientes' },
        ])
        assert.lengthOf(falso.conComment('/ip/firewall/address-list', comment), 0)
        const red = await db.from('audit.red').where('servicio_id', servicio.id).where('tipo', 'routeros')
        assert.isAtLeast(red.length, 3)
        assert.isTrue(red.every((f) => f.ok))
    })

    test('reconciliar: no crea nada para un pendiente y borra lo que encuentre suyo; tras activar, lo repone', async ({
        client,
        assert,
    }) => {
        const { servicio, eventos } = await crearPendiente(client, { tipo_conexion: 'ip_estatica' })
        await entregar(eventos)
        // Algo suyo que quedó en el router (puesto a mano o de antes): el reconciliador lo trata como huérfano.
        falso.tabla('/ip/firewall/address-list').push({
            '.id': '*FFA1',
            list: 'suspendidos',
            address: servicio.ipv4,
            comment: commentServicio(servicio.id),
        })

        const r = await new ReconciliarRouterOS(OPCIONES).execute(
            { router_id: routerId, motivo: 'manual' },
            contextoPrueba(),
        )
        assert.isNull(r.error)
        assert.equal(r.servicios, 0, 'el pendiente no es un servicio vigente del router')
        assert.deepEqual(
            r.correcciones.map((c) => `${c.accion} ${c.ruta} ${c.comment}`),
            [`borrado /ip/firewall/address-list ${commentServicio(servicio.id)}`],
        )
        assert.deepEqual(Object.values(objetos(servicio.id)), [0, 0, 0, 0, 0])

        await activar(client, servicio)
        // Sin entregar el evento (se perdió): el reconciliador repone la cola del ya activo.
        const r2 = await new ReconciliarRouterOS(OPCIONES).execute(
            { router_id: routerId, motivo: 'manual' },
            contextoPrueba(),
        )
        assert.equal(r2.servicios, 1)
        assert.deepEqual(
            r2.correcciones.map((c) => `${c.accion} ${c.ruta} ${c.comment}`),
            [`creado /queue/simple ${commentServicio(servicio.id)}`],
        )
    })

    test('un pendiente no cuenta para el padre del plan (reuso) ni para el árbol', async ({
        client,
        assert,
    }) => {
        const { servicio } = await crearPendiente(client, { tipo_conexion: 'ip_estatica' })
        const red = await servicioRed(servicio.id)
        assert.equal(red?.estado, 'pendiente_instalacion')
        assert.deepEqual(planesDeRouter({ control: 'simple' } as never, [red!]), [])
    })
})
