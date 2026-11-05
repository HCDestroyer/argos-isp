import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar, claveDesdeTexto } from '#shared/cifrado'
import env from '#start/env'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'
import CambiarEstadoServicio from '#core/actions/cambiar_estado_servicio'
import { construirRegistroAaa } from '#core/aaa'
import { RouterOSFalso } from '#network/routeros/falso'
import { clienteDeRouter } from '#network/routeros/router'
import { normalizarValor } from '#network/routeros/normalizar'
import ReconciliarRouterOS from '#network/routeros/actions/reconciliar_router'
import { ConsumidorRouterOS } from '#network/routeros/consumidor'
import { bitacoraRed, type OpcionesDispatcher } from '#network/routeros/dispatcher'
import { commentServicio } from '#network/routeros/estado_deseado'
import { commentPlan } from '#network/routeros/velocidad_router'
import IniciarSesion from '#network/sesiones/actions/iniciar_sesion'
import type { Aplicacion, Estrategia, EstrategiasRouter } from '#network/estrategia_velocidad'
import type { ObjetoRouterOS, RutaRouterOS } from '#network/routeros/cliente'
import type { EventoEntrante } from '#shared/eventos_bus'

/**
 * Bug del PM (5 nov, v1.9.0): «Argos está escribiendo todas las reglas sin importar el tipo de control»
 * y «no deja permitir PPPoE con colas simples». Un router escribe solo las reglas de control de ancho
 * de banda del modo con el que se limita cada servicio que tiene (`contratos/control-velocidad.md` §12):
 * cada modo × cada tipo de conexión × router con RADIUS o `api`, con el modo de los otros tipos de
 * conexión puesto a propósito en otra familia (si se colara, se vería). Al reconciliar se retiran las
 * reglas de más que dejó la versión anterior (las de comment `argosisp:`, auditadas en `audit.red`),
 * nunca lo ajeno.
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
const e = (aplicacion: Aplicacion, padre: Estrategia['padre'] = 'ninguno'): Estrategia => ({
    aplicacion,
    padre,
    tipo_cola: aplicacion === 'pcq_plan' || aplicacion === 'arbol_pcq' ? 'pcq' : 'default',
    extras: { ...EXTRAS },
})
const igual = (a: unknown, b: unknown) => normalizarValor(a) === normalizarValor(b)

type Tipo = 'pppoe' | 'ip_estatica' | 'dhcp_fija'
type Modo = 'radius' | 'api'

/** Un modo de la otra familia para los tipos de conexión sin servicios (el que no debe colarse). */
function otroModo(activo: Aplicacion, tipo: Tipo): Aplicacion {
    const arbol = activo === 'arbol_pcq'
    if (tipo === 'pppoe') return arbol ? 'pcq_plan' : 'arbol_pcq'
    return arbol ? 'perfil_ppp' : 'arbol_pcq'
}

/** Objetos de ArgosIsp en el router, por modo que los crea (lo del corte no cuenta: es de todos). */
function objetosPorModo(falso: RouterOSFalso) {
    const de = (ruta: RutaRouterOS, f: (o: ObjetoRouterOS) => boolean) => falso.tabla(ruta).filter(f)
    const plan = (o: ObjetoRouterOS) => /^argosisp:plan:\d+/.test(o.comment ?? '')
    return {
        arbol: [
            ...de('/queue/tree', (o) => (o.comment ?? '').startsWith('argosisp:')),
            ...de('/ip/firewall/mangle', plan),
            ...de('/ipv6/firewall/mangle', plan),
            ...de('/ip/firewall/address-list', (o) => /^argosisp-plan-/.test(o.list ?? '')),
            ...de('/queue/type', (o) => /^argosisp-plan-\d+-(limitado-)?(bajada|subida)$/.test(o.name ?? '')),
        ],
        pcq: [
            ...de('/queue/simple', (o) => /:pcq/.test(o.comment ?? '')),
            ...de('/queue/type', (o) => /-pcq-(bajada|subida)$/.test(o.name ?? '')),
        ],
        cola_servicio: de('/queue/simple', (o) => (o.comment ?? '').startsWith('argosisp:servicio:')),
        perfil_rate_limit: de('/ppp/profile', (o) => plan(o) && (o['rate-limit'] ?? '') !== ''),
        perfil_plan: de('/ppp/profile', plan),
    }
}

test.group('Control de velocidad · solo las reglas del modo activo (bug del PM)', (group) => {
    let falso: RouterOSFalso
    let tokenAdmin: string
    let routerId: number
    let base: string
    let clienteId: number
    let nasIp: string

    group.each.setup(async () => {
        falso = new RouterOSFalso()
        await falso.levantar()
        ;({ token: tokenAdmin } = await usuarioConRoles(['admin']))
        ;({ routerId, base } = await crearEscenarioRouter())
        nasIp = `127.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`
        await db
            .from('network.routers')
            .where('id', routerId)
            .update({
                host: falso.url,
                api_usuario: falso.usuario,
                api_password: cifrar(falso.password),
                nas_ip: nasIp,
                capacidad_bajada_kbps: 1_000_000,
                capacidad_subida_kbps: 500_000,
            })
        clienteId = await crearClienteFila()
        return () => falso.cerrar()
    })

    async function modoRouter(modo: Modo) {
        if (modo === 'api') {
            await db
                .from('network.routers')
                .where('id', routerId)
                .update({ modo_seguridad: 'api', nas_ip: null, radius_secret: null })
        }
    }

    async function estrategia(client: any, estrategias: EstrategiasRouter) {
        const router = await db.from('network.routers').where('id', routerId).firstOrFail()
        return estado(
            client
                .post(`/api/v1/routers/${routerId}/cambiar-estrategia-velocidad`)
                .bearerToken(tokenAdmin)
                .json({ version: router.version, estrategia_velocidad: estrategias }),
            200,
        )
    }

    const plan = (reuso = 1) =>
        crearPlanFila({
            bajada_kbps: 20000,
            subida_kbps: 5000,
            bajada_limitada_kbps: 2000,
            subida_limitada_kbps: 1000,
            reuso,
        })

    let ip = 10
    /** Servicio con su IPv4 (en la misma transacción, como lo exige `core.servicios`). */
    async function servicio(planId: number, tipo: Tipo, opciones: { conIpv4?: boolean } = {}) {
        const userPpp = tipo === 'pppoe' ? unico('ppp') : null
        const ipv4 = `${base}.${ip++}`
        const filaRed = await db.from('network.redes_ipv4').where('router_id', routerId).firstOrFail()
        const red = filaRed.id
        let id = 0
        await db.transaction(async (trx) => {
            const [fila] = await trx
                .table('core.servicios')
                .insert({
                    cliente_id: clienteId,
                    router_id: routerId,
                    plan_id: planId,
                    tipo_conexion: tipo,
                    ipv6_modo: 'ninguno',
                    ...(userPpp ? { user_ppp: userPpp, pass_ppp: cifrar('clave-larga-1') } : {}),
                    ...(tipo === 'dhcp_fija' ? { mac: '02:00:00:00:00:0A' } : {}),
                })
                .returning('id')
            id = Number(fila.id)
            if (tipo !== 'pppoe' || opciones.conIpv4) {
                await trx
                    .table('network.ipv4_asignaciones')
                    .insert({ servicio_id: id, ip: ipv4, red_id: red })
            }
        })
        return { id, userPpp, ipv4 }
    }

    async function sesion(userPpp: string, ipv4: string, acct = unico('ses')) {
        await new IniciarSesion().execute(
            {
                tipo: 'Start',
                nas_ip: nasIp,
                acct_session_id: acct,
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
        return acct
    }

    const reconciliar = () =>
        new ReconciliarRouterOS(OPCIONES).execute({ router_id: routerId, motivo: 'manual' }, contextoPrueba())

    // Cada modo válido para cada tipo de conexión y cada modo del router.
    const MODOS_PPPOE: Record<Modo, Aplicacion[]> = {
        radius: ['radius_rate_limit', 'perfil_ppp', 'cola_simple', 'pcq_plan', 'arbol_pcq'],
        api: ['perfil_ppp', 'cola_simple', 'arbol_pcq'],
    }
    const MODOS_WISP: Aplicacion[] = ['cola_simple', 'pcq_plan', 'arbol_pcq']

    for (const modo of ['radius', 'api'] as const) {
        for (const tipo of ['pppoe', 'ip_estatica', 'dhcp_fija'] as const) {
            for (const activo of tipo === 'pppoe' ? MODOS_PPPOE[modo] : MODOS_WISP) {
                test(`${modo} · ${tipo} con ${activo}: solo las reglas de ${activo}`, async ({
                    client,
                    assert,
                }) => {
                    await modoRouter(modo)
                    // Los otros tipos de conexión con un modo de la otra familia, sin servicios.
                    let otro = otroModo(activo, tipo)
                    if (modo === 'api' && otro === 'pcq_plan') otro = 'perfil_ppp'
                    const pppoe =
                        tipo === 'pppoe' ? e(activo) : e(otro === 'perfil_ppp' ? 'perfil_ppp' : 'arbol_pcq')
                    const wisp =
                        tipo === 'pppoe' ? e(activo === 'arbol_pcq' ? 'cola_simple' : 'arbol_pcq') : e(activo)
                    await estrategia(client, { pppoe, ip_estatica: wisp, dhcp_fija: wisp })

                    const p = await plan()
                    const s = await servicio(p, tipo, { conIpv4: tipo === 'pppoe' && modo === 'api' })
                    if (tipo === 'pppoe' && modo === 'radius') await sesion(s.userPpp!, '10.88.7.1')
                    const r = await reconciliar()
                    assert.isNull(r.error)

                    const o = objetosPorModo(falso)
                    // El modo activo, real (sin PPPoE sin RADIUS, `radius_rate_limit` y `pcq_plan` no existen).
                    const efectivo =
                        modo === 'api' && tipo === 'pppoe' && activo === 'pcq_plan' ? 'perfil_ppp' : activo
                    const solo = (lista: ObjetoRouterOS[], modoLista: Aplicacion, que: string) => {
                        if (efectivo === modoLista) assert.isAbove(lista.length, 0, que)
                        else assert.lengthOf(lista, 0, que)
                    }
                    solo(o.arbol, 'arbol_pcq', 'árbol, mangle y listas del plan')
                    solo(o.pcq, 'pcq_plan', 'colas PCQ del plan')
                    assert.lengthOf(o.cola_servicio, efectivo === 'cola_simple' ? 1 : 0, 'cola del servicio')
                    // Rate-limit en el perfil del plan: solo con perfil_ppp.
                    solo(
                        o.perfil_rate_limit,
                        tipo === 'pppoe' ? 'perfil_ppp' : ('ninguno' as Aplicacion),
                        'perfil con rate-limit',
                    )
                    // Un servicio WISP nunca hace existir perfiles PPP del plan.
                    if (tipo !== 'pppoe') assert.lengthOf(o.perfil_plan, 0, 'perfil del plan')
                    if (efectivo === 'cola_simple') {
                        const cola = o.cola_servicio[0]!
                        assert.equal(cola.comment, commentServicio(s.id))
                        assert.equal(
                            cola.target,
                            tipo === 'pppoe' && modo === 'radius' ? '10.88.7.1/32' : `${s.ipv4}/32`,
                        )
                        assert.isTrue(igual(cola['max-limit'], '5M/20M'))
                    }

                    // aaa: Mikrotik-Rate-Limit solo si el modo lo usa (contratos/control-velocidad.md §7).
                    if (tipo === 'pppoe' && modo === 'radius') {
                        const registro = await construirRegistroAaa(s.userPpp!)
                        const manda = activo === 'radius_rate_limit'
                        assert.equal(registro!.velocidad!.rate_limit, manda, 'rate_limit en activo')
                        assert.equal(
                            registro!.velocidad!.rate_limit_limitado,
                            manda || activo === 'perfil_ppp',
                            'rate_limit en limitado',
                        )
                    }

                    // Cada escritura en audit.red; una segunda pasada no escribe nada.
                    const red = await db
                        .from('audit.red')
                        .where('router_id', routerId)
                        .where('tipo', 'routeros')
                    assert.isAbove(red.length, 0)
                    const otra = await reconciliar()
                    assert.deepEqual(otra.correcciones, [])
                })
            }
        }
    }

    test('reconciliar retira las reglas de más de la versión anterior, auditadas, y nunca lo ajeno', async ({
        client,
        assert,
    }) => {
        // PPPoE con colas simples: lo que dejó 1.9.0 de otros modos queda en el router.
        await estrategia(client, {
            pppoe: e('cola_simple'),
            ip_estatica: e('arbol_pcq', 'jerarquico'),
            dhcp_fija: e('arbol_pcq', 'jerarquico'),
        })
        const p = await plan()
        const s = await servicio(p, 'pppoe')
        await sesion(s.userPpp!, '10.88.8.1')
        let n = 0
        const sobra = (ruta: RutaRouterOS, o: Record<string, string>) =>
            falso
                .tabla(ruta)
                .push({ disabled: 'false', dynamic: 'false', ...o, '.id': `*F${(n++).toString(16)}` })
        sobra('/queue/tree', {
            name: 'argosisp-global-bajada',
            comment: 'argosisp:global:bajada',
            parent: 'global',
        })
        sobra('/queue/tree', {
            name: 'argosisp-global-subida',
            comment: 'argosisp:global:subida',
            parent: 'global',
        })
        sobra('/queue/type', { name: `argosisp-plan-${p}-bajada`, kind: 'pcq' })
        sobra('/ip/firewall/mangle', {
            comment: `${commentPlan(p)}:bajada`,
            chain: 'forward',
            action: 'mark-packet',
        })
        sobra('/ppp/profile', { name: `plan-${p}`, comment: commentPlan(p), 'rate-limit': '5M/20M' })
        sobra('/ppp/profile', {
            name: `plan-${p}-limitado`,
            comment: `${commentPlan(p)}:limitado`,
            'rate-limit': '1M/2M',
        })
        // Lo ajeno y lo adoptado (sin comment de ArgosIsp) no se toca.
        sobra('/queue/simple', { name: 'vip-gerencia', target: '10.0.0.5/32', 'max-limit': '50M/50M' })
        sobra('/queue/tree', { name: 'qos-isp', parent: 'global', comment: 'del técnico' })
        sobra('/ppp/profile', { name: 'perfil-viejo', 'rate-limit': '2M/2M' })
        sobra('/ip/firewall/mangle', {
            comment: 'marca del técnico',
            chain: 'forward',
            action: 'mark-packet',
        })

        const r = await reconciliar()
        assert.isNull(r.error)
        const o = objetosPorModo(falso)
        assert.lengthOf(o.arbol, 0)
        assert.lengthOf(o.perfil_plan, 0)
        assert.lengthOf(o.cola_servicio, 1)
        assert.isDefined(falso.tabla('/queue/simple').find((x) => x.name === 'vip-gerencia'))
        assert.isDefined(falso.tabla('/queue/tree').find((x) => x.name === 'qos-isp'))
        assert.isDefined(falso.tabla('/ppp/profile').find((x) => x.name === 'perfil-viejo'))
        assert.isDefined(falso.tabla('/ip/firewall/mangle').find((x) => x.comment === 'marca del técnico'))
        // Cada borrado en audit.red y en las correcciones (deja fila en audit.acciones)
        const borrados = await db
            .from('audit.red')
            .where('router_id', routerId)
            .whereRaw(`comando->>'metodo' = 'DELETE'`)
            .select(db.raw(`comando->>'ruta' AS ruta`))
        assert.includeMembers(
            borrados.map((b) => b.ruta),
            ['/queue/tree', '/queue/type', '/ip/firewall/mangle', '/ppp/profile'],
        )
        assert.includeDeepMembers(
            r.correcciones.filter((c) => c.accion === 'borrado').map((c) => [c.ruta, c.comment]),
            [
                ['/queue/tree', 'argosisp:global:bajada'],
                ['/ppp/profile', commentPlan(p)],
            ],
        )
        const accion = await db
            .from('audit.acciones')
            .where('accion', 'routeros.reconciliar')
            .where('entidad_id', String(routerId))
            .first()
        assert.isNotNull(accion)
        const tercera = await reconciliar()
        assert.lengthOf(tercera.correcciones, 0)
    })

    test('PPPoE con colas simples: la API lo acepta, la cola sigue a la sesión y limitar no reconecta', async ({
        client,
        assert,
    }) => {
        await estrategia(client, {
            pppoe: { ...e('cola_simple', 'por_plan'), tipo_cola: 'sfq' },
            ip_estatica: { ...e('cola_simple', 'por_plan'), tipo_cola: 'sfq' },
            dhcp_fija: { ...e('cola_simple', 'por_plan'), tipo_cola: 'sfq' },
        })
        const router = await db.from('network.routers').where('id', routerId).firstOrFail()
        assert.equal(router.estrategia_velocidad.pppoe.aplicacion, 'cola_simple')
        const p = await plan(4)
        const s = await servicio(p, 'pppoe')
        const consumidor = new ConsumidorRouterOS(OPCIONES)
        const entregar = async (requestId: string) => {
            const filas = await db.from('audit.outbox').where('request_id', requestId).orderBy('id')
            for (const f of filas) {
                const ev: EventoEntrante = {
                    id: Number(f.id),
                    evento: f.evento,
                    payload: f.payload,
                    requestId: f.request_id,
                }
                if (consumidor.acepta(ev.evento)) await consumidor.procesar(ev)
            }
        }
        // Sin sesión ni IPv4 fija: nada que limitar todavía.
        await reconciliar()
        assert.lengthOf(falso.conComment('/queue/simple', commentServicio(s.id)), 0)

        // Al conectar (sesion.iniciada) se crea su cola con la IP de la sesión, bajo el padre del plan.
        const ctx = contextoPrueba()
        await new IniciarSesion().execute(
            {
                tipo: 'Start',
                nas_ip: nasIp,
                acct_session_id: unico('ses'),
                user_ppp: s.userPpp!,
                ipv4: '10.88.9.1',
                prefijo_enlace_v6: '2001:db8:99:1::/64',
                prefijo_delegado_v6: '2001:db8:99:100::/56',
                bytes_in: '0',
                bytes_out: '0',
                duracion_s: null,
                causa_fin: null,
                evento_en: new Date().toISOString(),
            },
            ctx,
        )
        await entregar(ctx.requestId)
        const cola = () => falso.conComment('/queue/simple', commentServicio(s.id))[0]
        assert.equal(cola()!.target, '10.88.9.1/32,2001:db8:99:1::/64,2001:db8:99:100::/56')
        assert.equal(cola()!.parent, `argosisp-plan-${p}`)
        assert.equal(cola()!.queue, 'argosisp-sfq/argosisp-sfq')
        assert.include(falso.conComment('/queue/simple', commentPlan(p))[0]!.target!, '10.88.9.1/32')
        // Sin perfil del plan ni Mikrotik-Rate-Limit (no hay doble limitación).
        assert.lengthOf(falso.conComment('/ppp/profile', commentPlan(p)), 0)
        const registro = await construirRegistroAaa(s.userPpp!)
        assert.deepEqual(registro!.velocidad, {
            aplicacion: 'cola_simple',
            grupo: null,
            rate_limit: false,
            rate_limit_limitado: false,
        })

        // Limitar: cambia la cola estática; ningún Disconnect pedido (coa no hace nada en cola_simple).
        const c2 = contextoPrueba()
        await new CambiarEstadoServicio().execute(
            { servicioId: s.id, nuevo: 'limitado', motivo: 'prueba' },
            c2,
        )
        await entregar(c2.requestId)
        assert.isTrue(igual(cola()!['max-limit'], '1M/2M'))
        const desconexiones = await db
            .from('audit.outbox')
            .where('evento', 'sesion.desconexion_solicitada')
            .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [s.id])
        assert.lengthOf(desconexiones, 0)

        // Suspender: sin cola estática (el perfil de corte de RADIUS pone el rate-limit mínimo).
        const c3 = contextoPrueba()
        await new CambiarEstadoServicio().execute(
            { servicioId: s.id, nuevo: 'suspendido', motivo: 'prueba' },
            c3,
        )
        await entregar(c3.requestId)
        assert.isUndefined(cola())
    })

    test('router sin RADIUS con PPPoE en colas simples: un solo perfil del plan, sin rate-limit, y su cola', async ({
        client,
        assert,
    }) => {
        await modoRouter('api')
        await estrategia(client, {
            pppoe: e('cola_simple'),
            ip_estatica: e('cola_simple'),
            dhcp_fija: e('cola_simple'),
        })
        const p = await plan()
        const s = await servicio(p, 'pppoe', { conIpv4: true })
        await db.from('core.servicios').where('id', s.id).update({ estado: 'limitado' })
        await reconciliar()
        const perfiles = falso
            .tabla('/ppp/profile')
            .filter((o) => (o.comment ?? '').startsWith(commentPlan(p)))
        assert.deepEqual(
            perfiles.map((o) => o.name),
            [`plan-${p}`],
        )
        assert.isUndefined(perfiles[0]!['rate-limit'])
        // El limitado sigue en el perfil del plan (no reconecta); la cola lo limita.
        assert.equal(falso.conComment('/ppp/secret', commentServicio(s.id))[0]!.profile, `plan-${p}`)
        const cola = falso.conComment('/queue/simple', commentServicio(s.id))[0]!
        assert.equal(cola.target, `${s.ipv4}/32`)
        assert.isTrue(igual(cola['max-limit'], '1M/2M'))
    })
})
