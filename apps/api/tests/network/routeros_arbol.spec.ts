import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar, claveDesdeTexto } from '#shared/cifrado'
import env from '#start/env'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'
import CambiarEstadoServicio from '#core/actions/cambiar_estado_servicio'
import EditarServicio from '#core/actions/editar_servicio'
import { RouterOSFalso } from '#network/routeros/falso'
import { clienteDeRouter } from '#network/routeros/router'
import { normalizarValor } from '#network/routeros/normalizar'
import { ConsumidorRouterOS } from '#network/routeros/consumidor'
import ReconciliarRouterOS from '#network/routeros/actions/reconciliar_router'
import { bitacoraRed, type OpcionesDispatcher } from '#network/routeros/dispatcher'
import { commentServicio, commentServicioV6 } from '#network/routeros/estado_deseado'
import { commentPlan, listaPlan, nombreGlobal, nombreNodo } from '#network/routeros/velocidad_router'
import { leerVelocidad, limitesPadrePlan } from '#network/velocidad'
import type { EventoEntrante } from '#shared/eventos_bus'

/**
 * Control de velocidad en modo `arbol_pcq` (semana 2, tanda 2, tarea 3; `contratos/velocidad.md`,
 * "Modo arbol_pcq"): padres globales, PCQ, nodo y address-list por plan (y por plan limitado),
 * mangle IPv4 e IPv6, listas por servicio (WISP y sesiones PPPoE), sin colas simples por servicio.
 * Postgres real y el RouterOS falso (valida `parent` y `queue` del árbol).
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

const igual = (a: unknown, b: unknown) => normalizarValor(a) === normalizarValor(b)

test.group('RouterOS · velocidad en modo arbol_pcq', (group) => {
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
            .update({
                host: falso.url,
                api_usuario: falso.usuario,
                api_password: cifrar(falso.password),
                control_velocidad: 'arbol_pcq',
                capacidad_bajada_kbps: 100000,
                capacidad_subida_kbps: 50000,
            })
        clienteId = await crearClienteFila()
        return () => falso.cerrar()
    })

    function plan14() {
        return crearPlanFila({
            bajada_kbps: 20000,
            subida_kbps: 5000,
            bajada_limitada_kbps: 2000,
            subida_limitada_kbps: 1000,
            reuso: 4,
        })
    }

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
                    prefijo_delegado_v6: `${raiz}f${(siguiente++).toString(16)}::/56`,
                    ...cuerpo,
                }),
            201,
        )
        await entregar(await eventosDe(requestId))
        return r.body() as { id: number; ipv4: string; prefijo_delegado_v6: string | null }
    }

    async function cambiarEstado(servicioId: number, nuevo: 'activo' | 'limitado' | 'suspendido') {
        const ctx = contextoPrueba()
        await new CambiarEstadoServicio().execute({ servicioId, nuevo, motivo: 'prueba' }, ctx)
        await entregar(await eventosDe(ctx.requestId))
    }

    const nodo = (planId: number, sentido: 'bajada' | 'subida', limitado = false) =>
        falso.tabla('/queue/tree').find((o) => o.name === nombreNodo(planId, limitado, sentido))
    const lista4 = (nombre: string) =>
        falso
            .tabla('/ip/firewall/address-list')
            .filter((o) => o.list === nombre)
            .map((o) => o.address)
    const lista6 = (nombre: string) =>
        falso
            .tabla('/ipv6/firewall/address-list')
            .filter((o) => o.list === nombre)
            .map((o) => o.address)

    async function maxNodo(planId: number, activos: number) {
        const fila = await db.from('network.planes').where('id', planId).firstOrFail()
        return limitesPadrePlan(leerVelocidad(fila), activos).max_limit_kbps.bajada
    }

    test('plan 1:4 con 4 activos y luego 1 suspendido y 1 limitado: árbol, PCQ, mangle y listas', async ({
        client,
        assert,
    }) => {
        const planId = await plan14()
        const servicios = []
        for (let i = 0; i < 4; i++) servicios.push(await crear(client, planId))

        // Sin colas simples por servicio
        assert.lengthOf(falso.tabla('/queue/simple'), 0)
        // Globales con la capacidad del enlace
        const globalBajada = falso.tabla('/queue/tree').find((o) => o.name === nombreGlobal('bajada'))!
        assert.containsSubset(globalBajada, { parent: 'global', comment: 'argosisp:global:bajada' })
        assert.isTrue(igual(globalBajada['max-limit'], '100M'))
        assert.isTrue(
            igual(
                falso.tabla('/queue/tree').find((o) => o.name === nombreGlobal('subida'))!['max-limit'],
                '50M',
            ),
        )
        // PCQ por plan: pcq-rate = MIR y /64 en IPv6
        const tipo = falso.tabla('/queue/type').find((o) => o.name === nombreNodo(planId, false, 'bajada'))!
        assert.containsSubset(tipo, {
            kind: 'pcq',
            'pcq-classifier': 'dst-address',
            'pcq-dst-address6-mask': '64',
        })
        assert.isTrue(igual(tipo['pcq-rate'], '20M'))
        const tipoSubida = falso
            .tabla('/queue/type')
            .find((o) => o.name === nombreNodo(planId, false, 'subida'))!
        assert.containsSubset(tipoSubida, { 'pcq-classifier': 'src-address', 'pcq-src-address6-mask': '64' })
        assert.isTrue(igual(tipoSubida['pcq-rate'], '5M'))
        assert.isTrue(
            igual(
                falso.tabla('/queue/type').find((o) => o.name === nombreNodo(planId, true, 'bajada'))![
                    'pcq-rate'
                ],
                '2M',
            ),
        )
        // Hijo del plan: MIR × 4 / 4 = 20M, CIR (5M) × 4 = 20M, prioridad del plan
        assert.containsSubset(nodo(planId, 'bajada'), {
            parent: nombreGlobal('bajada'),
            'packet-mark': nombreNodo(planId, false, 'bajada'),
            queue: nombreNodo(planId, false, 'bajada'),
            priority: '8',
            comment: `${commentPlan(planId)}:bajada`,
        })
        assert.isTrue(igual(nodo(planId, 'bajada')!['max-limit'], '20M'))
        assert.isTrue(igual(nodo(planId, 'bajada')!['limit-at'], '20M'))
        assert.isTrue(igual(nodo(planId, 'subida')!['max-limit'], '5M'))
        // Mangle sin passthrough en IPv4 e IPv6, por lista de destino (bajada) y de origen (subida)
        for (const ruta of ['/ip/firewall/mangle', '/ipv6/firewall/mangle'] as const) {
            assert.containsSubset(falso.conComment(ruta, `${commentPlan(planId)}:bajada`)[0], {
                chain: 'forward',
                action: 'mark-packet',
                'dst-address-list': listaPlan(planId, false),
                'new-packet-mark': nombreNodo(planId, false, 'bajada'),
                passthrough: 'false',
            })
            assert.containsSubset(falso.conComment(ruta, `${commentPlan(planId)}:limitado:subida`)[0], {
                'src-address-list': listaPlan(planId, true),
                'new-packet-mark': nombreNodo(planId, true, 'subida'),
            })
        }
        // Listas: IPv4 y el /56 de cada servicio (target IPv6 siempre incluido)
        assert.sameMembers(
            lista4(listaPlan(planId, false)),
            servicios.map((s) => s.ipv4),
        )
        assert.sameMembers(
            lista6(listaPlan(planId, false)),
            servicios.map((s) => s.prefijo_delegado_v6),
        )

        // Suspendido: sale de la lista; cola simple mínima y suspendidos; el nodo baja a 3 activos.
        const s3 = servicios[3]!
        await cambiarEstado(s3.id, 'suspendido')
        assert.notInclude(lista4(listaPlan(planId, false)), s3.ipv4)
        assert.notInclude(lista6(listaPlan(planId, false)), s3.prefijo_delegado_v6!)
        assert.include(lista4('suspendidos'), s3.ipv4)
        const colaSuspendida = falso.conComment('/queue/simple', commentServicio(s3.id))
        assert.lengthOf(colaSuspendida, 1)
        assert.isTrue(igual(colaSuspendida[0]!['max-limit'], '256k/256k'))
        assert.isTrue(igual(nodo(planId, 'bajada')!['max-limit'], '15M'))
        assert.isTrue(igual(nodo(planId, 'bajada')!['max-limit'], `${await maxNodo(planId, 3)}k`))
        assert.isTrue(igual(nodo(planId, 'bajada')!['limit-at'], '15M'))

        // Limitado: a la lista del plan limitado con su PCQ; los dos nodos se recalculan.
        const s2 = servicios[2]!
        await cambiarEstado(s2.id, 'limitado')
        assert.notInclude(lista4(listaPlan(planId, false)), s2.ipv4)
        assert.include(lista4(listaPlan(planId, true)), s2.ipv4)
        assert.include(lista6(listaPlan(planId, true)), s2.prefijo_delegado_v6!)
        assert.isTrue(igual(nodo(planId, 'bajada')!['max-limit'], '10M'))
        // limitado: MIR limitado 2M × 1 / 4 = 500k; CIR 25 % de 2M = 500k
        assert.isTrue(igual(nodo(planId, 'bajada', true)!['max-limit'], '500k'))
        assert.isTrue(igual(nodo(planId, 'bajada', true)!['limit-at'], '500k'))
        // Reactivar: vuelve a la lista del plan y sin cola simple
        await cambiarEstado(s3.id, 'activo')
        assert.include(lista4(listaPlan(planId, false)), s3.ipv4)
        assert.lengthOf(falso.conComment('/queue/simple', commentServicio(s3.id)), 0)
        assert.notInclude(lista4('suspendidos'), s3.ipv4)
        assert.isTrue(igual(nodo(planId, 'bajada')!['max-limit'], '15M'))
    })

    test('cambio de plan entre dos planes: listas y nodos de los dos; el viejo desaparece al vaciarse', async ({
        client,
        assert,
    }) => {
        const planA = await plan14()
        const planB = await crearPlanFila({
            bajada_kbps: 50000,
            subida_kbps: 10000,
            bajada_limitada_kbps: 5000,
            subida_limitada_kbps: 2000,
            reuso: 2,
            prioridad: 4,
        })
        const s1 = await crear(client, planA)
        const s2 = await crear(client, planA)
        const mover = async (s: { id: number }) => {
            const ctx = contextoPrueba()
            const actual = await db.from('core.servicios').where('id', s.id).firstOrFail()
            await new EditarServicio().execute({ id: s.id, version: actual.version, plan_id: planB }, ctx)
            await entregar(await eventosDe(ctx.requestId))
        }
        await mover(s1)
        assert.deepEqual(lista4(listaPlan(planA, false)), [s2.ipv4])
        assert.deepEqual(lista4(listaPlan(planB, false)), [s1.ipv4])
        assert.deepEqual(lista6(listaPlan(planB, false)), [s1.prefijo_delegado_v6])
        assert.isTrue(igual(nodo(planA, 'bajada')!['max-limit'], '5M'))
        assert.isTrue(igual(nodo(planB, 'bajada')!['max-limit'], '25M'))
        assert.equal(nodo(planB, 'bajada')!.priority, '4')

        await mover(s2)
        // Nada del plan A: ni tipos, ni nodos, ni mangle, ni listas
        const deA = (o: { name?: string; comment?: string; list?: string }) =>
            [o.name, o.comment, o.list].some(
                (v) =>
                    v?.startsWith(`argosisp-plan-${planA}-`) ||
                    v === listaPlan(planA, false) ||
                    v?.startsWith(`${commentPlan(planA)}:`),
            )
        for (const ruta of [
            '/queue/type',
            '/queue/tree',
            '/ip/firewall/mangle',
            '/ipv6/firewall/mangle',
            '/ip/firewall/address-list',
            '/ipv6/firewall/address-list',
        ] as const) {
            assert.lengthOf(falso.tabla(ruta).filter(deA), 0, ruta)
        }
        assert.isTrue(igual(nodo(planB, 'bajada')!['max-limit'], '50M'))
        assert.sameMembers(lista4(listaPlan(planB, false)), [s1.ipv4, s2.ipv4])
        // Los globales siguen (el router sigue en arbol_pcq)
        assert.isDefined(falso.tabla('/queue/tree').find((o) => o.name === nombreGlobal('bajada')))
    })

    test('PPPoE: la sesión pone su IPv4, /64 y /56 en la lista del plan y la quita al terminar', async ({
        client,
        assert,
    }) => {
        const planId = await plan14()
        const userPpp = unico('ppp')
        const s = await crear(client, planId, {
            tipo_conexion: 'pppoe',
            user_ppp: userPpp,
            pass_ppp: 'clave-larga-1',
            ipv6_modo: 'ninguno',
            prefijo_delegado_v6: undefined,
        })
        // Sin sesión todavía: el árbol del plan existe, las listas no tienen nada del servicio.
        assert.isDefined(nodo(planId, 'bajada'))
        assert.lengthOf(falso.conComment('/ip/firewall/address-list', commentServicio(s.id)), 0)

        const acct = unico('81a0')
        await db.table('network.sesiones').insert({
            servicio_id: s.id,
            router_id: routerId,
            nas_ip: '127.0.0.9',
            acct_session_id: acct,
            user_ppp: userPpp,
            ipv4: '10.99.0.7',
            prefijo_enlace_v6: '2001:db8:99:7::/64',
            prefijo_delegado_v6: '2001:db8:99:700::/56',
        })
        const payload = {
            servicio_id: s.id,
            nas_ip: '127.0.0.9',
            acct_session_id: acct,
            ipv4: '10.99.0.7',
            prefijos_v6: ['2001:db8:99:7::/64', '2001:db8:99:700::/56'],
        }
        await entregar([{ id: unico('ev'), evento: 'sesion.iniciada', payload }])
        assert.deepEqual(lista4(listaPlan(planId, false)), ['10.99.0.7'])
        assert.sameMembers(lista6(listaPlan(planId, false)), ['2001:db8:99:7::/64', '2001:db8:99:700::/56'])
        assert.lengthOf(falso.conComment('/ipv6/firewall/address-list', commentServicioV6(s.id, 'enlace')), 1)
        assert.lengthOf(falso.tabla('/queue/simple'), 0)
        assert.isTrue(igual(nodo(planId, 'bajada')!['max-limit'], `${await maxNodo(planId, 1)}k`))

        // Limitado por evento: pasa a la lista del plan limitado sin reconectar
        await cambiarEstado(s.id, 'limitado')
        assert.deepEqual(lista4(listaPlan(planId, true)), ['10.99.0.7'])
        assert.lengthOf(lista4(listaPlan(planId, false)), 0)

        await db.from('network.sesiones').where('acct_session_id', acct).update({ fin: new Date() })
        await entregar([{ id: unico('ev'), evento: 'sesion.terminada', payload }])
        assert.lengthOf(lista4(listaPlan(planId, true)), 0)
        assert.lengthOf(lista6(listaPlan(planId, true)), 0)
    })

    test('reconciliador: repone mangle y PCQ borrados, corrige el nodo editado y no reescribe sin diferencias', async ({
        client,
        assert,
    }) => {
        const planId = await plan14()
        const s1 = await crear(client, planId)
        await crear(client, planId)
        const reconciliar = () =>
            new ReconciliarRouterOS(OPCIONES).execute(
                { router_id: routerId, motivo: 'manual' },
                contextoPrueba(),
            )

        falso.borrarAMano('/ipv6/firewall/mangle', (o) => o.comment === `${commentPlan(planId)}:bajada`)
        falso.borrarAMano('/ip/firewall/address-list', (o) => o.comment === commentServicio(s1.id))
        Object.assign(nodo(planId, 'bajada')!, { 'max-limit': '1000000' })
        // Un tipo PCQ de un plan que ya no está en el router: huérfano (sin nodo que lo use)
        falso.tabla('/queue/type').push({ '.id': '*AA0', name: 'argosisp-plan-999999-bajada', kind: 'pcq' })
        // El ejemplo de lab.rsc (plan 0) no se toca
        falso.tabla('/queue/type').push({ '.id': '*AA1', name: 'argosisp-plan-0-bajada', kind: 'pcq' })

        const r = await reconciliar()
        assert.isNull(r.error)
        assert.lengthOf(falso.conComment('/ipv6/firewall/mangle', `${commentPlan(planId)}:bajada`), 1)
        assert.include(lista4(listaPlan(planId, false)), s1.ipv4)
        assert.isTrue(igual(nodo(planId, 'bajada')!['max-limit'], '10M'))
        assert.isUndefined(falso.tabla('/queue/type').find((o) => o.name === 'argosisp-plan-999999-bajada'))
        assert.isDefined(falso.tabla('/queue/type').find((o) => o.name === 'argosisp-plan-0-bajada'))

        const escrituras = falso.escrituras.length
        const otra = await reconciliar()
        assert.lengthOf(otra.correcciones, 0)
        assert.equal(falso.escrituras.length, escrituras)
    })
})
