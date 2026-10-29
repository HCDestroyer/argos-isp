import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar, claveDesdeTexto } from '#shared/cifrado'
import env from '#start/env'
import { redis } from '#shared/redis'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'
import CambiarEstadoServicio from '#core/actions/cambiar_estado_servicio'
import RetirarServicio from '#core/actions/retirar_servicio'
import { RouterOSFalso } from '#network/routeros/falso'
import { esCambioDeCorte } from '#network/routeros/corte_router'
import { clienteDeRouter } from '#network/routeros/router'
import { normalizarValor } from '#network/routeros/normalizar'
import { ConsumidorRouterOS } from '#network/routeros/consumidor'
import { ejecutarCronRouterOS } from '#network/routeros/jobs'
import ReconciliarRouterOS from '#network/routeros/actions/reconciliar_router'
import { bitacoraRed, clavePendientes, type OpcionesDispatcher } from '#network/routeros/dispatcher'
import { routerDispatcher } from '#network/routeros/consultas'
import { commentServicio, propiedadesCola } from '#network/routeros/estado_deseado'
import { leerVelocidad, rateLimitServicio } from '#network/velocidad'
import type { EventoEntrante } from '#shared/eventos_bus'
import { recolectarMetricas, registrarSeccionMetricas } from '#monitoreo/metricas'
import { leerMetricasRouterOS } from '#network/routeros/metricas'

/**
 * Dispatcher WISP (semana 2, tarea 3; `contratos/routeros.md`) con Postgres real y el RouterOS
 * falso: servicios `ip_estatica` y `dhcp_fija` creados por la API, eventos del outbox entregados
 * al consumidor `routeros` como lo haría el bus, y el reconciliador.
 */

const MAC = 'AA:BB:CC:00:22:33'

/** Clientes contra el falso con backoff corto (las pruebas no esperan 3,5 s por router caído). */
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

/** Lo que haría el bus: entrega los eventos al consumidor `routeros`. */
async function entregar(eventos: EventoEntrante[], consumidor = new ConsumidorRouterOS(OPCIONES)) {
    for (const e of eventos) if (consumidor.acepta(e.evento)) await consumidor.procesar(e)
}

async function routerConFalso(falso: RouterOSFalso) {
    const esc = await crearEscenarioRouter()
    await db
        .from('network.routers')
        .where('id', esc.routerId)
        .update({ host: falso.url, api_usuario: falso.usuario, api_password: cifrar(falso.password) })
    return esc
}

async function velocidadDelPlan(planId: number) {
    const fila = await db.from('network.planes').where('id', planId).firstOrFail()
    return leerVelocidad(fila)
}

function maxLimit(rateLimit: string) {
    return normalizarValor(propiedadesCola(rateLimit)['max-limit'])
}

test.group('RouterOS · dispatcher WISP', (group) => {
    let falso: RouterOSFalso
    let token: string
    let routerId: number
    let base: string
    let planId: number
    let clienteId: number

    group.each.setup(async () => {
        falso = new RouterOSFalso()
        await falso.levantar()
        ;({ token } = await usuarioConRoles(['soporte']))
        ;({ routerId, base } = await routerConFalso(falso))
        planId = await crearPlanFila({
            bajada_kbps: 20000,
            subida_kbps: 5000,
            bajada_limitada_kbps: 2000,
            subida_limitada_kbps: 1000,
        })
        clienteId = await crearClienteFila()
        return () => falso.cerrar()
    })

    async function crear(client: any, cuerpo: Record<string, unknown>) {
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
                    ...cuerpo,
                }),
            201,
        )
        return { servicio: r.body(), eventos: await eventosDe(requestId) }
    }

    async function cambiarEstado(servicioId: number, nuevo: 'activo' | 'limitado' | 'suspendido') {
        const ctx = contextoPrueba()
        await new CambiarEstadoServicio().execute({ servicioId, nuevo, motivo: 'prueba' }, ctx)
        return eventosDe(ctx.requestId)
    }

    const cola = (id: number) => falso.conComment('/queue/simple', commentServicio(id))
    const lista = (id: number) => falso.conComment('/ip/firewall/address-list', commentServicio(id))

    test('ip_estatica: activo → limitado → suspendido → activo por evento, auditado en audit.red', async ({
        client,
        assert,
    }) => {
        const { servicio, eventos } = await crear(client, { tipo_conexion: 'ip_estatica' })
        const vel = await velocidadDelPlan(planId)
        await entregar(eventos)
        assert.lengthOf(cola(servicio.id), 1)
        assert.containsSubset(cola(servicio.id)[0], {
            name: `argosisp-servicio-${servicio.id}`,
            target: `${servicio.ipv4}/32`,
        })
        assert.equal(
            normalizarValor(cola(servicio.id)[0]!['max-limit']),
            maxLimit(rateLimitServicio(vel, 'activo')),
        )
        assert.lengthOf(lista(servicio.id), 0)

        await entregar(await cambiarEstado(servicio.id, 'limitado'))
        assert.equal(
            normalizarValor(cola(servicio.id)[0]!['max-limit']),
            maxLimit(rateLimitServicio(vel, 'limitado')),
        )
        assert.lengthOf(lista(servicio.id), 0)

        await entregar(await cambiarEstado(servicio.id, 'suspendido'))
        assert.equal(normalizarValor(cola(servicio.id)[0]!['max-limit']), normalizarValor('256k/256k'))
        assert.lengthOf(lista(servicio.id), 1)
        assert.containsSubset(lista(servicio.id)[0], { list: 'suspendidos', address: servicio.ipv4 })

        await entregar(await cambiarEstado(servicio.id, 'activo'))
        assert.equal(
            normalizarValor(cola(servicio.id)[0]!['max-limit']),
            maxLimit(rateLimitServicio(vel, 'activo')),
        )
        assert.lengthOf(lista(servicio.id), 0)
        assert.lengthOf(cola(servicio.id), 1)

        const red = await db
            .from('audit.red')
            .where('servicio_id', servicio.id)
            .where('tipo', 'routeros')
            .orderBy('id')
        // PUT cola · PATCH limitado · PATCH suspendido + PUT lista · PATCH activo + DELETE lista
        assert.deepEqual(
            red.map((f) => `${f.comando.metodo} ${f.comando.ruta}`),
            [
                'PUT /queue/simple',
                'PATCH /queue/simple',
                'PATCH /queue/simple',
                'PUT /ip/firewall/address-list',
                'PATCH /queue/simple',
                'DELETE /ip/firewall/address-list',
            ],
        )
        assert.isTrue(red.every((f) => f.ok && f.router_id === routerId))
        assert.notInclude(JSON.stringify(red), falso.password)
        const acciones = await db
            .from('audit.acciones')
            .where('accion', 'routeros.aplicar_servicio')
            .where('entidad_id', servicio.id)
        assert.lengthOf(acciones, 4)
    })

    test('evento duplicado o fuera de orden: aplica el estado vigente sin escribir de más', async ({
        client,
        assert,
    }) => {
        const { servicio, eventos } = await crear(client, { tipo_conexion: 'ip_estatica' })
        await entregar(eventos)
        const limitar = await cambiarEstado(servicio.id, 'limitado')
        const suspender = await cambiarEstado(servicio.id, 'suspendido')
        // llegan al revés: primero la suspensión, después la limitación vieja
        await entregar(suspender)
        const escrituras = falso.escrituras.length
        await entregar(limitar)
        await entregar(suspender)
        await entregar(eventos)
        assert.equal(falso.escrituras.length, escrituras, 'ningún evento repetido o viejo escribe')
        assert.lengthOf(lista(servicio.id), 1)
        assert.equal(normalizarValor(cola(servicio.id)[0]!['max-limit']), normalizarValor('256k/256k'))
    })

    test('dhcp_fija con amarre: lease y ARP; al cambiar a ip_estatica se borra el lease; al retirar, todo', async ({
        client,
        assert,
    }) => {
        const { servicio, eventos } = await crear(client, {
            tipo_conexion: 'dhcp_fija',
            mac: MAC,
            amarre_ip_mac: true,
        })
        await entregar(eventos)
        const comment = commentServicio(servicio.id)
        assert.containsSubset(falso.conComment('/ip/dhcp-server/lease', comment), [
            { address: servicio.ipv4, 'mac-address': MAC, server: 'dhcp-clientes' },
        ])
        assert.containsSubset(falso.conComment('/ip/arp', comment), [
            { address: servicio.ipv4, 'mac-address': MAC, interface: 'ether-clientes' },
        ])

        const requestId = unico('req')
        await estado(
            client
                .put(`/api/v1/servicios/${servicio.id}`)
                .bearerToken(token)
                .header('X-Request-Id', requestId)
                .json({ version: servicio.version, tipo_conexion: 'ip_estatica' }),
            200,
        )
        await entregar(await eventosDe(requestId))
        assert.lengthOf(falso.conComment('/ip/dhcp-server/lease', comment), 0)
        assert.lengthOf(falso.conComment('/ip/arp', comment), 1)
        assert.lengthOf(cola(servicio.id), 1)

        const ctx = contextoPrueba()
        await new RetirarServicio().execute({ id: servicio.id, motivo: 'baja' }, ctx)
        await entregar(await eventosDe(ctx.requestId))
        for (const ruta of [
            '/queue/simple',
            '/ip/firewall/address-list',
            '/ip/dhcp-server/lease',
            '/ip/arp',
        ] as const) {
            assert.lengthOf(falso.conComment(ruta, comment), 0, ruta)
        }
    })

    test('conexión y red del router: api_url en vez de host, dhcp_servidor e interfaz_clientes de sus columnas', async ({
        client,
        assert,
    }) => {
        // `host` inservible: si el cliente lo usara, el comando fallaría (routeros.fallido).
        await db.from('network.routers').where('id', routerId).update({
            host: 'no-usar.invalid',
            api_url: falso.url,
            dhcp_servidor: 'dhcp-del-router',
            interfaz_clientes: 'bridge-del-router',
        })
        const { servicio, eventos } = await crear(client, {
            tipo_conexion: 'dhcp_fija',
            mac: MAC,
            amarre_ip_mac: true,
        })
        await entregar(eventos)
        const comment = commentServicio(servicio.id)
        // Las columnas ganan a los predeterminados del llamador (`OPCIONES.red`) y al entorno.
        assert.containsSubset(falso.conComment('/ip/dhcp-server/lease', comment), [
            { address: servicio.ipv4, 'mac-address': MAC, server: 'dhcp-del-router' },
        ])
        assert.containsSubset(falso.conComment('/ip/arp', comment), [
            { address: servicio.ipv4, 'mac-address': MAC, interface: 'bridge-del-router' },
        ])
        assert.lengthOf(cola(servicio.id), 1)
        const fallidos = await db
            .from('audit.outbox')
            .where('evento', 'routeros.fallido')
            .whereRaw("payload->>'router_id' = ?", [String(routerId)])
        assert.lengthOf(fallidos, 0)
    })

    test('routerDispatcher: precedencia columna → predeterminados → entorno → all / sin ARP; TLS del router', async ({
        assert,
    }) => {
        await db.from('network.routers').where('id', routerId).update({
            dhcp_servidor: null,
            interfaz_clientes: null,
            api_tls_verificar: false,
            api_ca: null,
        })
        const sinNada = await routerDispatcher(routerId)
        assert.equal(sinNada?.red.dhcp_servidor, env.get('ROUTEROS_DHCP_SERVIDOR') ?? 'all')
        assert.equal(sinNada?.red.interfaz_clientes, env.get('ROUTEROS_INTERFAZ_CLIENTES') ?? null)
        assert.isFalse(sinNada?.api.api_tls_verificar)
        assert.equal(sinNada?.api.api_url, null)

        const conPredeterminados = await routerDispatcher(routerId, undefined, OPCIONES.red)
        assert.equal(conPredeterminados?.red.dhcp_servidor, 'dhcp-clientes')
        assert.equal(conPredeterminados?.red.interfaz_clientes, 'ether-clientes')

        await db
            .from('network.routers')
            .where('id', routerId)
            .update({ dhcp_servidor: 'dhcp-propio', interfaz_clientes: 'ether-propia' })
        const conColumnas = await routerDispatcher(routerId, undefined, OPCIONES.red)
        assert.equal(conColumnas?.red.dhcp_servidor, 'dhcp-propio')
        assert.equal(conColumnas?.red.interfaz_clientes, 'ether-propia')
        assert.isNull(await routerDispatcher(987654321))
    })

    test('un servicio PPPoE no toca el router', async ({ client, assert }) => {
        const { eventos } = await crear(client, { user_ppp: unico('ppp'), pass_ppp: 'clave-larga-1' })
        const antes = falso.peticiones.length
        await entregar(eventos)
        assert.equal(falso.peticiones.length, antes)
    })

    test('reconciliador: repone la cola borrada a mano, corrige la editada y borra huérfanos', async ({
        client,
        assert,
    }) => {
        const a = await crear(client, { tipo_conexion: 'ip_estatica' })
        const b = await crear(client, { tipo_conexion: 'ip_estatica' })
        await entregar([...a.eventos, ...b.eventos])
        await entregar(await cambiarEstado(b.servicio.id, 'suspendido'))

        falso.borrarAMano('/queue/simple', (o) => o.comment === commentServicio(a.servicio.id))
        falso.borrarAMano('/ip/firewall/address-list', (o) => o.comment === commentServicio(b.servicio.id))
        cola(b.servicio.id)[0]!['max-limit'] = '100000000/100000000'
        falso.tabla('/queue/simple').push({
            '.id': '*FFF0',
            name: 'huerfana',
            target: `${base}.250/32`,
            comment: commentServicio(99_999_999),
        })
        falso.tabla('/queue/simple').push({ '.id': '*FFF1', name: 'ajena', target: '192.168.1.9/32' })

        // Reglas fijas de lab.rsc (A6): `argosisp: …` y `argosisp:top …` nunca se tocan
        falso
            .tabla('/ip/firewall/address-list')
            .push(
                { '.id': '*FFF2', list: 'portal', address: '10.0.0.1', comment: 'argosisp: portal de corte' },
                { '.id': '*FFF3', list: 'top', address: '10.0.0.2', comment: 'argosisp:top walled garden' },
            )

        const ctx = contextoPrueba()
        const r = await new ReconciliarRouterOS(OPCIONES).execute(
            { router_id: routerId, motivo: 'manual' },
            ctx,
        )
        assert.isNull(r.error)
        assert.equal(r.servicios, 2)
        assert.sameDeepMembers(
            r.correcciones
                .filter((c) => !esCambioDeCorte(c))
                .map((c) => `${c.accion} ${c.ruta} ${c.comment}`),
            [
                `creado /queue/simple ${commentServicio(a.servicio.id)}`,
                `actualizado /queue/simple ${commentServicio(b.servicio.id)}`,
                `creado /ip/firewall/address-list ${commentServicio(b.servicio.id)}`,
                `borrado /queue/simple ${commentServicio(99_999_999)}`,
            ],
        )
        assert.lengthOf(cola(a.servicio.id), 1)
        assert.lengthOf(lista(b.servicio.id), 1)
        assert.equal(normalizarValor(cola(b.servicio.id)[0]!['max-limit']), normalizarValor('256k/256k'))
        assert.isTrue(
            falso.tabla('/queue/simple').some((o) => o.name === 'ajena'),
            'lo que no es de ArgosIsp no se toca',
        )
        const auditada = await db
            .from('audit.acciones')
            .where('accion', 'routeros.reconciliar')
            .where('request_id', ctx.requestId)
            .first()
        assert.exists(auditada)

        assert.includeMembers(
            falso.tabla('/ip/firewall/address-list').map((o) => o['.id']),
            ['*FFF2', '*FFF3'],
        )
        // Métrica de A6: colas simples del router (todas, también las ajenas) en /metrics
        assert.equal(r.colas_simples, 3, 'lectura antes de corregir: b, la huérfana y la ajena')
        // (otra prueba de /metrics puede haber reemplazado la sección: se registra igual que la API)
        registrarSeccionMetricas('routeros', leerMetricasRouterOS)
        const texto = await recolectarMetricas()
        assert.match(
            texto,
            new RegExp(`argosisp_routeros_colas_simples\\{router_id="${routerId}",router="[^"]+"\\} 3`),
        )
        assert.match(
            texto,
            new RegExp(`argosisp_routeros_colas_leidas_timestamp_seconds\\{router_id="${routerId}"`),
        )

        // Segunda pasada: nada que corregir, sin escrituras ni fila de auditoría
        const escrituras = falso.escrituras.length
        const ctx2 = contextoPrueba()
        const r2 = await new ReconciliarRouterOS(OPCIONES).execute(
            { router_id: routerId, motivo: 'periodico' },
            ctx2,
        )
        assert.lengthOf(r2.correcciones, 0)
        assert.equal(falso.escrituras.length, escrituras)
        const sinFila = await db.from('audit.acciones').where('request_id', ctx2.requestId).first()
        assert.isNull(sinFila)
    })

    test('router caído: routeros.fallido por outbox y el job recuperar lo repone al volver', async ({
        client,
        assert,
    }) => {
        await redis().del(clavePendientes())
        const { servicio, eventos } = await crear(client, { tipo_conexion: 'ip_estatica' })
        await entregar(eventos)

        await falso.caer()
        const suspender = await cambiarEstado(servicio.id, 'suspendido')
        await entregar(suspender)
        const fallido = await db
            .from('audit.outbox')
            .where('evento', 'routeros.fallido')
            .where('request_id', suspender[0]!.requestId!)
            .first()
        assert.containsSubset(fallido?.payload, {
            servicio_id: servicio.id,
            router_id: routerId,
            operacion: 'queue/simple print',
        })
        assert.include(await redis().smembers(clavePendientes()), String(routerId))
        const fallos = await db
            .from('audit.red')
            .where('servicio_id', servicio.id)
            .where('ok', false)
            .count('* as n')
            .first()
        assert.isAbove(Number(fallos?.n), 0, 'los intentos fallidos también quedan en audit.red')

        // Sigue caído: recuperar no reconcilia (ni emite otro fallido)
        let salida = await ejecutarCronRouterOS('recuperar', OPCIONES)
        assert.lengthOf(salida.resultado ?? [], 0)
        assert.lengthOf(lista(servicio.id), 0)

        await falso.levantar()
        salida = await ejecutarCronRouterOS('recuperar', OPCIONES)
        assert.isFalse(salida.omitido)
        assert.containsSubset(salida.resultado, [{ router_id: routerId, motivo: 'recuperado', error: null }])
        assert.lengthOf(lista(servicio.id), 1)
        assert.equal(normalizarValor(cola(servicio.id)[0]!['max-limit']), normalizarValor('256k/256k'))
        assert.notInclude(await redis().smembers(clavePendientes()), String(routerId))
    })
})
