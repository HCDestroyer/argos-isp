import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar, claveDesdeTexto } from '#shared/cifrado'
import env from '#start/env'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'
import { RouterOSFalso } from '#network/routeros/falso'
import { clienteDeRouter } from '#network/routeros/router'
import { normalizarValor } from '#network/routeros/normalizar'
import { ConsumidorRouterOS } from '#network/routeros/consumidor'
import ReconciliarRouterOS from '#network/routeros/actions/reconciliar_router'
import { bitacoraRed, type OpcionesDispatcher } from '#network/routeros/dispatcher'
import { commentServicio } from '#network/routeros/estado_deseado'
import { commentPlan, kbpsPar, nombreGlobal, nombrePadre } from '#network/routeros/velocidad_router'
import { leerMetricasRouterOS } from '#network/routeros/metricas'
import { contextoPrueba } from '#tests/ayudas'
import type { EventoEntrante } from '#shared/eventos_bus'

/**
 * Reglas de oro del contrato del lado del router (semana 2, tanda 2, tarea 5;
 * `contratos/velocidad.md`, "Buenas prácticas"): Σ `limit-at` de las hijas ≤ `max-limit` del padre
 * (si no, `routeros.fallido` con el detalle y no se escribe el padre ni el árbol), el target IPv6
 * siempre incluido, y la métrica de colas por router.
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

async function entregar(eventos: EventoEntrante[]) {
    const consumidor = new ConsumidorRouterOS(OPCIONES)
    for (const e of eventos) if (consumidor.acepta(e.evento)) await consumidor.procesar(e)
}

test.group('RouterOS · reglas de oro y verificación', (group) => {
    let falso: RouterOSFalso
    let token: string
    let routerId: number
    let raiz: string
    let clienteId: number
    let siguiente = 0

    group.each.setup(async () => {
        falso = new RouterOSFalso()
        await falso.levantar()
        ;({ token } = await usuarioConRoles(['soporte']))
        ;({ routerId, raiz } = await crearEscenarioRouter())
        await db
            .from('network.routers')
            .where('id', routerId)
            .update({ host: falso.url, api_usuario: falso.usuario, api_password: cifrar(falso.password) })
        clienteId = await crearClienteFila()
        return () => falso.cerrar()
    })

    async function crear(client: any, planId: number) {
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
                    prefijo_delegado_v6: `${raiz}d${(siguiente++).toString(16)}::/56`,
                }),
            201,
        )
        await entregar(await eventosDe(requestId))
        return r.body() as { id: number; ipv4: string; prefijo_delegado_v6: string }
    }

    async function fallidos(desde: number) {
        return db
            .from('audit.outbox')
            .where('evento', 'routeros.fallido')
            .where('id', '>', desde)
            .whereRaw(`(payload->>'router_id')::bigint = ?`, [routerId])
            .orderBy('id')
    }

    async function ultimoOutbox() {
        const fila = (await db.from('audit.outbox').max('id as id').first()) as { id: number | null }
        return Number(fila.id ?? 0)
    }

    const plan14 = () =>
        crearPlanFila({
            bajada_kbps: 20000,
            subida_kbps: 5000,
            bajada_limitada_kbps: 2000,
            subida_limitada_kbps: 1000,
            reuso: 4,
        })

    test('simple: un override que garantiza más que el padre no se escribe y emite routeros.fallido', async ({
        client,
        assert,
    }) => {
        const plan = await plan14()
        await crear(client, plan)
        await crear(client, plan)
        const padre = () => falso.conComment('/queue/simple', commentPlan(plan))[0]!
        const antes = { ...padre() }
        assert.equal(normalizarValor(antes['max-limit']), normalizarValor('2500k/10M'))

        // Excepción del router: limit-at = MIR (garantiza 5M/20M a cada hija con reuso 1:4)
        await db.table('network.planes_routers').insert({
            plan_id: plan,
            router_id: routerId,
            rate_limit_override: '5M/20M 0/0 0/0 0/0 8 5M/20M',
        })
        const desde = await ultimoOutbox()
        await entregar([
            {
                id: unico('ev'),
                evento: 'plan.velocidad_cambiada',
                payload: { plan_id: plan, router_id: routerId, campos: ['rate_limit_override'] },
            },
        ])
        const eventos = await fallidos(desde)
        assert.lengthOf(eventos, 2) // subida y bajada
        assert.containsSubset(eventos[0]!.payload, {
            router_id: routerId,
            servicio_id: null,
            operacion: 'validar velocidad (limit_at_hijos)',
        })
        assert.match(
            eventos[1]!.payload.error,
            /limit-at de las hijas en bajada \(40000 kbps\) supera el max-limit del padre argosisp-plan-\d+ \(10000 kbps\)/,
        )
        // El padre quedó como estaba (no se escribió un árbol inválido) y sigue existiendo para sus hijas
        assert.deepEqual(padre(), antes)
        assert.lengthOf(falso.conComment('/ppp/profile', commentPlan(plan)), 1)
        const red = await db
            .from('audit.red')
            .where('router_id', routerId)
            .whereRaw(`comando->>'operacion' = 'validar_velocidad'`)
        assert.lengthOf(red, 2)
        assert.isTrue(red.every((f) => f.ok === false && f.comando.regla === 'limit_at_hijos'))

        // Una sesión PPPoE con un limit-at enorme bajo el padre: tampoco se toca el padre
        await db.from('network.planes_routers').where('plan_id', plan).delete()
        await entregar([
            {
                id: unico('ev'),
                evento: 'plan.velocidad_cambiada',
                payload: { plan_id: plan, router_id: routerId, campos: ['rate_limit_override'] },
            },
        ])
        falso.tabla('/queue/simple').push({
            '.id': '*FE',
            name: '<pppoe-grande>',
            target: '10.88.0.1/32',
            parent: nombrePadre(plan),
            dynamic: 'true',
            'limit-at': '50000000/50000000',
        })
        const desde2 = await ultimoOutbox()
        const r = await new ReconciliarRouterOS(OPCIONES).execute(
            { router_id: routerId, motivo: 'manual' },
            contextoPrueba(),
        )
        assert.isNotEmpty(r.errores_velocidad)
        assert.isNotEmpty(await fallidos(desde2))
        assert.notInclude(padre().target!, '10.88.0.1/32')
    })

    test('arbol_pcq: Σ limit-at de los planes mayor que la capacidad: no se escribe el árbol hasta corregirla', async ({
        client,
        assert,
    }) => {
        await db.from('network.routers').where('id', routerId).update({
            control_velocidad: 'arbol_pcq',
            capacidad_bajada_kbps: 10000,
            capacidad_subida_kbps: 50000,
        })
        const plan = await plan14()
        const desde = await ultimoOutbox()
        const s = await crear(client, plan)
        await crear(client, plan)
        // 2 activos: limit-at bajada 5M × 2 = 10M ≤ 10M; con 3 se pasa
        assert.isDefined(falso.tabla('/queue/tree').find((o) => o.name === nombreGlobal('bajada')))
        assert.lengthOf(await fallidos(desde), 0)
        const nodosAntes = falso.tabla('/queue/tree').map((o) => ({ ...o }))

        const desde2 = await ultimoOutbox()
        await crear(client, plan)
        const eventos = await fallidos(desde2)
        assert.isNotEmpty(eventos)
        assert.equal(eventos[0]!.payload.operacion, 'validar velocidad (limit_at_global)')
        assert.match(
            eventos[0]!.payload.error,
            /bajada \(15000 kbps\) supera la capacidad del enlace \(10000 kbps/,
        )
        assert.deepEqual(falso.tabla('/queue/tree'), nodosAntes)
        // Las listas por servicio sí se mantienen (IPv4 e IPv6)
        assert.lengthOf(falso.conComment('/ip/firewall/address-list', commentServicio(s.id)), 1)

        // Se corrige la capacidad (router.control_cambiado con campos capacidad): el árbol se escribe
        await db.from('network.routers').where('id', routerId).update({ capacidad_bajada_kbps: 100000 })
        await entregar([
            {
                id: unico('ev'),
                evento: 'router.control_cambiado',
                payload: {
                    router_id: routerId,
                    de: 'arbol_pcq',
                    a: 'arbol_pcq',
                    capacidad_bajada_kbps: 100000,
                    capacidad_subida_kbps: 50000,
                    campos: ['capacidad'],
                    motivo: null,
                },
            },
        ])
        const nodo = falso.tabla('/queue/tree').find((o) => o.comment === `${commentPlan(plan)}:bajada`)!
        assert.equal(kbpsPar(nodo['limit-at']).bajada, 15000)
        assert.equal(
            kbpsPar(falso.tabla('/queue/tree').find((o) => o.name === nombreGlobal('bajada'))!['max-limit'])
                .bajada,
            100000,
        )
    })

    test('IPv6 siempre en el target: cola WISP, padre y reconciliación de un target editado a mano', async ({
        client,
        assert,
    }) => {
        const plan = await plan14()
        const s = await crear(client, plan)
        const cola = () => falso.conComment('/queue/simple', commentServicio(s.id))[0]!
        const padre = () => falso.conComment('/queue/simple', commentPlan(plan))[0]!
        assert.sameMembers(cola().target!.split(','), [`${s.ipv4}/32`, s.prefijo_delegado_v6])
        assert.include(padre().target!.split(','), s.prefijo_delegado_v6)
        // Sesión PPPoE dual-stack bajo el padre: su /64 y /56 entran al target del padre
        falso.tabla('/queue/simple').push({
            '.id': '*FD',
            name: '<pppoe-dual>',
            target: '10.88.0.2/32,2001:db8:88:2::/64,2001:db8:88:200::/56',
            parent: nombrePadre(plan),
            dynamic: 'true',
            'limit-at': '0/0',
        })
        // Alguien quita el IPv6 de la cola y del padre en Winbox
        Object.assign(cola(), { target: `${s.ipv4}/32` })
        Object.assign(padre(), { target: `${s.ipv4}/32` })
        const r = await new ReconciliarRouterOS(OPCIONES).execute(
            { router_id: routerId, motivo: 'manual' },
            contextoPrueba(),
        )
        assert.isEmpty(r.errores_velocidad)
        assert.include(cola().target!.split(','), s.prefijo_delegado_v6)
        assert.includeMembers(padre().target!.split(','), [
            s.prefijo_delegado_v6,
            '2001:db8:88:2::/64',
            '2001:db8:88:200::/56',
        ])
    })

    test('métrica de colas por router: simples, árbol y modo tras reconciliar', async ({
        client,
        assert,
    }) => {
        const plan = await plan14()
        await crear(client, plan)
        await new ReconciliarRouterOS(OPCIONES).execute(
            { router_id: routerId, motivo: 'manual' },
            contextoPrueba(),
        )
        const metricas = await leerMetricasRouterOS()
        const muestra = (nombre: string) =>
            metricas
                .find((m) => m.nombre === nombre)!
                .muestras.find((x) => x.etiquetas?.router_id === String(routerId))
        assert.equal(muestra('argosisp_routeros_colas_simples')!.valor, 2) // la del servicio y el padre
        assert.equal(muestra('argosisp_routeros_colas_arbol')!.valor, 0)
        assert.deepInclude(muestra('argosisp_routeros_control_velocidad'), { valor: 1 })
        assert.equal(muestra('argosisp_routeros_control_velocidad')!.etiquetas?.modo, 'simple')
    })
})
