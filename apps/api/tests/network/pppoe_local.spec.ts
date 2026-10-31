import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar, claveDesdeTexto, descifrar } from '#shared/cifrado'
import env from '#start/env'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'
import CambiarEstadoServicio from '#core/actions/cambiar_estado_servicio'
import RetirarServicio from '#core/actions/retirar_servicio'
import EditarServicio from '#core/actions/editar_servicio'
import EliminarServicio from '#core/actions/eliminar_servicio'
import { RouterOSFalso } from '#network/routeros/falso'
import { clienteDeRouter } from '#network/routeros/router'
import { normalizarValor } from '#network/routeros/normalizar'
import { ConsumidorRouterOS } from '#network/routeros/consumidor'
import { ejecutarCronRouterOS } from '#network/routeros/jobs'
import ReconciliarRouterOS from '#network/routeros/actions/reconciliar_router'
import { bitacoraRed, type OpcionesDispatcher } from '#network/routeros/dispatcher'
import { commentServicio } from '#network/routeros/estado_deseado'
import { estrategiaLocal } from '#network/routeros/pppoe_local'
import { leerVelocidad, rateLimitServicio } from '#network/velocidad'
import {
    estrategiasDeControl,
    validarEstrategias,
    type EstrategiasRouter,
} from '#network/estrategia_velocidad'
import { resolverIp } from '#network/consultas/ip'
import { segundosUptime } from '#network/sesiones/actions/sondear_sesiones_ppp'
import type { EventoEntrante } from '#shared/eventos_bus'
import type { ObjetoRouterOS } from '#network/routeros/cliente'

/**
 * PPPoE sin RADIUS (`contratos/pppoe-local.md`, pedido del PM del 30 oct) con Postgres real y el
 * RouterOS falso: un router `modo_seguridad = 'api'` maneja cada servicio PPPoE con un `/ppp/secret`
 * local y la velocidad con los perfiles `plan-<id>[-limitado]`; las sesiones las abre y cierra el
 * sondeo de `/ppp/active`.
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

/** Lo que haría el bus: entrega los eventos al consumidor `routeros` (y lo que estos emitan). */
async function entregar(eventos: EventoEntrante[]) {
    const consumidor = new ConsumidorRouterOS(OPCIONES)
    for (const e of eventos) if (consumidor.acepta(e.evento)) await consumidor.procesar(e)
}

/** Eventos del outbox de un tipo, desde un id (los que emitieron el dispatcher y el sondeo). */
async function outbox(evento: string, desdeId: number) {
    const filas = await db
        .from('audit.outbox')
        .where('evento', evento)
        .where('id', '>', desdeId)
        .orderBy('id')
    return filas.map((f) => f.payload as Record<string, unknown>)
}

async function ultimoOutbox(): Promise<number> {
    const fila = await db.from('audit.outbox').max('id as id').first()
    return Number(fila?.id ?? 0)
}

test.group('PPPoE sin RADIUS · secrets locales', (group) => {
    let falso: RouterOSFalso
    let token: string
    let routerId: number
    let planId: number
    let clienteId: number

    group.each.setup(async () => {
        falso = new RouterOSFalso()
        await falso.levantar()
        ;({ token } = await usuarioConRoles(['admin']))
        ;({ routerId } = await crearEscenarioRouter())
        await db
            .from('network.routers')
            .where('id', routerId)
            .update({
                modo_seguridad: 'api',
                nas_ip: null,
                radius_secret: null,
                host: falso.url,
                api_usuario: falso.usuario,
                api_password: cifrar(falso.password),
            })
        planId = await crearPlanFila({
            bajada_kbps: 20000,
            subida_kbps: 5000,
            bajada_limitada_kbps: 2000,
            subida_limitada_kbps: 1000,
        })
        clienteId = await crearClienteFila()
        return () => falso.cerrar()
    })

    async function crear(client: any, cuerpo: Record<string, unknown> = {}) {
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
                    tipo_conexion: 'pppoe',
                    ...cuerpo,
                }),
            201,
        )
        const fila = await db.from('core.servicios').where('id', r.body().id).firstOrFail()
        await entregar(await eventosDe(requestId))
        return {
            servicio: r.body() as { id: number; ipv4: string; version: number },
            user: fila.user_ppp as string,
            clave: descifrar(fila.pass_ppp),
        }
    }

    async function cambiarEstado(servicioId: number, nuevo: 'activo' | 'limitado' | 'suspendido') {
        const ctx = contextoPrueba()
        await new CambiarEstadoServicio().execute({ servicioId, nuevo, motivo: 'prueba' }, ctx)
        await entregar(await eventosDe(ctx.requestId))
    }

    const secret = (id: number) => falso.conComment('/ppp/secret', commentServicio(id))
    const perfil = (nombre: string) => falso.tabla('/ppp/profile').find((p) => p.name === nombre)
    const activas = () => falso.lectura('/ppp/active')

    /** El cliente conecta: el router lo agrega a `/ppp/active` (y le delega un /56). */
    function conectar(user: string, address: string, sesion: string, delegado?: string) {
        activas().push({
            '.id': `*A${sesion}`,
            name: user,
            service: 'pppoe',
            address,
            'session-id': `0x${sesion}`,
            uptime: '2m10s',
        } as ObjetoRouterOS)
        if (delegado) {
            falso.lectura('/ipv6/dhcp-server/binding').push({
                '.id': `*B${sesion}`,
                server: `<pppoe-${user}>`,
                address: delegado,
            } as ObjetoRouterOS)
        }
    }

    const sondear = () => ejecutarCronRouterOS('sesiones_ppp', OPCIONES)

    test('alta: secret con el plan, IPv4 fija y /64; perfiles del plan; la contraseña nunca va a audit.red', async ({
        client,
        assert,
    }) => {
        const { servicio, user, clave } = await crear(client)
        const vel = leerVelocidad(await db.from('network.planes').where('id', planId).firstOrFail())
        const enlace = await db
            .from('network.ipv6_asignaciones')
            .where({ servicio_id: servicio.id, tipo: 'enlace' })
            .whereNull('fin')
            .select(db.raw('prefijo::text AS prefijo'))
            .firstOrFail()

        assert.lengthOf(secret(servicio.id), 1)
        assert.containsSubset(secret(servicio.id)[0], {
            name: user,
            password: clave,
            service: 'pppoe',
            profile: `plan-${planId}`,
            'remote-address': servicio.ipv4,
            'remote-ipv6-prefix': enlace.prefijo,
            disabled: 'false',
        })
        assert.equal(perfil(`plan-${planId}`)!.comment, `argosisp:plan:${planId}`)
        assert.equal(
            normalizarValor(perfil(`plan-${planId}`)!['rate-limit']),
            normalizarValor(rateLimitServicio(vel, 'activo')),
        )
        assert.equal(perfil(`plan-${planId}-limitado`)!.comment, `argosisp:plan:${planId}:limitado`)
        assert.equal(
            normalizarValor(perfil(`plan-${planId}-limitado`)!['rate-limit']),
            normalizarValor(rateLimitServicio(vel, 'limitado')),
        )
        // copia del perfil `default` (IPv6, MSS)
        assert.equal(perfil(`plan-${planId}`)!['use-ipv6'], 'true')

        const red = await db.from('audit.red').where('router_id', routerId).orderBy('id')
        const put = red.find((f) => f.comando.ruta === '/ppp/secret' && f.comando.metodo === 'PUT')!
        assert.equal(put.comando.propiedades.password, '***')
        assert.equal(put.respuesta.objeto.password, '***')
        assert.notInclude(JSON.stringify(red), clave)
        // y nunca en la auditoría de la acción
        const acciones = await db.from('audit.acciones').where('accion', 'routeros.aplicar_servicio')
        assert.notInclude(JSON.stringify(acciones), clave)
    })

    test('limitar, cortar y reactivar por evento: cambia el perfil del secret y quita la sesión viva', async ({
        client,
        assert,
    }) => {
        const { servicio, user } = await crear(client)
        conectar(user, servicio.ipv4, '81')
        await sondear()
        const abierta = await db
            .from('network.sesiones')
            .where({ servicio_id: servicio.id, origen: 'sondeo' })
            .whereNull('fin')
            .firstOrFail()

        // limitar → perfil limitado y la sesión fuera (el cliente reconecta con el perfil nuevo)
        await cambiarEstado(servicio.id, 'limitado')
        assert.equal(secret(servicio.id)[0]!.profile, `plan-${planId}-limitado`)
        assert.lengthOf(activas(), 0)
        const cerrada = await db.from('network.sesiones').where('id', abierta.id).firstOrFail()
        assert.equal(cerrada.causa_fin, 'Admin-Reset')
        assert.isNotNull(cerrada.fin)

        // cortar → perfil de corte (address-list suspendidos): el portal lo identifica por IP
        conectar(user, servicio.ipv4, '82')
        await sondear()
        const desde = await ultimoOutbox()
        await cambiarEstado(servicio.id, 'suspendido')
        assert.equal(secret(servicio.id)[0]!.profile, 'suspendido')
        assert.containsSubset(perfil('suspendido'), { 'address-list': 'suspendidos' })
        assert.lengthOf(activas(), 0)
        assert.lengthOf(await outbox('sesion.terminada', desde), 1)
        conectar(user, servicio.ipv4, '83', '2001:db8:ff00:100::/56')
        await sondear()
        const resuelta = await resolverIp(servicio.ipv4)
        assert.equal(resuelta?.servicio_id, servicio.id)
        const resueltaV6 = await resolverIp('2001:db8:ff00:100::1')
        assert.equal(resueltaV6?.servicio_id, servicio.id)

        // reactivar por evento (no por el cron): perfil del plan, sesión fuera para que lo tome
        await cambiarEstado(servicio.id, 'activo')
        assert.equal(secret(servicio.id)[0]!.profile, `plan-${planId}`)
        assert.lengthOf(activas(), 0)

        // cada cambio quedó en audit.red: PATCH del secret y DELETE de /ppp/active
        const red = await db
            .from('audit.red')
            .where('servicio_id', servicio.id)
            .whereIn(db.raw("comando->>'ruta'"), ['/ppp/secret', '/ppp/active'])
            .orderBy('id')
        assert.deepEqual(
            red.filter((f) => f.ok).map((f) => `${f.comando.metodo} ${f.comando.ruta}`),
            [
                'PUT /ppp/secret',
                'PATCH /ppp/secret',
                'DELETE /ppp/active',
                'PATCH /ppp/secret',
                'DELETE /ppp/active',
                'PATCH /ppp/secret',
                'DELETE /ppp/active',
            ],
        )
        // reponer el mismo estado no escribe nada (idempotente)
        const antes = falso.escrituras.length
        await cambiarEstado(servicio.id, 'activo').catch(() => null)
        assert.equal(falso.escrituras.length, antes)
    })

    test('cambio de plan: perfil del plan nuevo, sesión fuera y perfiles del plan viejo borrados', async ({
        client,
        assert,
    }) => {
        const { servicio, user } = await crear(client)
        conectar(user, servicio.ipv4, '90')
        const otro = await crearPlanFila({ bajada_kbps: 50000, subida_kbps: 10000 })
        const ctx = contextoPrueba()
        await new EditarServicio().execute({ id: servicio.id, version: servicio.version, plan_id: otro }, ctx)
        await entregar(await eventosDe(ctx.requestId))
        assert.equal(secret(servicio.id)[0]!.profile, `plan-${otro}`)
        assert.lengthOf(activas(), 0)
        assert.isDefined(perfil(`plan-${otro}`))
        assert.isDefined(perfil(`plan-${otro}-limitado`))
        assert.isUndefined(perfil(`plan-${planId}`))
        assert.isUndefined(perfil(`plan-${planId}-limitado`))
    })

    test('retirar y eliminar: el secret se borra y la sesión se quita', async ({ client, assert }) => {
        const { servicio, user } = await crear(client)
        conectar(user, servicio.ipv4, 'A1')
        const ctx = contextoPrueba()
        await new RetirarServicio().execute({ id: servicio.id, motivo: 'baja' }, ctx)
        await entregar(await eventosDe(ctx.requestId))
        assert.lengthOf(secret(servicio.id), 0)
        assert.lengthOf(activas(), 0)

        // un servicio sin historial se elimina: `servicio.eliminado` borra su secret
        const otro = await crear(client)
        assert.lengthOf(secret(otro.servicio.id), 1)
        const ctx2 = contextoPrueba()
        await new EliminarServicio().execute({ id: otro.servicio.id, version: otro.servicio.version }, ctx2)
        await entregar(await eventosDe(ctx2.requestId))
        assert.lengthOf(secret(otro.servicio.id), 0)
    })

    test('sondeo de /ppp/active: abre y cierra network.sesiones con sus eventos, sin contadores', async ({
        client,
        assert,
    }) => {
        const { servicio, user } = await crear(client)
        const desde = await ultimoOutbox()
        conectar(user, servicio.ipv4, 'B1', '2001:db8:ff00:200::/56')
        await sondear()
        const sesion = await db
            .from('network.sesiones')
            .where({ servicio_id: servicio.id, origen: 'sondeo' })
            .firstOrFail()
        assert.containsSubset(sesion, {
            router_id: routerId,
            nas_ip: null,
            acct_session_id: 'sondeo:0xB1',
            user_ppp: user,
            ipv4: servicio.ipv4,
            prefijo_delegado_v6: '2001:db8:ff00:200::/56',
            fin: null,
        })
        assert.equal(Number(sesion.bytes_in), 0)
        // inicio = ahora − uptime (2m10s)
        assert.isBelow(Math.abs(Date.now() - 130_000 - new Date(sesion.inicio).getTime()), 15_000)
        const iniciadas = await outbox('sesion.iniciada', desde)
        assert.lengthOf(iniciadas, 1)
        assert.containsSubset(iniciadas[0], { servicio_id: servicio.id, origen: 'sondeo', nas_ip: null })

        // otro sondeo sin cambios: nada
        await sondear()
        assert.lengthOf(await outbox('sesion.iniciada', desde), 1)

        // el cliente se cae
        activas().splice(0, activas().length)
        await sondear()
        const cerrada = await db.from('network.sesiones').where('id', sesion.id).firstOrFail()
        assert.equal(cerrada.causa_fin, 'sondeo_sin_sesion')
        const terminadas = await outbox('sesion.terminada', desde)
        assert.lengthOf(terminadas, 1)
        assert.containsSubset(terminadas[0], { motivo: 'sondeo_sin_sesion', origen: 'sondeo' })
        // diff en audit.cambios y la corrida auditada
        assert.isNotNull(
            await db.from('audit.cambios').where({ entidad_tipo: 'sesion', entidad_id: sesion.id }).first(),
        )
        const [corridas] = await db
            .from('audit.acciones')
            .where('accion', 'sesiones.sondear_ppp')
            .count('* as n')
        assert.isAbove(Number(corridas.n), 0)
        // el router caído no cierra nada
        conectar(user, servicio.ipv4, 'B2')
        await sondear()
        await falso.caer()
        const salida = await sondear()
        await falso.levantar()
        const resultado = (salida.resultado as Array<{ router_id: number; error: string | null }>).find(
            (r) => r.router_id === routerId,
        )
        assert.isNotNull(resultado?.error)
        assert.isNotNull(
            await db
                .from('network.sesiones')
                .where({ servicio_id: servicio.id, acct_session_id: 'sondeo:0xB2' })
                .whereNull('fin')
                .first(),
        )
    })

    test('desconexión manual de una sesión de sondeo: la quita el dispatcher, no coa', async ({
        client,
        assert,
    }) => {
        const { servicio, user } = await crear(client)
        conectar(user, servicio.ipv4, 'C1')
        await sondear()
        const sesion = await db
            .from('network.sesiones')
            .where({ servicio_id: servicio.id, origen: 'sondeo' })
            .firstOrFail()
        const requestId = unico('req')
        await estado(
            client
                .post(`/api/v1/sesiones/${sesion.id}/desconectar`)
                .bearerToken(token)
                .header('X-Request-Id', requestId)
                .json({ motivo: 'prueba de soporte' }),
            202,
        )
        const eventos = await eventosDe(requestId)
        const pedido = eventos.find((e) => e.evento === 'sesion.desconexion_solicitada')!
        assert.containsSubset(pedido.payload, { sesion_id: Number(sesion.id), origen: 'sondeo' })
        await entregar(eventos)
        assert.lengthOf(activas(), 0)
        const cerrada = await db.from('network.sesiones').where('id', sesion.id).firstOrFail()
        assert.equal(cerrada.causa_fin, 'Admin-Reset')
        const red = await db
            .from('audit.red')
            .where('router_id', routerId)
            .whereRaw("comando->>'ruta' = '/ppp/active'")
        assert.lengthOf(red, 1)
    })

    test('reconciliador: repone faltantes, corrige, borra sobrantes propios y nunca toca secrets ajenos', async ({
        client,
        assert,
    }) => {
        const { servicio, user, clave } = await crear(client)
        // secret ajeno (sin comment de ArgosIsp) y uno de emergencia: intocables
        falso.tabla('/ppp/secret').push(
            { '.id': '*F1', name: 'tecnico', password: 'x', profile: 'default', service: 'any' },
            {
                '.id': '*F2',
                name: 'otro',
                password: 'y',
                profile: 'default',
                comment: 'argosisp-emergencia',
            },
        )
        // sobrante con el comment de un servicio que no está en este router
        falso.tabla('/ppp/secret').push({
            '.id': '*F3',
            name: 'viejo',
            password: 'z',
            profile: 'default',
            comment: commentServicio(999_999_999),
        })
        // faltante (borrado a mano) y editado a mano
        falso.borrarAMano('/ppp/secret', (o) => o.comment === commentServicio(servicio.id))
        const reconciliar = () =>
            new ReconciliarRouterOS(OPCIONES).execute(
                { router_id: routerId, motivo: 'manual' },
                contextoPrueba(),
            )
        let r = await reconciliar()
        assert.isNull(r.error)
        assert.containsSubset(secret(servicio.id)[0], {
            name: user,
            password: clave,
            profile: `plan-${planId}`,
        })
        assert.isUndefined(falso.tabla('/ppp/secret').find((o) => o.name === 'viejo'))
        assert.isDefined(falso.tabla('/ppp/secret').find((o) => o.name === 'tecnico'))
        assert.isDefined(falso.tabla('/ppp/secret').find((o) => o.comment === 'argosisp-emergencia'))

        secret(servicio.id)[0]!.profile = 'default'
        secret(servicio.id)[0]!.password = 'cambiada-a-mano'
        r = await reconciliar()
        assert.containsSubset(secret(servicio.id)[0], { profile: `plan-${planId}`, password: clave })

        // sin la política `sensitive` el router no devuelve la contraseña: no se reescribe en cada pasada
        falso.ocultarPassword = true
        const antes = falso.escrituras.length
        r = await reconciliar()
        assert.isNull(r.error)
        assert.deepEqual(falso.escrituras.slice(antes), [])

        // un secret ajeno con el mismo name que un servicio: el alta falla (routeros.fallido) y el ajeno queda
        falso.ocultarPassword = false
        const desde = await ultimoOutbox()
        falso.borrarAMano('/ppp/secret', (o) => o.comment === commentServicio(servicio.id))
        falso
            .tabla('/ppp/secret')
            .push({ '.id': '*F4', name: user, password: 'del-tecnico', profile: 'default' })
        r = await reconciliar()
        // el 400 de ese secret no detiene el resto de la reconciliación
        assert.isNull(r.error)
        assert.lengthOf(r.errores_secrets, 1)
        assert.lengthOf(await outbox('routeros.fallido', desde), 1)
        assert.containsSubset(
            falso.tabla('/ppp/secret').find((o) => o['.id'] === '*F4'),
            { name: user, password: 'del-tecnico' },
        )
    })

    test('arbol_pcq sin RADIUS: el perfil pone la IPv4 en la lista del plan; el IPv6 lo agrega el sondeo', async ({
        client,
        assert,
    }) => {
        const arbol = estrategiasDeControl('arbol_pcq')
        await db
            .from('network.routers')
            .where('id', routerId)
            .update({ control_velocidad: 'arbol_pcq', estrategia_velocidad: JSON.stringify(arbol) })
        const { servicio, user } = await crear(client)
        assert.containsSubset(perfil(`plan-${planId}`), { 'address-list': `argosisp-plan-${planId}` })
        assert.containsSubset(perfil(`plan-${planId}-limitado`), {
            'address-list': `argosisp-plan-${planId}-limitado`,
        })
        assert.notProperty(perfil(`plan-${planId}`)!, 'rate-limit')
        conectar(user, servicio.ipv4, 'D1', '2001:db8:ff00:300::/56')
        const desde = await ultimoOutbox()
        await sondear()
        const nuevos = await db.from('audit.outbox').where('id', '>', desde).orderBy('id')
        await entregar(
            nuevos.map((f) => ({
                id: Number(f.id),
                evento: f.evento,
                payload: f.payload,
                requestId: f.request_id,
            })),
        )
        const v6 = falso.conComment('/ipv6/firewall/address-list', `${commentServicio(servicio.id)}:delegado`)
        assert.containsSubset(v6[0], { list: `argosisp-plan-${planId}`, address: '2001:db8:ff00:300::/56' })
        // la IPv4 no: la pone el router (dinámica) por el perfil
        assert.lengthOf(falso.conComment('/ip/firewall/address-list', commentServicio(servicio.id)), 0)
    })

    test('de api a radius: el reconciliador borra los secrets sin cortar las sesiones', async ({
        client,
        assert,
    }) => {
        const { servicio, user } = await crear(client)
        conectar(user, servicio.ipv4, 'E1')
        await db
            .from('network.routers')
            .where('id', routerId)
            .update({ modo_seguridad: 'radius', nas_ip: '192.0.2.77' })
        await entregar([
            {
                id: 0,
                evento: 'router.radius_cambiado',
                payload: { router_id: routerId, empresa_id: null, campos: ['modo_seguridad', 'nas_ip'] },
                requestId: unico('req'),
            },
        ])
        assert.lengthOf(secret(servicio.id), 0)
        assert.lengthOf(activas(), 1)
    })

    test('matriz: en un router sin RADIUS, PPPoE acepta perfil_ppp (cualquier padre) y arbol_pcq', ({
        assert,
    }) => {
        const base = estrategiasDeControl('simple')
        const con = (pppoe: Partial<EstrategiasRouter['pppoe']>): EstrategiasRouter => ({
            ...base,
            pppoe: { ...base.pppoe, ...pppoe },
        })
        const validar = (e: EstrategiasRouter) =>
            validarEstrategias({
                estrategias: e,
                planes: [],
                routeros_version: '7.24.5',
                capacidad_bajada_kbps: null,
                capacidad_subida_kbps: null,
                modo_seguridad: 'api',
            }).errores.map((x) => x.rule)
        assert.include(validar(con({ aplicacion: 'radius_rate_limit' })), 'pppoe_sin_radius')
        assert.include(validar(con({ aplicacion: 'pcq_plan', tipo_cola: 'pcq' })), 'pppoe_sin_radius')
        for (const padre of ['ninguno', 'por_plan', 'por_router', 'jerarquico'] as const) {
            assert.notInclude(validar(con({ aplicacion: 'perfil_ppp', padre })), 'pppoe_sin_radius')
        }
        assert.deepEqual(validar(estrategiasDeControl('arbol_pcq')), [])
        // con RADIUS no cambia nada
        assert.deepEqual(
            validarEstrategias({
                estrategias: base,
                planes: [],
                routeros_version: null,
                capacidad_bajada_kbps: null,
                capacidad_subida_kbps: null,
                modo_seguridad: 'radius',
            }).errores,
            [],
        )
        // un router api con la estrategia por defecto se aplica como perfil_ppp
        assert.equal(estrategiaLocal(base.pppoe).aplicacion, 'perfil_ppp')
        assert.equal(segundosUptime('1w2d3h4m5s'), 604800 + 2 * 86400 + 3 * 3600 + 245)
        assert.isNull(segundosUptime('ayer'))
    })
})
