import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { cifrar, claveDesdeTexto } from '#shared/cifrado'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import {
    crearClienteFila,
    crearEscenarioRouter,
    crearPlanFila,
    crearRouterFila,
    ipUnica,
} from '#tests/core/fabricas'
import { RouterOSFalso } from '#network/routeros/falso'
import { clienteDeRouter } from '#network/routeros/router'
import { bitacoraRed, type OpcionesDispatcher } from '#network/routeros/dispatcher'
import { ConsumidorRouterOS } from '#network/routeros/consumidor'
import { commentServicio } from '#network/routeros/estado_deseado'
import ReconciliarRouterOS from '#network/routeros/actions/reconciliar_router'
import SondearRouters from '#network/routeros/actions/sondear_routers'
import IniciarSesion from '#network/sesiones/actions/iniciar_sesion'
import type { EventoEntrante } from '#shared/eventos_bus'
import { extremoApi } from '#network/routers_duplicados'
import { umbralEnLineaS } from '#network/contacto_router'

/**
 * Routers duplicados (pedido del PM, 29 oct; `contratos/routers.md`): el alta y la edición
 * rechazan el mismo MikroTik dos veces, el sondeo guarda el número de serie, `GET
 * /routers/duplicados` encuentra los que ya existen y `routers.unir` los junta sin que el
 * dispatcher ni el reconciliador de RouterOS borren objetos de más.
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

/** Host de prueba único (cada corrida reusa la base: ningún alta choca con otra prueba). */
function hostUnico() {
    return `${unico('mk').toLowerCase()}.lab`
}

async function columnaRouter(id: number, columna: 'serial' | 'activo' | 'unido_a_id') {
    const router = await db.from('network.routers').where('id', id).select(columna).firstOrFail()
    return router[columna]
}

async function version(id: number): Promise<number> {
    const fila = await db.from('network.routers').where('id', id).select('version').firstOrFail()
    return fila.version
}

test.group('Routers duplicados · alta y edición', () => {
    test('el mismo host (o la misma api_url con su puerto) responde 409 router_duplicado con quién choca', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const host = hostUnico()
        const nombre = unico('MK Real')
        const primero = await estado(
            client.post('/api/v1/routers').bearerToken(token).json({ nombre, host, nas_ip: ipUnica() }),
            201,
        )

        const r = await estado(
            client
                .post('/api/v1/routers')
                .bearerToken(token)
                .json({ nombre: unico('MK Otra vez'), host, nas_ip: ipUnica() }),
            409,
        )
        assert.equal(r.body().type, 'urn:argosisp:problema:router_duplicado')
        assert.equal(
            r.body().detail,
            `Ese MikroTik ya está registrado como «${nombre}». Para usar dos formas de control de velocidad ` +
                'en el mismo router, configúralas por plan en su ficha.',
        )
        assert.lengthOf(r.body().errors, 1)
        assert.containsSubset(r.body().errors[0], { field: 'host', rule: 'router_duplicado' })
        assert.include(r.body().errors[0].message, `«${nombre}» (router ${primero.body().id})`)
        assert.include(r.body().errors[0].message, `${host}:443`)

        // api_url explícita al mismo puerto por defecto: mismo extremo; otro puerto: otro equipo
        const conUrl = await estado(
            client
                .post('/api/v1/routers')
                .bearerToken(token)
                .json({
                    nombre: unico('MK Url'),
                    host: 'otro.lab',
                    api_url: `https://${host.toUpperCase()}:443`,
                    nas_ip: ipUnica(),
                }),
            409,
        )
        assert.equal(conUrl.body().errors[0].field, 'api_url')
        await estado(
            client
                .post('/api/v1/routers')
                .bearerToken(token)
                .json({ nombre: unico('MK 8443'), host, api_url: `https://${host}:8443`, nas_ip: ipUnica() }),
            201,
        )
        // sin alta parcial: el rechazado no quedó
        const conHost = await db.from('network.routers').where('host', host)
        assert.lengthOf(conHost, 2)
    })

    test('la misma nas_ip: 409 router_duplicado con el nombre del otro, aunque esté desactivado', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const nasIp = ipUnica()
        const nombre = unico('MK Viejo')
        await crearRouterFila({ nombre, host: hostUnico(), nas_ip: nasIp, activo: false })
        const r = await estado(
            client
                .post('/api/v1/routers')
                .bearerToken(token)
                .json({ nombre: unico('MK Nuevo'), host: hostUnico(), nas_ip: nasIp }),
            409,
        )
        assert.equal(r.body().type, 'urn:argosisp:problema:router_duplicado')
        assert.containsSubset(r.body().errors[0], { field: 'nas_ip', rule: 'router_duplicado' })
        assert.include(r.body().errors[0].message, `«${nombre}»`)
        assert.include(r.body().errors[0].message, 'desactivado')
    })

    test('un router desactivado con el mismo host no bloquea el alta', async ({ client }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const host = hostUnico()
        await crearRouterFila({ host, activo: false })
        await estado(
            client
                .post('/api/v1/routers')
                .bearerToken(token)
                .json({ nombre: unico('MK'), host, nas_ip: ipUnica() }),
            201,
        )
    })

    test('editar: cambiar al host de otro es 409; un duplicado que ya existía se sigue editando; reactivar con el mismo serial es 409', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const host = hostUnico()
        const a = await crearRouterFila({ nombre: unico('MK A'), host, serial: 'HE1234' })
        const b = await crearRouterFila({ nombre: unico('MK B'), host: hostUnico() })

        const r = await estado(
            client.put(`/api/v1/routers/${b}`).bearerToken(token).json({ version: 1, host }),
            409,
        )
        assert.equal(r.body().type, 'urn:argosisp:problema:router_duplicado')

        // dos registros que ya existían con el mismo host: editar otra cosa sí se puede
        const dup = await crearRouterFila({ nombre: unico('MK Dup'), host })
        await estado(
            client
                .put(`/api/v1/routers/${dup}`)
                .bearerToken(token)
                .json({ version: 1, capacidad_bajada_kbps: 100000 }),
            200,
        )

        // desactivado con el mismo serial que `a`: reactivarlo choca por el serial
        const viejo = await crearRouterFila({
            nombre: unico('MK Viejo'),
            host: hostUnico(),
            serial: 'he1234',
            activo: false,
        })
        const reactivar = await estado(
            client.put(`/api/v1/routers/${viejo}`).bearerToken(token).json({ version: 1, activo: true }),
            409,
        )
        assert.containsSubset(reactivar.body().errors[0], { field: 'serial', rule: 'router_duplicado' })
        assert.include(reactivar.body().errors[0].message, `router ${a}`)
    })

    test('extremoApi normaliza host, esquema y puerto', ({ assert }) => {
        assert.equal(extremoApi({ host: 'MK.lab', api_url: null }), 'mk.lab:443')
        assert.equal(extremoApi({ host: 'x', api_url: 'https://10.0.0.1:8443/' }), '10.0.0.1:8443')
        assert.equal(extremoApi({ host: 'http://127.0.0.1:9000', api_url: null }), '127.0.0.1:9000')
        assert.equal(extremoApi({ host: 'http://mk.lab', api_url: null }), 'mk.lab:80')
    })
})

test.group('Routers duplicados · serial del equipo y detección', (group) => {
    let falso: RouterOSFalso

    group.each.setup(async () => {
        falso = new RouterOSFalso()
        await falso.levantar()
        return () => falso.cerrar()
    })

    async function routerConApi(datos: Record<string, unknown> = {}) {
        const id = await crearRouterFila({ nombre: unico('MK Sondeo'), ...datos })
        await db
            .from('network.routers')
            .where('id', id)
            .update({ host: falso.url, api_usuario: falso.usuario, api_password: cifrar(falso.password) })
        return id
    }

    test('el sondeo guarda el serial-number (RouterBOARD) con su diff y el GET en audit.red', async ({
        assert,
    }) => {
        falso.serial = unico('HD08').toUpperCase()
        const id = await routerConApi()
        const ctx = contextoPrueba()
        const salida = await new SondearRouters(OPCIONES).execute(
            { sin_contacto_desde_s: 300, router_ids: [id] },
            ctx,
        )
        assert.deepEqual(salida.respondieron, [id])
        const fila = await db.from('network.routers').where('id', id).firstOrFail()
        assert.equal(fila.serial, falso.serial)
        assert.equal(fila.version, 1, 'el serial no es una edición: no sube la versión')
        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'router', entidad_id: id, campo: 'serial' })
            .firstOrFail()
        assert.deepEqual([cambio.antes, cambio.despues], [null, falso.serial])
        const red = await db
            .from('audit.red')
            .where('router_id', id)
            .whereRaw("comando->>'operacion' = 'identificar'")
        assert.lengthOf(red, 1)
        assert.isTrue(red[0].ok)
        assert.equal(red[0].comando.ruta, '/system/routerboard')

        // serial conocido y el router no estuvo caído: el sondeo no lo vuelve a leer
        const hace = (s: number) => db.knexRawQuery(`now() - make_interval(secs => ${s})`)
        const umbral = umbralEnLineaS()
        await db
            .from('network.routers_contacto')
            .where('router_id', id)
            .update({ ultimo_contacto: hace(Math.min(400, umbral - 60)) })
        await new SondearRouters(OPCIONES).execute(
            { sin_contacto_desde_s: 300, router_ids: [id] },
            contextoPrueba(),
        )
        const lecturas = () =>
            db.from('audit.red').where('router_id', id).whereRaw("comando->>'operacion' = 'identificar'")
        assert.lengthOf(await lecturas(), 1, 'sin lectura nueva')

        // vuelve de estar caído (sin contacto más allá del umbral): lo lee y guarda el serial nuevo
        falso.serial = unico('HD09').toUpperCase()
        await db
            .from('network.routers_contacto')
            .where('router_id', id)
            .update({ ultimo_contacto: hace(umbral + 60) })
        await new SondearRouters(OPCIONES).execute(
            { sin_contacto_desde_s: 300, router_ids: [id] },
            contextoPrueba(),
        )
        assert.lengthOf(await lecturas(), 2)
        assert.equal(await columnaRouter(id, 'serial'), falso.serial)
        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'router', entidad_id: id, campo: 'serial' })
        assert.lengthOf(cambios, 2)
    })

    test('un CHR: software-id de /system/license; sin ninguno, el serial queda null sin fallar el sondeo', async ({
        assert,
    }) => {
        falso.softwareId = unico('CHR').toUpperCase()
        const chr = await routerConApi()
        await new SondearRouters(OPCIONES).execute(
            { sin_contacto_desde_s: 300, router_ids: [chr] },
            contextoPrueba(),
        )
        assert.equal(await columnaRouter(chr, 'serial'), falso.softwareId)

        const redChr = await db
            .from('audit.red')
            .where('router_id', chr)
            .whereRaw("comando->>'operacion' = 'identificar'")
            .firstOrFail()
        assert.equal(redChr.comando.ruta, '/system/license')

        falso.softwareId = null
        const sinDato = await routerConApi()
        const salida = await new SondearRouters(OPCIONES).execute(
            { sin_contacto_desde_s: 300, router_ids: [sinDato] },
            contextoPrueba(),
        )
        assert.deepEqual(salida.respondieron, [sinDato])
        assert.isNull(await columnaRouter(sinDato, 'serial'))
    })

    test('GET /routers/duplicados agrupa por host+puerto y por serial, con sus servicios; ?router_id da su grupo', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['lectura'])
        const host = hostUnico()
        const serial = unico('SN')
        const a = await crearRouterFila({ nombre: unico('MK A'), host })
        const b = await crearRouterFila({ nombre: unico('MK B'), host, serial })
        // c comparte el serial con b, no el host: la clausura los junta a los tres
        const c = await crearRouterFila({ nombre: unico('MK C'), host: hostUnico(), serial })
        const solo = await crearRouterFila({ nombre: unico('MK Solo'), host: hostUnico() })
        // un desactivado con el mismo host no cuenta
        await crearRouterFila({ host, activo: false })
        const clienteId = await crearClienteFila()
        const planId = await crearPlanFila()
        const [s] = (await db
            .table('core.servicios')
            .insert({
                cliente_id: clienteId,
                router_id: b,
                plan_id: planId,
                user_ppp: unico('ppp'),
                pass_ppp: 'x',
            })
            .returning('id')) as Array<{ id: number }>

        const r = await estado(
            client.get('/api/v1/routers/duplicados').qs({ router_id: a }).bearerToken(token),
            200,
        )
        assert.lengthOf(r.body(), 1)
        const grupo = r.body()[0]
        assert.sameMembers(
            grupo.routers.map((x: { id: number }) => x.id),
            [a, b, c],
        )
        assert.sameMembers(grupo.motivos, ['api', 'serial'])
        assert.deepInclude(grupo.claves, { motivo: 'api', valor: `${host}:443` })
        const deB = grupo.routers.find((x: { id: number }) => x.id === b)
        assert.equal(deB.servicios_total, 1)
        assert.equal(deB.servicios[0].id, s!.id)
        assert.equal(deB.serial, serial)

        const sinGrupo = await estado(
            client.get('/api/v1/routers/duplicados').qs({ router_id: solo }).bearerToken(token),
            200,
        )
        assert.deepEqual(sinGrupo.body(), [])

        // la ficha también trae el serial
        const ficha = await estado(client.get(`/api/v1/routers/${b}`).bearerToken(token), 200)
        assert.equal(ficha.body().serial, serial)
        assert.isNull(ficha.body().unido_a_id)
    })
})

test.group('Routers duplicados · unir', (group) => {
    let falso: RouterOSFalso
    let admin: string
    let soporte: string

    group.each.setup(async () => {
        falso = new RouterOSFalso()
        await falso.levantar()
        ;({ token: admin } = await usuarioConRoles(['admin']))
        ;({ token: soporte } = await usuarioConRoles(['soporte']))
        return () => falso.cerrar()
    })

    /** El mismo MikroTik (el falso) registrado dos veces, cada registro con sus redes y pools. */
    async function dosRegistros() {
        const a = await crearEscenarioRouter()
        const b = await crearEscenarioRouter()
        for (const id of [a.routerId, b.routerId]) {
            await db
                .from('network.routers')
                .where('id', id)
                .update({ host: falso.url, api_usuario: falso.usuario, api_password: cifrar(falso.password) })
        }
        return { queda: a.routerId, absorbido: b.routerId }
    }

    async function crearServicio(client: any, routerId: number, planId: number) {
        const requestId = unico('req')
        const r = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(soporte)
                .header('X-Request-Id', requestId)
                .json({
                    plantilla_facturacion_id: null,
                    cliente_id: await crearClienteFila(),
                    router_id: routerId,
                    plan_id: planId,
                    tipo_conexion: 'ip_estatica',
                }),
            201,
        )
        await entregar(await eventosDe(requestId))
        return r.body()
    }

    async function unir(client: any, queda: number, cuerpo: Record<string, unknown>, token = admin) {
        const requestId = unico('req')
        const r = await client
            .post(`/api/v1/routers/${queda}/unir`)
            .bearerToken(token)
            .header('X-Request-Id', requestId)
            .json(cuerpo)
        return { r, requestId }
    }

    async function unirConStatus(
        client: any,
        queda: number,
        cuerpo: Record<string, unknown>,
        status: number,
    ) {
        const { r } = await unir(client, queda, cuerpo)
        r.assertStatus(status)
    }

    test('solo admin: soporte recibe 403', async ({ client }) => {
        const { queda, absorbido } = await dosRegistros()
        const { r } = await unir(client, queda, { version: 1, absorber_id: absorbido }, soporte)
        r.assertStatus(403)
    })

    test('caso real: dos registros del mismo host con servicios en ambos → simular, unir → todos en uno, sin objetos borrados de más', async ({
        client,
        assert,
    }) => {
        const { queda, absorbido } = await dosRegistros()
        // plan global en los dos; plan propio solo del absorbido; plan implementado en los dos (choca)
        const global = await crearPlanFila()
        const propio = await crearPlanFila({ global: false })
        const choca = await crearPlanFila({ global: false })
        await db.table('network.planes_routers').multiInsert([
            { plan_id: propio, router_id: absorbido, profile_ppp: 'perfil-b' },
            { plan_id: choca, router_id: queda, profile_ppp: 'perfil-a' },
            { plan_id: choca, router_id: absorbido, profile_ppp: 'perfil-b' },
        ])
        const enQueda = await crearServicio(client, queda, global)
        const enAbsorbido = [
            await crearServicio(client, absorbido, global),
            await crearServicio(client, absorbido, propio),
            await crearServicio(client, absorbido, choca),
        ]
        const todos = [enQueda, ...enAbsorbido]
        const colas = () => todos.map((s) => falso.conComment('/queue/simple', commentServicio(s.id)).length)
        assert.deepEqual(colas(), [1, 1, 1, 1], 'cada servicio tiene su cola en el equipo')

        // sesión abierta atribuida al absorbido (accounting con su nas_ip)
        const absorbidoFila = await db
            .from('network.routers')
            .where('id', absorbido)
            .select(db.raw('host(nas_ip) AS nas_ip'), 'nombre', 'version')
            .firstOrFail()
        const userPpp = unico('ppp')
        const pppoe = await db
            .table('core.servicios')
            .insert({
                cliente_id: await crearClienteFila(),
                router_id: absorbido,
                plan_id: global,
                user_ppp: userPpp,
                pass_ppp: 'x',
                ipv6_modo: 'ninguno',
            })
            .returning('id')
        const pppoeId = Number((pppoe[0] as { id: number }).id)
        const registro = (acct: string) => ({
            tipo: 'Start' as const,
            nas_ip: absorbidoFila.nas_ip,
            acct_session_id: acct,
            user_ppp: userPpp,
            ipv4: null,
            prefijo_enlace_v6: null,
            prefijo_delegado_v6: null,
            bytes_in: '0',
            bytes_out: '0',
            duracion_s: null,
            causa_fin: null,
            evento_en: new Date().toISOString(),
        })
        await new IniciarSesion().execute(registro(unico('ses')), contextoPrueba())

        // simulación: nada cambia
        const sim = await unir(client, queda, { version: 1, absorber_id: absorbido, simular: true })
        sim.r.assertStatus(200)
        const s = sim.r.body()
        assert.isTrue(s.simulado)
        assert.include(s.coincidencias, 'api')
        assert.sameMembers(
            s.servicios.map((x: { servicio_id: number }) => x.servicio_id),
            [...enAbsorbido.map((x) => x.id), pppoeId],
        )
        assert.deepEqual(s.planes_movidos, [propio])
        assert.deepEqual(s.planes_descartados, [choca])
        assert.equal(s.sesiones_abiertas, 1)
        assert.isTrue(s.avisos.some((a: string) => a.includes('tiene implementación en los dos routers')))
        assert.isTrue(s.avisos.some((a: string) => a.includes(absorbidoFila.nas_ip)))
        assert.isFalse(s.absorbido.activo)
        assert.lengthOf(await eventosDe(sim.requestId), 0, 'la simulación no deja eventos')
        assert.lengthOf(await db.from('audit.acciones').where('request_id', sim.requestId), 0)
        const sigue = await db.from('core.servicios').whereIn(
            'id',
            enAbsorbido.map((x) => x.id),
        )
        assert.isTrue(sigue.every((x) => Number(x.router_id) === absorbido))
        assert.isTrue(await columnaRouter(absorbido, 'activo'))

        // versión vieja: 409
        await unirConStatus(client, queda, { version: 7, absorber_id: absorbido }, 409)

        // unir de verdad
        const ipsAntes = await db
            .from('network.ipv4_asignaciones')
            .whereIn(
                'servicio_id',
                enAbsorbido.map((x) => x.id),
            )
            .whereNull('fin')
            .select('servicio_id', db.raw('host(ip) AS ip'))
            .orderBy('servicio_id')
        const escriturasAntes = falso.escrituras.length
        const { r, requestId } = await unir(client, queda, { version: 1, absorber_id: absorbido })
        r.assertStatus(200)
        assert.isFalse(r.body().simulado)
        const servicios = await db.from('core.servicios').whereIn('id', [...todos.map((x) => x.id), pppoeId])
        assert.isTrue(
            servicios.every((x) => Number(x.router_id) === queda),
            'todos los servicios en uno',
        )
        const ipsDespues = await db
            .from('network.ipv4_asignaciones')
            .whereIn(
                'servicio_id',
                enAbsorbido.map((x) => x.id),
            )
            .whereNull('fin')
            .select('servicio_id', db.raw('host(ip) AS ip'))
            .orderBy('servicio_id')
        assert.deepEqual(ipsDespues, ipsAntes, 'las direcciones no cambian')
        assert.lengthOf(await db.from('network.redes_ipv4').where('router_id', absorbido), 0)
        assert.lengthOf(await db.from('network.ipv6_bloques').where('router_id', absorbido), 0)
        assert.lengthOf(await db.from('network.planes_routers').where('router_id', absorbido), 0)
        const choque = await db
            .from('network.planes_routers')
            .where({ plan_id: choca, router_id: queda })
            .firstOrFail()
        assert.equal(choque.profile_ppp, 'perfil-a', 'gana la implementación del que queda')
        assert.lengthOf(await db.from('network.sesiones').where('router_id', absorbido).whereNull('fin'), 0)

        const fila = await db.from('network.routers').where('id', absorbido).firstOrFail()
        assert.isFalse(fila.activo)
        assert.equal(Number(fila.unido_a_id), queda)

        // eventos: un config_cambiada por servicio con router y motivo union_routers; sin asignacion.cambiada
        const eventos = await eventosDe(requestId)
        const config = eventos.filter((e) => e.evento === 'servicio.config_cambiada')
        assert.lengthOf(config, 4)
        for (const e of config) {
            assert.deepEqual(e.payload.campos, ['router'])
            assert.equal(e.payload.motivo, 'union_routers')
        }
        assert.lengthOf(
            eventos.filter((e) => e.evento === 'asignacion.cambiada'),
            0,
        )
        assert.isTrue(
            eventos.some((e) => e.evento === 'plan.velocidad_cambiada' && e.payload.plan_id === propio),
        )

        // auditoría: la acción con su actor y el diff de cada servicio
        const accion = await db
            .from('audit.acciones')
            .where({ request_id: requestId, accion: 'routers.unir' })
            .firstOrFail()
        assert.equal(accion.actor_tipo, 'usuario')
        assert.equal(accion.resultado, 'ok')
        const diffs = await db
            .from('audit.cambios')
            .where({ request_id: requestId, entidad_tipo: 'servicio', campo: 'router_id' })
        assert.lengthOf(diffs, 4)

        // RouterOS por evento: nada de lo de los servicios se borra (el absorbido es el mismo equipo)
        await entregar(eventos)
        assert.deepEqual(colas(), [1, 1, 1, 1], 'ninguna cola borrada de más')
        const borradas = falso.escrituras
            .slice(escriturasAntes)
            .filter((p) => p.metodo === 'DELETE' && p.ruta.startsWith('/rest/queue/simple'))
        assert.lengthOf(borradas, 0)

        // el reconciliador del que queda no ve huérfanos; el del absorbido se omite
        const rec = await new ReconciliarRouterOS(OPCIONES).execute(
            { router_id: queda, motivo: 'manual' },
            contextoPrueba(),
        )
        assert.isNull(rec.error)
        assert.lengthOf(
            rec.correcciones.filter(
                (c) => c.accion === 'borrado' && c.comment.startsWith('argosisp:servicio:'),
            ),
            0,
        )
        assert.deepEqual(colas(), [1, 1, 1, 1])
        const recAbsorbido = await new ReconciliarRouterOS(OPCIONES).execute(
            { router_id: absorbido, motivo: 'manual' },
            contextoPrueba(),
        )
        assert.isTrue(recAbsorbido.omitido)
        assert.deepEqual(colas(), [1, 1, 1, 1])

        // accounting que llega con la nas_ip del absorbido se atribuye al que queda
        const acct = unico('ses')
        await new IniciarSesion().execute(registro(acct), contextoPrueba())
        const nueva = await db.from('network.sesiones').where('acct_session_id', acct).firstOrFail()
        assert.equal(Number(nueva.router_id), queda)

        // el absorbido no se reactiva, ni se vuelve a unir
        const ficha = await estado(client.get(`/api/v1/routers/${absorbido}`).bearerToken(admin), 200)
        assert.equal(ficha.body().unido_a_id, queda)
        const reactivar = await estado(
            client
                .put(`/api/v1/routers/${absorbido}`)
                .bearerToken(admin)
                .json({ version: ficha.body().version, activo: true }),
            422,
        )
        assert.equal(reactivar.body().type, 'urn:argosisp:problema:router_unido')
        const otra = await unir(client, queda, { version: await version(queda), absorber_id: absorbido })
        otra.r.assertStatus(422)
        assert.equal(otra.r.body().type, 'urn:argosisp:problema:router_unido')

        // ya no aparecen como duplicados
        const dup = await estado(
            client.get('/api/v1/routers/duplicados').qs({ router_id: queda }).bearerToken(admin),
            200,
        )
        assert.isFalse(
            dup
                .body()
                .some((g: { routers: Array<{ id: number }> }) => g.routers.some((x) => x.id === absorbido)),
        )
    })

    test('sin el arreglo, la limpieza del absorbido borraría las colas: el historial de RouterOS lo excluye', async ({
        client,
        assert,
    }) => {
        // el absorbido tiene id mayor: el dispatcher lo visitaría después de crear en el que queda
        const { queda, absorbido } = await dosRegistros()
        assert.isAbove(absorbido, queda)
        const plan = await crearPlanFila()
        const servicio = await crearServicio(client, absorbido, plan)
        const desde = new Date()
        const { r, requestId } = await unir(client, queda, { version: 1, absorber_id: absorbido })
        r.assertStatus(200)
        await entregar(await eventosDe(requestId))
        assert.lengthOf(falso.conComment('/queue/simple', commentServicio(servicio.id)), 1)
        const limpiezas = await db
            .from('audit.red')
            .where({ servicio_id: servicio.id, router_id: absorbido })
            .where('created_at', '>=', desde)
        assert.lengthOf(limpiezas, 0, 'nada se escribió en el absorbido')
    })

    test('uniones encadenadas: C→B y luego B→A deja C apuntando a A (un salto)', async ({
        client,
        assert,
    }) => {
        const host = hostUnico()
        const a = await crearRouterFila({ host })
        const b = await crearRouterFila({ host })
        const c = await crearRouterFila({ host })
        const cFila = await db
            .from('network.routers')
            .where('id', c)
            .select(db.raw('host(nas_ip) AS nas_ip'))
            .firstOrFail()
        await unirConStatus(client, b, { version: 1, absorber_id: c }, 200)
        assert.equal(Number(await columnaRouter(c, 'unido_a_id')), b)
        const { r, requestId } = await unir(client, a, { version: 1, absorber_id: b })
        r.assertStatus(200)
        assert.deepEqual(r.body().reencadenados, [c])
        assert.equal(Number(await columnaRouter(b, 'unido_a_id')), a)
        assert.equal(Number(await columnaRouter(c, 'unido_a_id')), a)
        const diff = await db
            .from('audit.cambios')
            .where({ request_id: requestId, entidad_tipo: 'router', entidad_id: c, campo: 'unido_a_id' })
            .firstOrFail()
        assert.deepEqual([diff.antes, diff.despues], [b, a])

        // accounting con la nas_ip de C se atribuye a A
        const userPpp = unico('ppp')
        await db.table('core.servicios').insert({
            cliente_id: await crearClienteFila(),
            router_id: a,
            plan_id: await crearPlanFila(),
            user_ppp: userPpp,
            pass_ppp: 'x',
            ipv6_modo: 'ninguno',
        })
        const acct = unico('ses')
        await new IniciarSesion().execute(
            {
                tipo: 'Start',
                nas_ip: cFila.nas_ip,
                acct_session_id: acct,
                user_ppp: userPpp,
                ipv4: null,
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
        const sesion = await db.from('network.sesiones').where('acct_session_id', acct).firstOrFail()
        assert.equal(Number(sesion.router_id), a)
    })

    test('secretos RADIUS distintos: la simulación lo avisa en bloqueos y unir responde 422 secreto_radius_distinto', async ({
        client,
        assert,
    }) => {
        const host = hostUnico()
        const a = await crearRouterFila({ nombre: unico('MK A'), host, radius_secret: cifrar('secreto-a') })
        const b = await crearRouterFila({ host, radius_secret: cifrar('secreto-b') })
        const sim = await unir(client, a, { version: 1, absorber_id: b, simular: true })
        sim.r.assertStatus(200)
        assert.deepEqual(sim.r.body().bloqueos, ['secreto_radius_distinto'])
        assert.isTrue(sim.r.body().avisos.some((x: string) => x.includes('secretos RADIUS distintos')))
        const { r } = await unir(client, a, { version: 1, absorber_id: b })
        r.assertStatus(422)
        assert.equal(r.body().type, 'urn:argosisp:problema:secreto_radius_distinto')
        assert.include(r.body().detail, 'Primero deja el mismo secreto')
        assert.isTrue(await columnaRouter(b, 'activo'), 'no cambió nada')
        assert.notInclude(JSON.stringify(r.body()), 'secreto-a')

        // mismo secreto (cifrado distinto, igual en claro): se une
        await db
            .from('network.routers')
            .where('id', b)
            .update({ radius_secret: cifrar('secreto-a') })
        const ok = await unir(client, a, { version: 1, absorber_id: b, simular: true })
        assert.deepEqual(ok.r.body().bloqueos, [])
        await unirConStatus(client, a, { version: 1, absorber_id: b }, 200)
    })

    test('errores: consigo mismo 422, absorbido inexistente 422, router inexistente 404', async ({
        client,
    }) => {
        const { queda } = await dosRegistros()
        await unirConStatus(client, queda, { version: 1, absorber_id: queda }, 422)
        await unirConStatus(client, queda, { version: 1, absorber_id: 999999999 }, 422)
        await unirConStatus(client, 999999999, { version: 1, absorber_id: queda }, 404)
    })

    test('avisos: no parecen el mismo equipo; controles de velocidad distintos', async ({
        client,
        assert,
    }) => {
        const a = await crearRouterFila({ host: hostUnico() })
        const b = await crearRouterFila({ host: hostUnico(), control_velocidad: 'arbol_pcq' })
        const { r } = await unir(client, a, { version: 1, absorber_id: b, simular: true })
        r.assertStatus(200)
        assert.deepEqual(r.body().coincidencias, [])
        assert.isTrue(r.body().avisos.some((x: string) => x.includes('no parecen el mismo equipo')))
        assert.isTrue(
            r
                .body()
                .avisos.some((x: string) => x.includes('arbol_pcq') && x.includes('configúralas por plan')),
        )
    })
})
