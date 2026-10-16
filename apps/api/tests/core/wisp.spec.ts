import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { redis } from '#shared/redis'
import { claveAaa } from '#core/aaa'
import { verificarRestriccionesDiferidas } from '#shared/domain_action'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila, crearRouterFila } from '#tests/core/fabricas'
import { limpiarClavesAaa } from '#tests/core/ayudas_aaa'

/**
 * Semana 2 · servicios WISP sin PPPoE (`.claude/integration/contratos/routeros.md`):
 * `tipo_conexion` (`pppoe`, `ip_estatica`, `dhcp_fija`), `amarre_ip_mac`, CHECKs en la base,
 * validación 422 por campo, diff y `servicio.config_cambiada` con `tipo_conexion`, y `aaa` que
 * los trata como inexistentes.
 */

const MAC = 'AA:BB:CC:00:11:22'

async function escenario() {
    const esc = await crearEscenarioRouter()
    const planId = await crearPlanFila({ bajada_limitada_kbps: 2048, subida_limitada_kbps: 1024 })
    const clienteId = await crearClienteFila({ nombre: 'Pedro Wisp' })
    return { ...esc, planId, clienteId }
}

function crear(client: any, token: string, cuerpo: Record<string, unknown>, requestId = unico('req')) {
    return client
        .post('/api/v1/servicios')
        .bearerToken(token)
        .header('X-Request-Id', requestId)
        .json({ plantilla_facturacion_id: null, ...cuerpo })
}

function editar(
    client: any,
    token: string,
    id: number,
    cuerpo: Record<string, unknown>,
    requestId = unico('req'),
) {
    return client
        .put(`/api/v1/servicios/${id}`)
        .bearerToken(token)
        .header('X-Request-Id', requestId)
        .json(cuerpo)
}

async function eventos(requestId: string) {
    const filas = await db.from('audit.outbox').where('request_id', requestId).orderBy('id')
    return filas.map((f) => ({ evento: f.evento as string, payload: f.payload }))
}

const internoGet = (client: any, userPpp: string) =>
    client
        .get('/api/v1/internal/aaa/servicio')
        .qs({ user_ppp: userPpp })
        .bearerToken(env.get('INTERNAL_TOKEN'))

async function leer(peticion: PromiseLike<any>, status: number) {
    const respuesta = await estado(peticion, status)
    return respuesta.body()
}

function campos(respuesta: any): string[] {
    return (respuesta.body().errors as Array<{ field: string }>).map((e) => e.field)
}

test.group('WISP · alta sin PPPoE', (group) => {
    group.setup(limpiarClavesAaa)

    test('ip_estatica: sin credenciales, IPv4 de la red del router, sin IPv6 por RADIUS, outbox', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const { routerId, planId, clienteId, base } = await escenario()
        const requestId = unico('req')
        const r = await estado(
            crear(
                client,
                token,
                { cliente_id: clienteId, router_id: routerId, plan_id: planId, tipo_conexion: 'ip_estatica' },
                requestId,
            ),
            201,
        )
        const s = r.body()
        assert.containsSubset(s, {
            tipo_conexion: 'ip_estatica',
            user_ppp: null,
            amarre_ip_mac: false,
            ipv4: `${base}.2`,
            ipv6_modo: 'ninguno',
            prefijo_enlace_v6: null,
            prefijo_delegado_v6: null,
        })
        const fila = await db.from('core.servicios').where('id', s.id).firstOrFail()
        assert.isNull(fila.user_ppp)
        assert.isNull(fila.pass_ppp)

        const evs = await eventos(requestId)
        assert.deepEqual(
            evs.map((e) => e.evento),
            ['servicio.creado', 'asignacion.cambiada'],
        )
        // auditoría: sin "pass_ppp: definida" fuera de pppoe
        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'servicio', entidad_id: s.id })
            .select('campo')
        const nombres = cambios.map((c) => c.campo as string)
        assert.include(nombres, 'tipo_conexion')
        assert.notInclude(nombres, 'pass_ppp')

        // credenciales: no tiene
        const admin = await usuarioConRoles(['admin'])
        const cred = await estado(
            client.get(`/api/v1/servicios/${s.id}/credenciales`).bearerToken(admin.token),
            422,
        )
        assert.equal(cred.body().type, 'urn:argosisp:problema:sin_credenciales_ppp')
    })

    test('dhcp_fija con mac y amarre IP-MAC; IPv4 pedida a mano', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const { routerId, planId, clienteId, base } = await escenario()
        const r = await estado(
            crear(client, token, {
                cliente_id: clienteId,
                router_id: routerId,
                plan_id: planId,
                tipo_conexion: 'dhcp_fija',
                mac: MAC,
                amarre_ip_mac: true,
                ipv4: `${base}.50`,
            }),
            201,
        )
        assert.containsSubset(r.body(), {
            tipo_conexion: 'dhcp_fija',
            mac: MAC.toLowerCase(),
            amarre_ip_mac: true,
            ipv4: `${base}.50`,
            user_ppp: null,
        })
    })

    test('422 por campo: dhcp_fija sin mac, credenciales o modo RADIUS fuera de pppoe, amarre en pppoe', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const { routerId, planId, clienteId } = await escenario()
        const base = { cliente_id: clienteId, router_id: routerId, plan_id: planId }

        let r = await estado(crear(client, token, { ...base, tipo_conexion: 'dhcp_fija' }), 422)
        assert.deepEqual(campos(r), ['mac'])

        r = await estado(
            crear(client, token, {
                ...base,
                tipo_conexion: 'ip_estatica',
                user_ppp: 'no.debe',
                pass_ppp: 'secreta123',
                ipv6_modo: 'radius_servicio',
            }),
            422,
        )
        assert.sameMembers(campos(r), ['user_ppp', 'pass_ppp', 'ipv6_modo'])

        r = await estado(crear(client, token, { ...base, amarre_ip_mac: true, mac: MAC }), 422)
        assert.deepEqual(campos(r), ['amarre_ip_mac'])

        r = await estado(
            crear(client, token, { ...base, tipo_conexion: 'ip_estatica', amarre_ip_mac: true }),
            422,
        )
        assert.deepEqual(campos(r), ['mac'])

        r = await estado(crear(client, token, { ...base, tipo_conexion: 'wifi' }), 422)
        assert.deepEqual(campos(r), ['tipo_conexion'])

        const planV6 = await crearPlanFila({ dual_stack: 'v6' })
        r = await estado(
            crear(client, token, { ...base, plan_id: planV6, tipo_conexion: 'ip_estatica' }),
            422,
        )
        assert.deepEqual(campos(r), ['tipo_conexion'])
        assert.equal(
            await db
                .from('core.servicios')
                .where('cliente_id', clienteId)
                .count('* as n')
                .first()
                .then((f) => Number(f.n)),
            0,
        )
    })

    test('sin redes IPv4 en el router: 422 sin_ipv4 aunque el plan tenga pool', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const routerId = await crearRouterFila()
        const planId = await crearPlanFila()
        await db
            .table('network.planes_routers')
            .insert({ plan_id: planId, router_id: routerId, pool_ipv4: 'pool1' })
        const clienteId = await crearClienteFila()
        const r = await estado(
            crear(client, token, {
                cliente_id: clienteId,
                router_id: routerId,
                plan_id: planId,
                tipo_conexion: 'ip_estatica',
            }),
            422,
        )
        assert.equal(r.body().type, 'urn:argosisp:problema:sin_ipv4')
    })

    test('CHECKs en la base: credenciales por tipo, mac en dhcp_fija e IPv4 obligatoria al confirmar', async ({
        assert,
    }) => {
        const routerId = await crearRouterFila()
        const planId = await crearPlanFila()
        const clienteId = await crearClienteFila()
        const fila = { cliente_id: clienteId, router_id: routerId, plan_id: planId }

        const insertar = (datos: Record<string, unknown>) =>
            db.transaction(async (trx) => {
                await trx.table('core.servicios').insert({ ...fila, ...datos })
                // knex no rechaza un COMMIT que falla por restricción diferida: se fuerza aquí
                await verificarRestriccionesDiferidas(trx)
            })

        await assert.rejects(() => insertar({ tipo_conexion: 'pppoe' }), /servicios_credenciales_por_tipo/)
        await assert.rejects(
            () => insertar({ tipo_conexion: 'ip_estatica', user_ppp: unico('x'), pass_ppp: 'v1.x' }),
            /servicios_credenciales_por_tipo/,
        )
        await assert.rejects(() => insertar({ tipo_conexion: 'dhcp_fija' }), /servicios_dhcp_fija_mac/)
        await assert.rejects(() => insertar({ tipo_conexion: 'dhcp_fija', mac: 'no-es-mac' }), /macaddr/)
        // sin IPv4 vigente al COMMIT
        await assert.rejects(() => insertar({ tipo_conexion: 'ip_estatica' }), /no es PPPoE y no tiene IPv4/)
    })

    test('liberar la IPv4 de un servicio sin PPPoE no retirado falla al confirmar', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const { routerId, planId, clienteId } = await escenario()
        const s = await leer(
            crear(client, token, {
                cliente_id: clienteId,
                router_id: routerId,
                plan_id: planId,
                tipo_conexion: 'ip_estatica',
            }),
            201,
        )
        await assert.rejects(
            () =>
                db.transaction(async (trx) => {
                    await trx
                        .from('network.ipv4_asignaciones')
                        .where('servicio_id', s.id)
                        .whereNull('fin')
                        .update({ fin: new Date() })
                    await verificarRestriccionesDiferidas(trx)
                }),
            /no es PPPoE y no tiene IPv4/,
        )
    })
})

test.group('WISP · filtros y vista', () => {
    test('GET /servicios?tipo_conexion= filtra', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const { routerId, planId, clienteId } = await escenario()
        const base = { cliente_id: clienteId, router_id: routerId, plan_id: planId }
        const pppoe = await leer(crear(client, token, base), 201)
        const estatica = await leer(crear(client, token, { ...base, tipo_conexion: 'ip_estatica' }), 201)
        const dhcp = await leer(crear(client, token, { ...base, tipo_conexion: 'dhcp_fija', mac: MAC }), 201)

        const ids = async (tipo: string) => {
            const pagina = await leer(
                client
                    .get('/api/v1/servicios')
                    .bearerToken(token)
                    .qs({ cliente_id: clienteId, tipo_conexion: tipo }),
                200,
            )
            return pagina.data.map((s: any) => s.id)
        }
        assert.deepEqual(await ids('pppoe'), [pppoe.id])
        assert.deepEqual(await ids('ip_estatica'), [estatica.id])
        assert.deepEqual(await ids('dhcp_fija'), [dhcp.id])
        await estado(client.get('/api/v1/servicios').bearerToken(token).qs({ tipo_conexion: 'otro' }), 422)
    })
})

test.group('WISP · cambiar tipo de conexión', (group) => {
    group.setup(limpiarClavesAaa)

    test('pppoe → ip_estatica: borra credenciales, lápida sin credenciales, diff y config_cambiada', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const { routerId, planId, clienteId, base } = await escenario()
        const s = await leer(
            crear(client, token, { cliente_id: clienteId, router_id: routerId, plan_id: planId }),
            201,
        )
        assert.isNotNull(await redis().get(claveAaa(s.user_ppp)))
        await estado(internoGet(client, s.user_ppp), 200)

        const requestId = unico('req')
        const r = await estado(
            editar(client, token, s.id, { version: s.version, tipo_conexion: 'ip_estatica' }, requestId),
            200,
        )
        assert.containsSubset(r.body(), {
            tipo_conexion: 'ip_estatica',
            user_ppp: null,
            ipv4: `${base}.2`,
            ipv6_modo: 'ninguno',
            prefijo_enlace_v6: null,
            prefijo_delegado_v6: null,
            version: s.version + 1,
        })
        const fila = await db.from('core.servicios').where('id', s.id).firstOrFail()
        assert.isNull(fila.pass_ppp)

        // lápida sin credenciales; el endpoint lo trata como inexistente
        const lapida = JSON.parse((await redis().get(claveAaa(s.user_ppp)))!)
        assert.deepEqual(lapida, {
            eliminado: true,
            user_ppp: s.user_ppp,
            servicio_id: s.id,
            version: s.version + 1,
        })
        assert.notProperty(lapida, 'pass_ppp')
        await estado(internoGet(client, s.user_ppp), 404)

        const evs = await eventos(requestId)
        const config = evs.find((e) => e.evento === 'servicio.config_cambiada')!
        assert.includeMembers(config.payload.campos, ['tipo_conexion', 'prefijo_v6'])
        assert.isDefined(evs.find((e) => e.evento === 'asignacion.cambiada'))

        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'servicio', entidad_id: s.id, campo: 'tipo_conexion' })
            .select('antes', 'despues')
        assert.lengthOf(cambios, 2)
        assert.deepEqual([cambios[1]!.antes, cambios[1]!.despues], ['pppoe', 'ip_estatica'])
    })

    test('ip_estatica → pppoe genera credenciales; user_ppp solo al cambiar a pppoe', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const { routerId, planId, clienteId } = await escenario()
        const s = await leer(
            crear(client, token, {
                cliente_id: clienteId,
                router_id: routerId,
                plan_id: planId,
                tipo_conexion: 'ip_estatica',
            }),
            201,
        )
        let r = await estado(editar(client, token, s.id, { version: s.version, user_ppp: 'no.toca' }), 422)
        assert.deepEqual(campos(r), ['user_ppp'])
        r = await estado(editar(client, token, s.id, { version: s.version, pass_ppp: 'secreta123' }), 422)
        assert.deepEqual(campos(r), ['pass_ppp'])

        const requestId = unico('req')
        r = await estado(
            editar(client, token, s.id, { version: s.version, tipo_conexion: 'pppoe' }, requestId),
            200,
        )
        assert.equal(r.body().tipo_conexion, 'pppoe')
        assert.equal(r.body().user_ppp, `pedro.${clienteId}`)
        const fila = await db.from('core.servicios').where('id', s.id).firstOrFail()
        assert.match(fila.pass_ppp, /^v1\./)
        const evs = await eventos(requestId)
        assert.include(
            evs.find((e) => e.evento === 'servicio.config_cambiada')!.payload.campos,
            'tipo_conexion',
        )
        const registro = await leer(internoGet(client, r.body().user_ppp), 200)
        assert.equal(registro.servicio_id, s.id)
    })

    test('a dhcp_fija sin mac: 422; cambiar mac emite config_cambiada con mac', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const { routerId, planId, clienteId } = await escenario()
        const s = await leer(
            crear(client, token, { cliente_id: clienteId, router_id: routerId, plan_id: planId }),
            201,
        )
        let r = await estado(
            editar(client, token, s.id, { version: s.version, tipo_conexion: 'dhcp_fija' }),
            422,
        )
        assert.deepEqual(campos(r), ['mac'])
        r = await estado(
            editar(client, token, s.id, { version: s.version, tipo_conexion: 'dhcp_fija', mac: MAC }),
            200,
        )
        const requestId = unico('req')
        await estado(
            editar(
                client,
                token,
                s.id,
                { version: r.body().version, mac: 'AA:BB:CC:00:11:33', amarre_ip_mac: true },
                requestId,
            ),
            200,
        )
        const evs = await eventos(requestId)
        const config = evs.find((e) => e.evento === 'servicio.config_cambiada')!
        assert.sameMembers(config.payload.campos, ['mac', 'amarre_ip_mac'])
    })
})
