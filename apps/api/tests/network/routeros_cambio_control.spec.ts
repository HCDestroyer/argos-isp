import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar, claveDesdeTexto } from '#shared/cifrado'
import env from '#start/env'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'
import CambiarEstadoServicio from '#core/actions/cambiar_estado_servicio'
import CambiarControlVelocidad from '#network/actions/cambiar_control_velocidad'
import { RouterOSFalso } from '#network/routeros/falso'
import { clienteDeRouter } from '#network/routeros/router'
import { normalizarValor } from '#network/routeros/normalizar'
import { ConsumidorRouterOS } from '#network/routeros/consumidor'
import { bitacoraRed, enTransicion, type OpcionesDispatcher } from '#network/routeros/dispatcher'
import { ejecutarCambioControl, type ResultadoCambioControl } from '#network/routeros/cambio_control'
import { commentServicio } from '#network/routeros/estado_deseado'
import { commentPlan, listaPlan, nombreGlobal, nombrePadre } from '#network/routeros/velocidad_router'
import type { ControlVelocidad } from '#network/velocidad'
import type { EventoEntrante } from '#shared/eventos_bus'

/**
 * Cambio de modo de control de un router (semana 2, tanda 2, tarea 4): `routers.cambiar_control_velocidad`
 * (A1) emite `router.control_cambiado`; el worker migra por lotes (preparar → lotes → terminar),
 * es reversible, deja registro en `audit.red` y no deja colas huérfanas. Más la vista previa.
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

async function eventosDe(requestId: string): Promise<EventoEntrante[]> {
    const filas = await db.from('audit.outbox').where('request_id', requestId).orderBy('id')
    return filas.map((f) => ({
        id: Number(f.id),
        evento: f.evento,
        payload: f.payload,
        requestId: f.request_id,
    }))
}

test.group('RouterOS · cambio de modo de control (simple ↔ arbol_pcq)', (group) => {
    let falso: RouterOSFalso
    let token: string
    let admin: string
    let routerId: number
    let raiz: string
    let clienteId: number
    let siguiente = 0
    let ultimo: ResultadoCambioControl | null = null

    // El cambio en línea (en producción va al job `cambiar_control` de `routeros-cron`).
    const consumidor = () =>
        new ConsumidorRouterOS(OPCIONES, async (entrada) => {
            ultimo = await ejecutarCambioControl(entrada, { ...OPCIONES, lote: 2, pausaMs: 1 })
        })

    async function entregar(eventos: EventoEntrante[]) {
        const c = consumidor()
        for (const e of eventos) if (c.acepta(e.evento)) await c.procesar(e)
    }

    group.each.setup(async () => {
        falso = new RouterOSFalso()
        await falso.levantar()
        ;({ token } = await usuarioConRoles(['soporte']))
        ;({ token: admin } = await usuarioConRoles(['admin']))
        ;({ routerId, raiz } = await crearEscenarioRouter())
        await db
            .from('network.routers')
            .where('id', routerId)
            .update({
                host: falso.url,
                api_usuario: falso.usuario,
                api_password: cifrar(falso.password),
                capacidad_bajada_kbps: 100000,
                capacidad_subida_kbps: 50000,
            })
        clienteId = await crearClienteFila()
        ultimo = null
        return () => falso.cerrar()
    })

    async function crear(client: any, planId: number, cuerpo: Record<string, unknown> = {}) {
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
                    tipo_conexion: 'ip_estatica',
                    ipv6_modo: 'estatico',
                    prefijo_delegado_v6: `${raiz}e${(siguiente++).toString(16)}::/56`,
                    ...cuerpo,
                }),
            201,
        )
        await entregar(await eventosDe(requestId))
        return r.body() as { id: number; ipv4: string }
    }

    async function cambiarModo(a: ControlVelocidad) {
        const ctx = contextoPrueba()
        const router = await db.from('network.routers').where('id', routerId).firstOrFail()
        await new CambiarControlVelocidad().execute(
            { id: routerId, version: router.version, control_velocidad: a, motivo: 'prueba' },
            ctx,
        )
        const eventos = await eventosDe(ctx.requestId)
        await entregar(eventos)
        return eventos
    }

    /** Lo que ArgosIsp administra en el router, por menú (para comparar ida y vuelta). */
    function inventario() {
        const salida: Record<string, string[]> = {}
        for (const ruta of [
            '/queue/simple',
            '/queue/tree',
            '/queue/type',
            '/ip/firewall/mangle',
            '/ipv6/firewall/mangle',
            '/ip/firewall/address-list',
            '/ipv6/firewall/address-list',
            '/ppp/profile',
        ] as const) {
            salida[ruta] = falso
                .tabla(ruta)
                // El corte (`argosisp: …`) lo deja el último paso y no depende del modo.
                .filter(
                    (o) =>
                        o.dynamic !== 'true' &&
                        o.name !== 'default' &&
                        !(o.comment ?? '').startsWith('argosisp: '),
                )
                .map((o) => `${o.comment ?? o.name}|${o.parent ?? ''}|${o.list ?? ''}`)
                .sort()
        }
        return salida
    }

    /** Ninguna cola ni referencia colgando: toda hija apunta a algo que existe. */
    function sinHuerfanas(assert: any) {
        const simples = new Set(falso.tabla('/queue/simple').map((o) => o.name))
        for (const q of falso.tabla('/queue/simple')) {
            assert.match(q.comment ?? '', /^argosisp:(servicio|plan):\d+$/)
            if (q.parent && q.parent !== 'none') assert.isTrue(simples.has(q.parent), q.parent)
        }
        const arbol = new Set(falso.tabla('/queue/tree').map((o) => o.name))
        const tipos = new Set(falso.tabla('/queue/type').map((o) => o.name))
        for (const n of falso.tabla('/queue/tree')) {
            if (n.parent !== 'global') assert.isTrue(arbol.has(n.parent!), n.parent)
            if (n.queue?.startsWith('argosisp-')) assert.isTrue(tipos.has(n.queue), n.queue)
        }
        for (const p of falso.tabla('/ppp/profile')) {
            if (p['parent-queue']) assert.isTrue(simples.has(p['parent-queue']), p['parent-queue'])
        }
    }

    test('ida y vuelta simple → arbol_pcq → simple por lotes: sin colas huérfanas y con registro en audit.red', async ({
        client,
        assert,
    }) => {
        const plan = await crearPlanFila({
            bajada_kbps: 20000,
            subida_kbps: 5000,
            bajada_limitada_kbps: 2000,
            subida_limitada_kbps: 1000,
            reuso: 4,
        })
        const wisp = []
        for (let i = 0; i < 4; i++) wisp.push(await crear(client, plan))
        const ctx = contextoPrueba()
        await new CambiarEstadoServicio().execute(
            { servicioId: wisp[3]!.id, nuevo: 'suspendido', motivo: 'x' },
            ctx,
        )
        await entregar(await eventosDe(ctx.requestId))
        // Un PPPoE con su sesión abierta
        const userPpp = unico('ppp')
        const pppoe = await crear(client, plan, {
            tipo_conexion: 'pppoe',
            user_ppp: userPpp,
            pass_ppp: 'clave-larga-1',
            ipv6_modo: 'ninguno',
            prefijo_delegado_v6: undefined,
        })
        await db.table('network.sesiones').insert({
            servicio_id: pppoe.id,
            router_id: routerId,
            nas_ip: '127.0.0.9',
            acct_session_id: unico('81a0'),
            user_ppp: userPpp,
            ipv4: '10.99.0.8',
            prefijo_enlace_v6: '2001:db8:99:8::/64',
            prefijo_delegado_v6: '2001:db8:99:800::/56',
        })
        const inicial = inventario()
        assert.lengthOf(falso.conComment('/queue/simple', commentPlan(plan)), 1)
        sinHuerfanas(assert)

        // Ida
        const [evento] = await cambiarModo('arbol_pcq')
        assert.equal(evento!.evento, 'router.control_cambiado')
        assert.isNull(ultimo!.error)
        assert.isFalse(ultimo!.repetido)
        assert.equal(ultimo!.lotes, 3) // 5 servicios en lotes de 2
        assert.equal(ultimo!.desconexiones, 1)
        assert.isFalse(await enTransicion(routerId))
        // Solo queda la cola del suspendido; ni padres ni perfiles; árbol, PCQ, mangle y listas
        assert.deepEqual(
            falso.tabla('/queue/simple').map((o) => o.comment),
            [commentServicio(wisp[3]!.id)],
        )
        assert.lengthOf(falso.conComment('/ppp/profile', commentPlan(plan)), 0)
        assert.isDefined(falso.tabla('/queue/tree').find((o) => o.name === nombreGlobal('bajada')))
        assert.sameMembers(
            falso
                .tabla('/ip/firewall/address-list')
                .filter((o) => o.list === listaPlan(plan, false))
                .map((o) => o.address),
            [wisp[0]!.ipv4, wisp[1]!.ipv4, wisp[2]!.ipv4, '10.99.0.8'],
        )
        sinHuerfanas(assert)
        // El PPPoE recibe Disconnect para entrar sin Mikrotik-Rate-Limit (coa lo ejecuta)
        const desconexiones = await db
            .from('audit.outbox')
            .where('evento', 'sesion.desconexion_solicitada')
            .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [pppoe.id])
        assert.lengthOf(desconexiones, 1)
        // audit.red: un registro por paso (preparar, 3 lotes, terminar) además de cada escritura
        const pasos = await db
            .from('audit.red')
            .where('router_id', routerId)
            .whereRaw(`comando->>'operacion' = 'cambiar_control'`)
            .orderBy('id')
        assert.deepEqual(
            pasos.map((p) => p.comando.fase),
            ['preparar', 'lote', 'lote', 'lote', 'terminar'],
        )
        assert.isTrue(pasos.every((p) => p.ok && p.comando.de === 'simple' && p.comando.a === 'arbol_pcq'))
        assert.isAbove(pasos.at(-1)!.respuesta.borrados, 0)

        // El mismo evento otra vez: no repite (no vuelve a desconectar)
        await entregar([evento!])
        assert.isTrue(ultimo!.repetido)

        // Vuelta
        await cambiarModo('simple')
        assert.isNull(ultimo!.error)
        assert.deepEqual(inventario(), inicial)
        assert.equal(
            falso.conComment('/queue/simple', commentServicio(wisp[0]!.id))[0]!.parent,
            nombrePadre(plan),
        )
        assert.isTrue(
            normalizarValor(falso.conComment('/queue/simple', commentPlan(plan))[0]!['max-limit']) ===
                normalizarValor('5M/20M'), // 3 WISP activos + el PPPoE
        )
        sinHuerfanas(assert)
        for (const ruta of [
            '/queue/tree',
            '/queue/type',
            '/ip/firewall/mangle',
            '/ipv6/firewall/mangle',
        ] as const) {
            assert.lengthOf(falso.tabla(ruta), 0, ruta)
        }
    })

    test('solo la capacidad del enlace: ajusta los padres globales sin migrar servicios', async ({
        client,
        assert,
    }) => {
        const plan = await crearPlanFila({ bajada_kbps: 20000, subida_kbps: 5000, reuso: 2 })
        await crear(client, plan)
        await cambiarModo('arbol_pcq')
        await db.from('network.routers').where('id', routerId).update({ capacidad_bajada_kbps: 300000 })
        ultimo = null
        await entregar([
            {
                id: unico('ev'),
                evento: 'router.control_cambiado',
                payload: {
                    router_id: routerId,
                    de: 'arbol_pcq',
                    a: 'arbol_pcq',
                    capacidad_bajada_kbps: 300000,
                    capacidad_subida_kbps: 50000,
                    campos: ['capacidad'],
                    motivo: null,
                },
            },
        ])
        assert.isNull(ultimo)
        const global = falso.tabla('/queue/tree').find((o) => o.name === nombreGlobal('bajada'))!
        assert.equal(normalizarValor(global['max-limit']), normalizarValor('300M'))
    })

    test('vista previa: qué crea y qué borra, sin tocar el router; permiso routers.cambiar_control_velocidad', async ({
        client,
        assert,
    }) => {
        const plan = await crearPlanFila({ bajada_kbps: 20000, subida_kbps: 5000, reuso: 4 })
        const s1 = await crear(client, plan)
        const s2 = await crear(client, plan)
        const peticiones = falso.peticiones.length

        const r = await estado(
            client
                .get(`/api/v1/routers/${routerId}/vista-previa-control`)
                .qs({ a: 'arbol_pcq' })
                .bearerToken(admin),
            200,
        )
        const vista = r.body()
        assert.equal(falso.peticiones.length, peticiones)
        assert.containsSubset(vista, {
            router_id: routerId,
            de: 'simple',
            a: 'arbol_pcq',
            servicios: 2,
            lotes: 1,
        })
        const claves = (lista: Array<{ ruta: string; clave: string }>) =>
            lista.map((o) => `${o.ruta}|${o.clave}`)
        assert.includeMembers(claves(vista.crear), [
            '/queue/tree|argosisp:global:bajada',
            `/queue/tree|${commentPlan(plan)}:bajada`,
            `/queue/type|argosisp-plan-${plan}-bajada`,
            `/ip/firewall/mangle|${commentPlan(plan)}:bajada`,
            `/ipv6/firewall/mangle|${commentPlan(plan)}:subida`,
            `/ip/firewall/address-list|${commentServicio(s1.id)}`,
            `/ipv6/firewall/address-list|${commentServicio(s1.id)}:delegado`,
        ])
        assert.sameMembers(claves(vista.borrar), [
            `/queue/simple|${commentPlan(plan)}`,
            `/ppp/profile|${commentPlan(plan)}`,
            `/queue/simple|${commentServicio(s1.id)}`,
            `/queue/simple|${commentServicio(s2.id)}`,
        ])
        assert.deepInclude(vista.menus, { ruta: '/queue/simple', crear: 0, actualizar: 0, borrar: 3 })

        // Mismo modo: vacío
        const igual = await estado(
            client
                .get(`/api/v1/routers/${routerId}/vista-previa-control`)
                .qs({ a: 'simple' })
                .bearerToken(admin),
            200,
        )
        assert.lengthOf(igual.body().crear, 0)
        assert.lengthOf(igual.body().borrar, 0)

        await estado(
            client
                .get(`/api/v1/routers/${routerId}/vista-previa-control`)
                .qs({ a: 'arbol_pcq' })
                .bearerToken(token),
            403,
        )
        await estado(
            client
                .get(`/api/v1/routers/${routerId}/vista-previa-control`)
                .qs({ a: 'otro' })
                .bearerToken(admin),
            422,
        )
        await estado(
            client
                .get('/api/v1/routers/999999999/vista-previa-control')
                .qs({ a: 'simple' })
                .bearerToken(admin),
            404,
        )
    })
})
