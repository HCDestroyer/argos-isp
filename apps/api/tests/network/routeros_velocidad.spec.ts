import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar, claveDesdeTexto } from '#shared/cifrado'
import env from '#start/env'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'
import CambiarEstadoServicio from '#core/actions/cambiar_estado_servicio'
import EditarServicio from '#core/actions/editar_servicio'
import RetirarServicio from '#core/actions/retirar_servicio'
import { RouterOSFalso } from '#network/routeros/falso'
import { clienteDeRouter } from '#network/routeros/router'
import { normalizarValor } from '#network/routeros/normalizar'
import { ConsumidorRouterOS } from '#network/routeros/consumidor'
import ReconciliarRouterOS from '#network/routeros/actions/reconciliar_router'
import { bitacoraRed, type OpcionesDispatcher } from '#network/routeros/dispatcher'
import { commentServicio } from '#network/routeros/estado_deseado'
import { commentPlan, nombrePadre, TARGET_SIN_HIJAS } from '#network/routeros/velocidad_router'
import { leerVelocidad, limitesPadrePlan } from '#network/velocidad'
import type { EventoEntrante } from '#shared/eventos_bus'

/**
 * Control de velocidad en modo `simple` con reuso (semana 2, tanda 2, tarea 2;
 * `contratos/velocidad.md`, "Modo simple"): cola padre por plan y router, colas WISP como hijas,
 * perfil PPP `plan-<id>` con `parent-queue` para PPPoE, recálculo por evento y reconciliador.
 * Postgres real y el RouterOS falso (valida `parent` y `parent-queue` como RouterOS).
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

test.group('RouterOS · velocidad en modo simple con reuso', (group) => {
    let falso: RouterOSFalso
    let token: string
    let routerId: number
    let clienteId: number

    group.each.setup(async () => {
        falso = new RouterOSFalso()
        await falso.levantar()
        ;({ token } = await usuarioConRoles(['soporte']))
        ;({ routerId } = await crearEscenarioRouter())
        await db
            .from('network.routers')
            .where('id', routerId)
            .update({ host: falso.url, api_usuario: falso.usuario, api_password: cifrar(falso.password) })
        clienteId = await crearClienteFila()
        // El perfil base del PPPoE server, como lo deja lab.rsc
        Object.assign(falso.tabla('/ppp/profile')[0]!, {
            'local-address': '10.10.0.1',
            'remote-address': 'pool-clientes',
            'dhcpv6-pd-pool': 'pool-pd',
            'dns-server': '10.10.0.1',
        })
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
                    ...cuerpo,
                }),
            201,
        )
        await entregar(await eventosDe(requestId))
        return r.body() as { id: number; ipv4: string; version: number }
    }

    async function cambiarEstado(servicioId: number, nuevo: 'activo' | 'limitado' | 'suspendido') {
        const ctx = contextoPrueba()
        await new CambiarEstadoServicio().execute({ servicioId, nuevo, motivo: 'prueba' }, ctx)
        await entregar(await eventosDe(ctx.requestId))
    }

    const padre = (planId: number) => falso.conComment('/queue/simple', commentPlan(planId))
    const perfil = (planId: number) => falso.conComment('/ppp/profile', commentPlan(planId))
    const cola = (id: number) => falso.conComment('/queue/simple', commentServicio(id))[0]!

    async function maxPadre(planId: number, activos: number) {
        const fila = await db.from('network.planes').where('id', planId).firstOrFail()
        return limitesPadrePlan(leerVelocidad(fila), activos).max_limit
    }

    test('plan 1:4 con 4 activos y luego 1 suspendido: padre recalculado por evento', async ({
        client,
        assert,
    }) => {
        const planId = await plan14()
        const servicios = []
        for (let i = 0; i < 4; i++) servicios.push(await crear(client, planId))

        assert.lengthOf(padre(planId), 1)
        const p = padre(planId)[0]!
        assert.equal(p.name, nombrePadre(planId))
        // MIR 5M/20M × 4 / 4 y CIR (25 %) × 4
        assert.isTrue(igual(p['max-limit'], '5M/20M'))
        assert.isTrue(igual(p['limit-at'], '5M/20M'))
        assert.isTrue(igual(p['max-limit'], await maxPadre(planId, 4)))
        assert.equal(p.priority, '8/8')
        assert.sameMembers(
            p.target!.split(','),
            servicios.map((s) => `${s.ipv4}/32`),
        )
        for (const s of servicios) assert.equal(cola(s.id).parent, nombrePadre(planId))
        // Perfil PPP para las sesiones PPPoE del plan, con lo del perfil default
        assert.lengthOf(perfil(planId), 1)
        assert.containsSubset(perfil(planId)[0], {
            name: `plan-${planId}`,
            'parent-queue': nombrePadre(planId),
            'local-address': '10.10.0.1',
            'remote-address': 'pool-clientes',
            'dhcpv6-pd-pool': 'pool-pd',
        })

        // Un suspendido no cuenta: 3 activos → 3750k/15M; su cola deja de colgar del padre.
        await cambiarEstado(servicios[3]!.id, 'suspendido')
        const despues = padre(planId)[0]!
        assert.isTrue(igual(despues['max-limit'], '3750k/15M'))
        assert.isTrue(igual(despues['limit-at'], '3750k/15M'))
        assert.isTrue(igual(despues['max-limit'], await maxPadre(planId, 3)))
        assert.notInclude(despues.target!, `${servicios[3]!.ipv4}/32`)
        assert.equal(cola(servicios[3]!.id).parent, 'none')

        // Limitado sigue contando (y colgando del padre)
        await cambiarEstado(servicios[2]!.id, 'limitado')
        assert.isTrue(igual(padre(planId)[0]!['max-limit'], '3750k/15M'))
        assert.equal(cola(servicios[2]!.id).parent, nombrePadre(planId))

        // Las escrituras del padre quedan en audit.red sin servicio
        const red = await db
            .from('audit.red')
            .where('router_id', routerId)
            .whereNull('servicio_id')
            .whereRaw(`comando->>'ruta' = '/queue/simple'`)
        assert.isAbove(red.length, 0)
    })

    test('cambio de plan entre dos padres: los dos se recalculan y el viejo se borra al vaciarse', async ({
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
        assert.isTrue(igual(padre(planA)[0]!['max-limit'], await maxPadre(planA, 2)))

        const mover = async (s: { id: number }) => {
            const ctx = contextoPrueba()
            const actual = await db.from('core.servicios').where('id', s.id).firstOrFail()
            await new EditarServicio().execute({ id: s.id, version: actual.version, plan_id: planB }, ctx)
            await entregar(await eventosDe(ctx.requestId))
        }
        await mover(s1)
        assert.isTrue(igual(padre(planA)[0]!['max-limit'], await maxPadre(planA, 1)))
        assert.equal(padre(planA)[0]!.target, `${s2.ipv4}/32`)
        assert.lengthOf(padre(planB), 1)
        assert.isTrue(igual(padre(planB)[0]!['max-limit'], '5M/25M'))
        assert.equal(padre(planB)[0]!.priority, '4/4')
        assert.equal(cola(s1.id).parent, nombrePadre(planB))
        assert.equal(cola(s2.id).parent, nombrePadre(planA))

        // El último del plan A se va: el padre y el perfil de A desaparecen (sin colas huérfanas).
        await mover(s2)
        assert.lengthOf(padre(planA), 0)
        assert.lengthOf(perfil(planA), 0)
        assert.isTrue(igual(padre(planB)[0]!['max-limit'], await maxPadre(planB, 2)))
        assert.sameMembers(padre(planB)[0]!.target!.split(','), [`${s1.ipv4}/32`, `${s2.ipv4}/32`])

        // Retirar el último: nada del plan B en el router
        for (const s of [s1, s2]) {
            const ctx = contextoPrueba()
            await new RetirarServicio().execute({ id: s.id, motivo: 'baja' }, ctx)
            await entregar(await eventosDe(ctx.requestId))
        }
        assert.lengthOf(padre(planB), 0)
        assert.lengthOf(perfil(planB), 0)
        assert.lengthOf(falso.tabla('/queue/simple'), 0)
    })

    test('PPPoE: padre y perfil sin tocar colas por servicio; la cola dinámica entra al target por sesion.iniciada', async ({
        client,
        assert,
    }) => {
        const planId = await plan14()
        const s = await crear(client, planId, {
            tipo_conexion: 'pppoe',
            user_ppp: unico('ppp'),
            pass_ppp: 'clave-larga-1',
        })
        assert.lengthOf(falso.conComment('/queue/simple', commentServicio(s.id)), 0)
        assert.lengthOf(padre(planId), 1)
        assert.equal(padre(planId)[0]!.target, TARGET_SIN_HIJAS)
        assert.isTrue(igual(padre(planId)[0]!['max-limit'], await maxPadre(planId, 1)))
        assert.equal(perfil(planId)[0]!['parent-queue'], nombrePadre(planId))

        // El router crea la cola dinámica de la sesión bajo el padre (perfil plan-<id>)
        falso.tabla('/queue/simple').push({
            '.id': '*FF',
            name: '<pppoe-cliente>',
            target: '10.10.1.10/32',
            parent: nombrePadre(planId),
            dynamic: 'true',
            'max-limit': '5000000/20000000',
        })
        await entregar([
            {
                id: unico('ev'),
                evento: 'sesion.iniciada',
                payload: {
                    servicio_id: s.id,
                    nas_ip: '127.0.0.1',
                    acct_session_id: 'a1',
                    ipv4: '10.10.1.10',
                    prefijos_v6: ['2001:db8::/64', '2001:db8:1::/56'],
                },
            },
        ])
        assert.equal(padre(planId)[0]!.target, '10.10.1.10/32')

        // El servicio se retira, pero la sesión sigue colgando del padre: no se borra.
        const ctx = contextoPrueba()
        await new RetirarServicio().execute({ id: s.id, motivo: 'baja' }, ctx)
        await entregar(await eventosDe(ctx.requestId))
        assert.lengthOf(padre(planId), 1)
        assert.lengthOf(perfil(planId), 1)

        // Termina la sesión (el router borra la dinámica): ahora sí se limpian.
        falso.borrarAMano('/queue/simple', (o) => o.dynamic === 'true')
        await entregar([
            {
                id: unico('ev'),
                evento: 'sesion.terminada',
                payload: { servicio_id: s.id, nas_ip: '127.0.0.1', acct_session_id: 'a1' },
            },
        ])
        assert.lengthOf(padre(planId), 0)
        assert.lengthOf(perfil(planId), 0)
    })

    test('reconciliador: repone el padre y el perfil, corrige lo editado y quita padres de un plan sin reuso', async ({
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

        // Alguien borra el perfil y edita el padre a mano
        falso.borrarAMano('/ppp/profile', (o) => o.comment === commentPlan(planId))
        Object.assign(padre(planId)[0]!, { 'max-limit': '100000000/100000000' })
        const r = await reconciliar()
        assert.isNull(r.error)
        assert.lengthOf(perfil(planId), 1)
        assert.isTrue(igual(padre(planId)[0]!['max-limit'], await maxPadre(planId, 2)))
        assert.includeDeepMembers(
            r.correcciones.map((c) => [c.ruta, c.accion]),
            [
                ['/queue/simple', 'actualizado'],
                ['/ppp/profile', 'creado'],
            ],
        )
        // Sin diferencias: no escribe nada
        const escrituras = falso.escrituras.length
        const otra = await reconciliar()
        assert.lengthOf(otra.correcciones, 0)
        assert.equal(falso.escrituras.length, escrituras)

        // El plan pasa a dedicado (reuso 1): plan.velocidad_cambiada → sin padre ni perfil, hijas sueltas
        await db.from('network.planes').where('id', planId).update({ reuso: 1 })
        await entregar([
            {
                id: unico('ev'),
                evento: 'plan.velocidad_cambiada',
                payload: { plan_id: planId, router_id: null, campos: ['reuso'] },
            },
        ])
        assert.lengthOf(padre(planId), 0)
        assert.lengthOf(perfil(planId), 0)
        assert.equal(cola(s1.id).parent, 'none')
    })
})
