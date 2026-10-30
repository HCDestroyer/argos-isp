import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar, claveDesdeTexto } from '#shared/cifrado'
import env from '#start/env'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import {
    crearClienteFila,
    crearEscenarioRouter,
    crearPlanFila,
    crearServicioFila,
} from '#tests/core/fabricas'
import { RouterOSFalso } from '#network/routeros/falso'
import { clienteDeRouter } from '#network/routeros/router'
import { normalizarValor } from '#network/routeros/normalizar'
import ReconciliarRouterOS from '#network/routeros/actions/reconciliar_router'
import { ConsumidorRouterOS } from '#network/routeros/consumidor'
import { ejecutarCambioControl } from '#network/routeros/cambio_control'
import { bitacoraRed, type OpcionesDispatcher } from '#network/routeros/dispatcher'
import { commentServicio } from '#network/routeros/estado_deseado'
import { commentPlan, listaPlan, nombrePadre } from '#network/routeros/velocidad_router'
import IniciarSesion from '#network/sesiones/actions/iniciar_sesion'
import { construirRegistroAaa } from '#core/aaa'
import {
    estrategiasDeControl,
    validarEstrategias,
    type Estrategia,
    type EstrategiasRouter,
} from '#network/estrategia_velocidad'
import type { EventoEntrante } from '#shared/eventos_bus'

/**
 * Control de velocidad por capas (`contratos/control-velocidad.md`): cada estrategia genera sus objetos
 * en el router (RouterOS falso), la matriz responde 422 con el porqué, la migración no cambia nada y
 * cambiar de estrategia no corta a nadie (crear → mover → borrar; las sesiones PPPoE conservan lo suyo).
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

const EXTRAS = { rafaga: true, prioridad: true, garantizado: true, excluir_fasttrack: true, qos: false }
const e = (
    aplicacion: Estrategia['aplicacion'],
    padre: Estrategia['padre'],
    tipo_cola: Estrategia['tipo_cola'] = 'default',
): Estrategia => ({
    aplicacion,
    padre,
    tipo_cola,
    extras: { ...EXTRAS },
})
const todas = (pppoe: Estrategia, wisp: Estrategia): EstrategiasRouter => ({
    pppoe,
    ip_estatica: wisp,
    dhcp_fija: wisp,
})
const igual = (a: unknown, b: unknown) => normalizarValor(a) === normalizarValor(b)

async function eventosDe(requestId: string): Promise<EventoEntrante[]> {
    const filas = await db.from('audit.outbox').where('request_id', requestId).orderBy('id')
    return filas.map((f) => ({
        id: Number(f.id),
        evento: f.evento,
        payload: f.payload,
        requestId: f.request_id,
    }))
}

test.group('Control de velocidad · matriz de combinaciones', () => {
    const validar = (
        estrategias: EstrategiasRouter,
        extra: Partial<Parameters<typeof validarEstrategias>[0]> = {},
    ) =>
        validarEstrategias({
            estrategias,
            planes: [],
            routeros_version: '7.24.5 (stable)',
            capacidad_bajada_kbps: 100_000,
            capacidad_subida_kbps: 50_000,
            ...extra,
        })

    test('los atajos de la migración son válidos', ({ assert }) => {
        assert.deepEqual(validar(estrategiasDeControl('simple')).errores, [])
        assert.deepEqual(validar(estrategiasDeControl('arbol_pcq')).errores, [])
    })

    test('combinaciones inválidas con su porqué', ({ assert }) => {
        const reglas = (estrategias: EstrategiasRouter, extra = {}) =>
            validar(estrategias, extra).errores.map((x) => `${x.field}:${x.rule}`)
        assert.include(
            reglas(todas(e('radius_rate_limit', 'ninguno'), e('perfil_ppp', 'ninguno'))),
            'estrategia_velocidad.ip_estatica.aplicacion:aplicacion_tipo',
        )
        assert.include(
            reglas(todas(e('cola_simple', 'ninguno'), e('cola_simple', 'ninguno'))),
            'estrategia_velocidad.pppoe.aplicacion:aplicacion_tipo',
        )
        assert.include(
            reglas(todas(e('arbol_pcq', 'jerarquico', 'default'), e('arbol_pcq', 'jerarquico', 'pcq'))),
            'estrategia_velocidad.pppoe.tipo_cola:tipo_cola',
        )
        assert.include(
            reglas(todas(e('radius_rate_limit', 'ninguno', 'pcq'), e('cola_simple', 'ninguno'))),
            'estrategia_velocidad.pppoe.tipo_cola:tipo_cola',
        )
        assert.include(
            reglas(todas(e('radius_rate_limit', 'ninguno', 'cake'), e('cola_simple', 'ninguno')), {
                routeros_version: '6.49.10 (long-term)',
            }),
            'estrategia_velocidad.pppoe.tipo_cola:version',
        )
        assert.include(
            reglas(todas(e('arbol_pcq', 'por_router', 'pcq'), e('cola_simple', 'por_router'))),
            'estrategia_velocidad:familia_router',
        )
        const mensaje = validar(todas(e('radius_rate_limit', 'ninguno'), e('perfil_ppp', 'ninguno')))
            .errores[0]!.message
        assert.match(mensaje, /perfil_ppp no aplica a IP estática/)
    })

    test('mismo plan, misma familia: mismo padre y extras; advertencias sin bloquear', ({ assert }) => {
        const r = validar(todas(e('pcq_plan', 'ninguno', 'pcq'), e('pcq_plan', 'por_plan', 'pcq')))
        assert.include(
            r.errores.map((x) => x.rule),
            'plan_consistente',
        )
        const ok = validar(todas(e('radius_rate_limit', 'ninguno', 'cake'), e('cola_simple', 'ninguno')), {
            routeros_version: null,
            capacidad_bajada_kbps: null,
        })
        assert.deepEqual(ok.errores, [])
        assert.includeMembers(
            ok.advertencias.map((a) => a.regla),
            ['version_desconocida', 'sin_padre_prioridad'],
        )
    })
})

test.group('Control de velocidad · estrategias en el router', (group) => {
    let falso: RouterOSFalso
    let token: string
    let tokenAdmin: string
    let routerId: number
    let clienteId: number

    group.each.setup(async () => {
        falso = new RouterOSFalso()
        await falso.levantar()
        ;({ token } = await usuarioConRoles(['soporte']))
        ;({ token: tokenAdmin } = await usuarioConRoles(['admin']))
        ;({ routerId } = await crearEscenarioRouter())
        await db
            .from('network.routers')
            .where('id', routerId)
            .update({
                host: falso.url,
                api_usuario: falso.usuario,
                api_password: cifrar(falso.password),
                nas_ip: `127.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`,
                capacidad_bajada_kbps: 1_000_000,
                capacidad_subida_kbps: 500_000,
            })
        clienteId = await crearClienteFila()
        Object.assign(falso.tabla('/ppp/profile')[0]!, {
            'local-address': '10.10.0.1',
            'remote-address': 'pool',
        })
        return () => falso.cerrar()
    })

    const plan = (reuso = 1) =>
        crearPlanFila({
            bajada_kbps: 20000,
            subida_kbps: 5000,
            bajada_limitada_kbps: 2000,
            subida_limitada_kbps: 1000,
            reuso,
        })

    async function wisp(client: any, planId: number) {
        const r = await estado(
            client.post('/api/v1/servicios').bearerToken(token).json({
                plantilla_facturacion_id: null,
                cliente_id: clienteId,
                router_id: routerId,
                plan_id: planId,
                tipo_conexion: 'ip_estatica',
            }),
            201,
        )
        return r.body() as { id: number; ipv4: string }
    }

    async function pppoeConSesion(planId: number, ipv4: string) {
        const userPpp = unico('ppp')
        const servicioId = await crearServicioFila({
            cliente_id: clienteId,
            router_id: routerId,
            plan_id: planId,
            user_ppp: userPpp,
            ipv6_modo: 'ninguno',
        })
        const router = await db.from('network.routers').where('id', routerId).firstOrFail()
        await new IniciarSesion().execute(
            {
                tipo: 'Start',
                nas_ip: router.nas_ip,
                acct_session_id: unico('ses'),
                user_ppp: userPpp,
                ipv4,
                prefijo_enlace_v6: null,
                prefijo_delegado_v6: null,
                bytes_in: '0',
                bytes_out: '0',
                duracion_s: null,
                causa_fin: null,
                evento_en: new Date().toISOString(),
            },
            contextoPrueba(),
        )
        return { servicioId, userPpp }
    }

    async function estrategia(client: any, estrategias: EstrategiasRouter, reconectar = false) {
        const router = await db.from('network.routers').where('id', routerId).firstOrFail()
        return estado(
            client
                .post(`/api/v1/routers/${routerId}/cambiar-estrategia-velocidad`)
                .bearerToken(tokenAdmin)
                .json({ version: router.version, estrategia_velocidad: estrategias, reconectar }),
            200,
        )
    }

    const reconciliar = () =>
        new ReconciliarRouterOS(OPCIONES).execute({ router_id: routerId, motivo: 'manual' }, contextoPrueba())
    const cola = (comment: string) => falso.conComment('/queue/simple', comment)[0]

    test('radius_rate_limit + cola_simple con padre por_router: el techo del router y todo cuelga de él', async ({
        client,
        assert,
    }) => {
        await estrategia(client, todas(e('radius_rate_limit', 'por_router'), e('cola_simple', 'por_router')))
        const p = await plan()
        const s = await wisp(client, p)
        await reconciliar()
        const techo = cola('argosisp:router')!
        assert.equal(techo.name, 'argosisp-router')
        assert.isTrue(igual(techo['max-limit'], '500M/1000M'))
        assert.include(techo.target!, `${s.ipv4}/32`)
        assert.equal(cola(commentServicio(s.id))!.parent, 'argosisp-router')
        assert.containsSubset(falso.conComment('/ppp/profile', commentPlan(p))[0], {
            name: `plan-${p}`,
            'parent-queue': 'argosisp-router',
        })
        // aaa manda el perfil del plan aunque el reuso sea 1
        const pppoe = await pppoeConSesion(p, '10.88.1.1')
        const registro = await construirRegistroAaa(pppoe.userPpp)
        assert.deepEqual(registro!.velocidad, {
            aplicacion: 'radius_rate_limit',
            grupo: `plan-${p}`,
            rate_limit: true,
            rate_limit_limitado: true,
        })
    })

    test('perfil_ppp: el rate-limit vive en el perfil del plan y aaa solo manda el grupo en activo', async ({
        client,
        assert,
    }) => {
        await estrategia(client, todas(e('perfil_ppp', 'ninguno'), e('cola_simple', 'ninguno')))
        const p = await plan()
        const pppoe = await pppoeConSesion(p, '10.88.1.2')
        await reconciliar()
        const perfil = falso.conComment('/ppp/profile', commentPlan(p))[0]!
        assert.equal(perfil.name, `plan-${p}`)
        assert.isTrue(igual(perfil['rate-limit']!.split(' ')[0], '5M/20M'))
        assert.isUndefined(perfil['parent-queue'])
        const registro = await construirRegistroAaa(pppoe.userPpp)
        assert.deepEqual(registro!.velocidad, {
            aplicacion: 'perfil_ppp',
            grupo: `plan-${p}`,
            rate_limit: false,
            rate_limit_limitado: true,
        })
    })

    test('cola_simple con sfq y jerarquico: router → plan → cliente, con su tipo de cola', async ({
        client,
        assert,
    }) => {
        await estrategia(
            client,
            todas(e('radius_rate_limit', 'jerarquico'), e('cola_simple', 'jerarquico', 'sfq')),
        )
        const p = await plan()
        const s = await wisp(client, p)
        await reconciliar()
        assert.containsSubset(
            falso.tabla('/queue/type').find((o) => o.name === 'argosisp-sfq'),
            { kind: 'sfq' },
        )
        const servicio = cola(commentServicio(s.id))!
        assert.equal(servicio.queue, 'argosisp-sfq/argosisp-sfq')
        assert.equal(servicio.parent, nombrePadre(p))
        assert.equal(cola(commentPlan(p))!.parent, 'argosisp-router')
        assert.isDefined(cola('argosisp:router'))
    })

    test('pcq_plan: tipos PCQ y una cola del plan con los clientes en el target, sin cola por servicio', async ({
        client,
        assert,
    }) => {
        await estrategia(client, todas(e('pcq_plan', 'ninguno', 'pcq'), e('pcq_plan', 'ninguno', 'pcq')))
        const p = await plan()
        const s = await wisp(client, p)
        await pppoeConSesion(p, '10.88.1.3')
        await reconciliar()
        assert.containsSubset(
            falso.tabla('/queue/type').find((o) => o.name === `argosisp-plan-${p}-pcq-bajada`),
            { kind: 'pcq', 'pcq-classifier': 'dst-address' },
        )
        const colaPlan = cola(`${commentPlan(p)}:pcq`)!
        assert.equal(colaPlan.queue, `argosisp-plan-${p}-pcq-subida/argosisp-plan-${p}-pcq-bajada`)
        assert.includeMembers(colaPlan.target!.split(','), [`${s.ipv4}/32`, '10.88.1.3/32'])
        assert.isDefined(cola(`${commentPlan(p)}:pcq:limitado`))
        assert.isUndefined(cola(commentServicio(s.id)))
    })

    test('arbol_pcq con padre por_plan: sin padres globales, los nodos del plan cuelgan de global', async ({
        client,
        assert,
    }) => {
        await estrategia(client, todas(e('arbol_pcq', 'por_plan', 'pcq'), e('arbol_pcq', 'por_plan', 'pcq')))
        const p = await plan(4)
        await wisp(client, p)
        await reconciliar()
        const arbol = falso.tabla('/queue/tree')
        assert.isUndefined(arbol.find((o) => o.name === 'argosisp-global-bajada'))
        const nodo = arbol.find((o) => o.comment === `${commentPlan(p)}:bajada`)!
        assert.equal(nodo.parent, 'global')
        assert.isTrue(igual(nodo['max-limit'], '5M'))
    })

    test('dos formas en el mismo router: un plan por árbol y otro por cola simple (excepción del plan)', async ({
        client,
        assert,
    }) => {
        const arbol = await plan()
        const simple = await plan()
        const router = await db.from('network.routers').where('id', routerId).firstOrFail()
        // Inválida primero (perfil_ppp para IP estática): 422 con el porqué
        const mal = await client
            .post(`/api/v1/planes/${arbol}/routers/${routerId}/estrategia-velocidad`)
            .bearerToken(tokenAdmin)
            .json({ estrategia_velocidad: { ip_estatica: { aplicacion: 'perfil_ppp' } } })
        mal.assertStatus(422)
        assert.equal(mal.body().errors[0].rule, 'aplicacion_tipo')
        await estado(
            client
                .post(`/api/v1/planes/${arbol}/routers/${routerId}/estrategia-velocidad`)
                .bearerToken(tokenAdmin)
                .json({
                    estrategia_velocidad: {
                        pppoe: { aplicacion: 'arbol_pcq', padre: 'por_plan', tipo_cola: 'pcq' },
                        ip_estatica: { aplicacion: 'arbol_pcq', padre: 'por_plan', tipo_cola: 'pcq' },
                        dhcp_fija: { aplicacion: 'arbol_pcq', padre: 'por_plan', tipo_cola: 'pcq' },
                    },
                }),
            200,
        )
        assert.equal(router.control_velocidad, 'simple')
        const a = await wisp(client, arbol)
        const b = await wisp(client, simple)
        await reconciliar()
        assert.include(
            falso
                .tabla('/ip/firewall/address-list')
                .filter((o) => o.list === listaPlan(arbol, false))
                .map((o) => o.address),
            a.ipv4,
        )
        assert.isUndefined(cola(commentServicio(a.id)))
        assert.isDefined(cola(commentServicio(b.id)))
    })

    test('combinación inválida por la API: 422 con errors[]; la misma estrategia: 200 sin evento', async ({
        client,
        assert,
    }) => {
        const router = await db.from('network.routers').where('id', routerId).firstOrFail()
        const r = await client
            .post(`/api/v1/routers/${routerId}/cambiar-estrategia-velocidad`)
            .bearerToken(tokenAdmin)
            .json({
                version: router.version,
                estrategia_velocidad: todas(
                    e('arbol_pcq', 'jerarquico', 'default'),
                    e('cola_simple', 'ninguno'),
                ),
            })
        r.assertStatus(422)
        assert.equal(r.body().errors[0].field, 'estrategia_velocidad.pppoe.tipo_cola')
        assert.match(r.body().errors[0].message, /necesita PCQ/)
        // Solo admin cambia la estrategia
        const prohibido = await client
            .post(`/api/v1/routers/${routerId}/cambiar-estrategia-velocidad`)
            .bearerToken(token)
            .json({ version: router.version, estrategia_velocidad: estrategiasDeControl('simple') })
        prohibido.assertStatus(403)
        // La migrada es la de hoy: mandar la misma no cambia nada ni emite evento
        const req = unico('req')
        await estado(
            client
                .post(`/api/v1/routers/${routerId}/cambiar-estrategia-velocidad`)
                .bearerToken(tokenAdmin)
                .header('X-Request-Id', req)
                .json({ version: router.version, estrategia_velocidad: estrategiasDeControl('simple') }),
            200,
        )
        assert.lengthOf(await eventosDe(req), 0)
    })

    test('migración: un router nuevo y el atajo arbol_pcq quedan con la estrategia equivalente; reconciliar dos veces no cambia nada', async ({
        client,
        assert,
    }) => {
        const router = await db.from('network.routers').where('id', routerId).firstOrFail()
        assert.deepEqual(router.estrategia_velocidad, estrategiasDeControl('simple'))
        const p = await plan(4)
        await wisp(client, p)
        await reconciliar()
        const escrituras = falso.escrituras.length
        const otra = await reconciliar()
        assert.lengthOf(otra.correcciones, 0)
        assert.equal(falso.escrituras.length, escrituras)
        // El atajo obsoleto deja la estrategia por capas equivalente
        await estado(
            client
                .post(`/api/v1/routers/${routerId}/cambiar-control-velocidad`)
                .bearerToken(tokenAdmin)
                .json({ version: router.version, control_velocidad: 'arbol_pcq' }),
            200,
        )
        const despues = await db.from('network.routers').where('id', routerId).firstOrFail()
        assert.deepEqual(despues.estrategia_velocidad, estrategiasDeControl('arbol_pcq'))
    })

    test('cambiar de estrategia no corta: WISP crea lo nuevo antes de borrar lo viejo y el PPPoE recibe CoA, no Disconnect', async ({
        client,
        assert,
    }) => {
        const p = await plan(4)
        const s = await wisp(client, p)
        const pppoe = await pppoeConSesion(p, '10.88.1.4')
        await reconciliar()
        const desde = falso.escrituras.length

        // radius → perfil_ppp (PPPoE) y cola_simple → arbol_pcq no se puede (familias con padre); se
        // pasa todo a pcq_plan con padre por_plan.
        const nueva = todas(e('pcq_plan', 'por_plan', 'pcq'), e('pcq_plan', 'por_plan', 'pcq'))
        const vista = await estado(
            client
                .post(`/api/v1/routers/${routerId}/vista-previa-estrategia`)
                .bearerToken(tokenAdmin)
                .json({ estrategia_velocidad: nueva }),
            200,
        )
        assert.isTrue(vista.body().valida)
        assert.equal(vista.body().sesiones_a_desconectar, 0)
        assert.equal(vista.body().sesiones_conservan, 1)
        assert.deepEqual(vista.body().orden, ['preparar', 'lotes', 'terminar'])
        assert.isTrue(vista.body().crear.some((o: { clave: string }) => o.clave === `${commentPlan(p)}:pcq`))
        assert.isTrue(vista.body().borrar.some((o: { clave: string }) => o.clave === commentServicio(s.id)))

        const req = unico('req')
        const router = await db.from('network.routers').where('id', routerId).firstOrFail()
        await estado(
            client
                .post(`/api/v1/routers/${routerId}/cambiar-estrategia-velocidad`)
                .bearerToken(tokenAdmin)
                .header('X-Request-Id', req)
                .json({ version: router.version, estrategia_velocidad: nueva }),
            200,
        )
        const eventos = await eventosDe(req)
        assert.deepEqual(
            eventos.map((x) => x.evento),
            ['router.estrategia_cambiada'],
        )
        const consumidor = new ConsumidorRouterOS(OPCIONES, (entrada) =>
            ejecutarCambioControl(entrada, { ...OPCIONES, pausaMs: 0 }),
        )
        for (const ev of eventos) await consumidor.procesar(ev)

        // WISP: la cola PCQ del plan (con el cliente) se creó antes de borrar su cola propia
        const escrituras = falso.escrituras.slice(desde)
        const creaPcq = escrituras.findIndex(
            (x) => x.metodo === 'PUT' && x.cuerpo?.comment === `${commentPlan(p)}:pcq`,
        )
        const borraCola = escrituras.findIndex(
            (x) => x.metodo === 'DELETE' && x.ruta.startsWith('/rest/queue/simple'),
        )
        assert.isAtLeast(creaPcq, 0)
        assert.isAbove(borraCola, creaPcq)
        assert.isUndefined(cola(commentServicio(s.id)))
        assert.include(cola(`${commentPlan(p)}:pcq`)!.target!, `${s.ipv4}/32`)
        // PPPoE: ningún Disconnect; la sesión entró con radius_rate_limit y lo conserva hasta reconectar
        const desconexiones = await db
            .from('audit.outbox')
            .where('evento', 'sesion.desconexion_solicitada')
            .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [pppoe.servicioId])
        assert.lengthOf(desconexiones, 0)
        assert.notInclude(cola(`${commentPlan(p)}:pcq`)!.target!, '10.88.1.4/32')
        // aaa ya entrega la estrategia nueva a la próxima conexión
        const registro = await construirRegistroAaa(pppoe.userPpp)
        assert.equal(registro!.velocidad.aplicacion, 'pcq_plan')
    })

    test('cambiar de estrategia con reconectar: Disconnect por lotes a las sesiones PPPoE', async ({
        client,
        assert,
    }) => {
        const p = await plan(4)
        const pppoe = await pppoeConSesion(p, '10.88.1.5')
        const req = unico('req')
        const router = await db.from('network.routers').where('id', routerId).firstOrFail()
        await estado(
            client
                .post(`/api/v1/routers/${routerId}/cambiar-estrategia-velocidad`)
                .bearerToken(tokenAdmin)
                .header('X-Request-Id', req)
                .json({
                    version: router.version,
                    estrategia_velocidad: todas(e('perfil_ppp', 'por_plan'), e('cola_simple', 'por_plan')),
                    reconectar: true,
                }),
            200,
        )
        const consumidor = new ConsumidorRouterOS(OPCIONES, (entrada) =>
            ejecutarCambioControl(entrada, { ...OPCIONES, pausaMs: 0 }),
        )
        for (const ev of await eventosDe(req)) await consumidor.procesar(ev)
        const desconexiones = await db
            .from('audit.outbox')
            .where('evento', 'sesion.desconexion_solicitada')
            .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [pppoe.servicioId])
        assert.lengthOf(desconexiones, 1)
    })

    test('sincronizar plan: CoA a las sesiones vivas, resumen por router y permiso planes.sincronizar', async ({
        client,
        assert,
    }) => {
        const p = await plan(4)
        const s = await wisp(client, p)
        const pppoe = await pppoeConSesion(p, '10.88.1.6')
        await db.from('network.planes').where('id', p).update({ bajada_kbps: 40000, subida_kbps: 10000 })
        const { token: tecnico } = await usuarioConRoles(['tecnico'])
        const { token: cajero } = await usuarioConRoles(['cajero'])
        await estado(client.post(`/api/v1/planes/${p}/sincronizar`).bearerToken(cajero), 403)
        // Sin `OPCIONES` el reconciliador usa el cliente de producción contra el falso (mismo resultado).
        const r = await estado(client.post(`/api/v1/planes/${p}/sincronizar`).bearerToken(tecnico), 200)
        const fila = r.body().routers.find((x: { router_id: number }) => x.router_id === routerId)
        assert.containsSubset(fila, {
            servicios: 2,
            sesiones_actualizadas: 1,
            sesiones_sin_coa: 0,
            reconciliado: true,
        })
        assert.isAbove(fila.colas_cambiadas, 0)
        assert.equal(r.body().aaa_reescritos, 1)
        const coa = await db
            .from('audit.outbox')
            .where('evento', 'sesion.velocidad_solicitada')
            .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [pppoe.servicioId])
        assert.lengthOf(coa, 1)
        assert.equal(coa[0].payload.estado, 'activo')
        assert.isTrue(igual(coa[0].payload.rate_limit.split(' ')[0], '10M/40M'))
        assert.lengthOf(
            await db
                .from('audit.outbox')
                .where('evento', 'sesion.desconexion_solicitada')
                .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [pppoe.servicioId]),
            0,
        )
        // la cola WISP y el padre del plan ya tienen la velocidad nueva
        assert.isTrue(igual(cola(commentServicio(s.id))!['max-limit'], '10M/40M'))
        assert.isDefined(
            await db
                .from('audit.acciones')
                .where('accion', 'planes.sincronizar')
                .where('entidad_id', String(p))
                .first(),
        )
    })
})
