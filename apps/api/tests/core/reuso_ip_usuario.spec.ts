import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { redis } from '#shared/redis'
import { claveAaa, escribirLapidaAaa, escribirRegistrosAaa, registrosAaaPorServicio } from '#core/aaa'
import { ConsumidorAaaCache } from '#core/consumidor_aaa'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila, ipUnica } from '#tests/core/fabricas'
import { limpiarClavesAaa } from '#tests/core/ayudas_aaa'

/**
 * Reúso de IPs liberadas y de usuarios PPPoE (pedido del PM, 5 nov: «a prueba de bugs").
 *
 * Una IP, un prefijo o un `user_ppp` liberado nunca queda en dos servicios a la vez, siempre vuelve
 * a quedar libre y no queda «fantasma» en Redis (`aaa:user:*`): lo que lee `/aaa/authorize` (la clave
 * de Redis y, si falta, `GET /internal/aaa/servicio`) siempre es del servicio dueño en Postgres.
 * Las pruebas de concurrencia lanzan las peticiones a la vez (`Promise.all`) contra Postgres real.
 */

async function leer(peticion: PromiseLike<any>, status: number) {
    const respuesta = await estado(peticion, status)
    return respuesta.body()
}

function codigo(cuerpo: { type?: string }): string {
    return String(cuerpo.type ?? '')
        .split(':')
        .pop()!
}

async function enRedis(userPpp: string): Promise<Record<string, any> | null> {
    const valor = await redis().get(claveAaa(userPpp))
    return valor === null ? null : (JSON.parse(valor) as Record<string, any>)
}

/** Lo que decide `/aaa/authorize` con la clave de Redis: de qué servicio es o si se rechaza. */
async function autoriza(userPpp: string): Promise<number | 'rechazo' | null> {
    const v = await enRedis(userPpp)
    if (v === null) return null
    if (v.eliminado === true || v.estado === 'retirado') return 'rechazo'
    return Number(v.servicio_id)
}

async function vigentesV4(ip: string) {
    return (await db
        .from('network.ipv4_asignaciones')
        .whereRaw('ip = ?::inet', [ip])
        .whereNull('fin')
        .select('servicio_id')) as Array<{ servicio_id: number }>
}

async function abrirSesion(datos: { servicioId: number | null; userPpp: string; ipv4?: string | null }) {
    const [fila] = (await db
        .table('network.sesiones')
        .insert({
            servicio_id: datos.servicioId,
            nas_ip: ipUnica(),
            acct_session_id: unico('ses'),
            user_ppp: datos.userPpp,
            ipv4: datos.ipv4 ?? null,
        })
        .returning('id')) as Array<{ id: number }>
    return fila!.id
}

async function cerrarSesion(id: number) {
    await db.from('network.sesiones').where('id', id).update({ fin: new Date(), causa_fin: 'prueba' })
}

test.group('Reúso · IPs liberadas (IPAM v4 y v6)', (group) => {
    let token: string
    let planId: number
    let clienteId: number
    group.setup(async () => {
        await limpiarClavesAaa()
        ;({ token } = await usuarioConRoles(['admin']))
        planId = await crearPlanFila()
        clienteId = await crearClienteFila({ nombre: 'Reúso IP' })
    })

    const crear = (client: any, routerId: number, extra: Record<string, unknown> = {}) =>
        client
            .post('/api/v1/servicios')
            .bearerToken(token)
            .json({
                plantilla_facturacion_id: null,
                cliente_id: clienteId,
                router_id: routerId,
                plan_id: planId,
                ...extra,
            })

    const editar = (client: any, id: number, cuerpo: Record<string, unknown>) =>
        client.put(`/api/v1/servicios/${id}`).bearerToken(token).json(cuerpo)

    test('dos altas a la vez con la misma IP: una gana y la otra recibe 409 ip_ocupada', async ({
        client,
        assert,
    }) => {
        const { routerId, base } = await crearEscenarioRouter()
        const ip = `${base}.50`
        const respuestas = await Promise.all(
            Array.from({ length: 5 }, () => crear(client, routerId, { ipv4: ip })),
        )
        const estados = respuestas.map((r: any) => r.status()).sort()
        assert.deepEqual(estados, [201, 409, 409, 409, 409])
        for (const r of respuestas.filter((x: any) => x.status() === 409)) {
            assert.equal(codigo(r.body()), 'ip_ocupada')
        }
        assert.lengthOf(await vigentesV4(ip), 1)
    })

    test('altas automáticas a la vez: IPs distintas, nunca el gateway ni la red', async ({
        client,
        assert,
    }) => {
        const { routerId, base } = await crearEscenarioRouter()
        const respuestas = await Promise.all(Array.from({ length: 8 }, () => crear(client, routerId)))
        const ips = respuestas.map((r: any) => {
            r.assertStatus(201)
            return r.body().ipv4 as string
        })
        assert.lengthOf(new Set(ips), 8)
        assert.notInclude(ips, `${base}.0`)
        assert.notInclude(ips, `${base}.1`)
        assert.notInclude(ips, `${base}.255`)
        const enlaces = respuestas.map((r: any) => r.body().prefijo_enlace_v6)
        const delegados = respuestas.map((r: any) => r.body().prefijo_delegado_v6)
        assert.lengthOf(new Set(enlaces), 8)
        assert.lengthOf(new Set(delegados), 8)
    })

    test('dos ediciones a la vez que piden la misma IP libre: una gana, la otra 409 ip_ocupada', async ({
        client,
        assert,
    }) => {
        const { routerId, base } = await crearEscenarioRouter()
        const a = await leer(crear(client, routerId), 201)
        const b = await leer(crear(client, routerId), 201)
        const ip = `${base}.77`
        const [ra, rb] = await Promise.all([
            editar(client, a.id, { version: a.version, ipv4: ip }),
            editar(client, b.id, { version: b.version, ipv4: ip }),
        ])
        assert.sameMembers([ra.status(), rb.status()], [200, 409])
        const perdedora = ra.status() === 409 ? ra : rb
        assert.equal(codigo(perdedora.body()), 'ip_ocupada')
        assert.lengthOf(await vigentesV4(ip), 1)
    })

    test('el gateway, la red y el broadcast nunca se entregan a mano', async ({ client, assert }) => {
        const { routerId, base } = await crearEscenarioRouter()
        for (const ip of [`${base}.0`, `${base}.1`, `${base}.255`]) {
            const r = await leer(crear(client, routerId, { ipv4: ip }), 422)
            assert.equal(r.errors[0].rule, 'reservada')
        }
    })

    test('liberar: ipv4 null, cambio de IP, de router y retiro cierran el tramo y la IP queda libre', async ({
        client,
        assert,
    }) => {
        const esc = await crearEscenarioRouter()
        const otro = await crearEscenarioRouter()
        const s = await leer(crear(client, esc.routerId), 201)
        const ip1 = s.ipv4 as string

        // ipv4: null → la IP vuelve a estar libre en el mismo commit
        const sinIp = await leer(editar(client, s.id, { version: s.version, ipv4: null }), 200)
        assert.lengthOf(await vigentesV4(ip1), 0)
        const otroServicio = await leer(crear(client, esc.routerId, { ipv4: ip1 }), 201)
        assert.equal(otroServicio.ipv4, ip1)

        // cambiar la IP
        const ip2 = `${esc.base}.120`
        const conIp = await leer(editar(client, s.id, { version: sinIp.version, ipv4: ip2 }), 200)
        const ip3 = `${esc.base}.121`
        const cambiada = await leer(editar(client, s.id, { version: conIp.version, ipv4: ip3 }), 200)
        assert.lengthOf(await vigentesV4(ip2), 0)
        await leer(crear(client, esc.routerId, { ipv4: ip2 }), 201)

        // mover de router: la IP del router viejo se libera
        const movido = await leer(
            editar(client, s.id, { version: cambiada.version, router_id: otro.routerId }),
            200,
        )
        assert.isTrue(String(movido.ipv4).startsWith(`${otro.base}.`))
        assert.lengthOf(await vigentesV4(ip3), 0)

        // retiro: IPv4 y prefijos libres; el historial de tramos se conserva
        const ipMovida = movido.ipv4 as string
        await leer(
            client.post(`/api/v1/servicios/${s.id}/retirar`).bearerToken(token).json({ motivo: 'prueba' }),
            200,
        )
        assert.lengthOf(await vigentesV4(ipMovida), 0)
        const v6 = await db.from('network.ipv6_asignaciones').where('servicio_id', s.id).whereNull('fin')
        assert.lengthOf(v6, 0)
        const tramos = await db
            .from('network.ipv4_asignaciones')
            .where('servicio_id', s.id)
            .orderBy('id')
            .select(db.raw('host(ip) AS ip'), 'fin')
        assert.deepEqual(
            tramos.map((t: any) => t.ip),
            [ip1, ip2, ip3, ipMovida],
        )
        assert.isTrue(tramos.every((t: any) => t.fin !== null))
        const reusada = await leer(crear(client, otro.routerId, { ipv4: ipMovida }), 201)
        assert.equal(reusada.ipv4, ipMovida)
    })

    test('cuarentena: una IP liberada no se entrega mientras una sesión abierta la usa', async ({
        client,
        assert,
    }) => {
        const { routerId, base } = await crearEscenarioRouter()
        const s = await leer(crear(client, routerId, { ipv4: `${base}.200` }), 201)
        const sesion = await abrirSesion({ servicioId: s.id, userPpp: s.user_ppp, ipv4: `${base}.200` })
        await leer(editar(client, s.id, { version: s.version, ipv4: `${base}.201` }), 200)

        // pedida a mano: 409 ip_en_sesion; en la asignación automática se salta
        const r = await leer(crear(client, routerId, { ipv4: `${base}.200` }), 409)
        assert.equal(codigo(r), 'ip_en_sesion')
        await db
            .from('network.redes_ipv4')
            .where('router_id', routerId)
            .update({ rango_inicio: `${base}.200`, rango_fin: `${base}.202` })
        const auto = await leer(crear(client, routerId), 201)
        assert.equal(auto.ipv4, `${base}.202`)

        // el mismo servicio puede volver a su IP aunque su sesión siga abierta
        const actual = await db.from('core.servicios').where('id', s.id).select('version').firstOrFail()
        const vuelta = await leer(editar(client, s.id, { version: actual.version, ipv4: `${base}.200` }), 200)
        assert.equal(vuelta.ipv4, `${base}.200`)
        const otraVez = await leer(
            editar(client, s.id, { version: vuelta.version, ipv4: `${base}.201` }),
            200,
        )

        // al cerrar la sesión la IP queda libre de inmediato (sin TTL)
        await cerrarSesion(sesion)
        const libre = await leer(crear(client, routerId, { ipv4: `${base}.200` }), 201)
        assert.equal(libre.ipv4, `${base}.200`)
        assert.isNumber(otraVez.version)
    })

    test('IPv6 estático a la vez con prefijos que se traslapan: uno gana, el resto 409 prefijo_ocupado', async ({
        client,
        assert,
    }) => {
        const { routerId } = await crearEscenarioRouter()
        const planV6 = await crearPlanFila()
        const prefijos = ['2001:db7:1::/48', '2001:db7:1::/56', '2001:db7:1::/52', '2001:db7:1::/48']
        const respuestas = await Promise.all(
            prefijos.map((prefijo) =>
                crear(client, routerId, {
                    plan_id: planV6,
                    ipv6_modo: 'estatico',
                    prefijo_delegado_v6: prefijo,
                }),
            ),
        )
        const ganadoras = respuestas.filter((r: any) => r.status() === 201)
        const perdedoras = respuestas.filter((r: any) => r.status() !== 201)
        assert.lengthOf(ganadoras, 1)
        for (const r of perdedoras) {
            assert.equal(r.status(), 409)
            assert.equal(codigo(r.body()), 'prefijo_ocupado')
        }
        const { rows } = await db.rawQuery(
            `SELECT count(*)::int AS n FROM network.ipv6_asignaciones a
               JOIN network.ipv6_asignaciones b ON a.id < b.id AND a.prefijo && b.prefijo
              WHERE a.fin IS NULL AND b.fin IS NULL`,
        )
        assert.equal(rows[0].n, 0)
    })

    test('restricciones: la base rechaza dos IPv4 vigentes en un servicio y dos prefijos que se traslapan', async ({
        client,
        assert,
    }) => {
        const { routerId, base } = await crearEscenarioRouter()
        const s = await leer(crear(client, routerId), 201)
        const red = await db.from('network.redes_ipv4').where('router_id', routerId).firstOrFail()
        await assert.rejects(
            () =>
                db
                    .table('network.ipv4_asignaciones')
                    .insert({ servicio_id: s.id, red_id: red.id, ip: `${base}.99` }),
            /ipv4_asignaciones_servicio_vigente/,
        )
        const delegado = s.prefijo_delegado_v6 as string
        const otro = await leer(crear(client, routerId, { ipv6_modo: 'ninguno' }), 201)
        await assert.rejects(
            () =>
                db.table('network.ipv6_asignaciones').insert({
                    servicio_id: otro.id,
                    prefijo: delegado.replace('/56', '/60'),
                    tipo: 'delegacion',
                    pool_id: null,
                }),
            /ipv6_asignaciones_sin_traslape/,
        )
    })
})

test.group('Reúso · usuarios PPPoE', (group) => {
    let token: string
    let planId: number
    let routerId: number
    group.setup(async () => {
        await limpiarClavesAaa()
        ;({ token } = await usuarioConRoles(['admin']))
        planId = await crearPlanFila()
        ;({ routerId } = await crearEscenarioRouter())
    })

    const crear = (client: any, clienteId: number, extra: Record<string, unknown> = {}) =>
        client
            .post('/api/v1/servicios')
            .bearerToken(token)
            .json({
                plantilla_facturacion_id: null,
                cliente_id: clienteId,
                router_id: routerId,
                plan_id: planId,
                ...extra,
            })

    const editar = (client: any, id: number, cuerpo: Record<string, unknown>) =>
        client.put(`/api/v1/servicios/${id}`).bearerToken(token).json(cuerpo)

    const version = async (id: number) => {
        const fila = await db.from('core.servicios').where('id', id).select('version').firstOrFail()
        return Number(fila.version)
    }

    test('altas a la vez del mismo cliente sin user_ppp: todas reciben uno distinto', async ({
        client,
        assert,
    }) => {
        const clienteId = await crearClienteFila({ nombre: 'Concurrente Pérez' })
        const respuestas = await Promise.all(Array.from({ length: 4 }, () => crear(client, clienteId)))
        const usuarios = respuestas.map((r: any) => {
            r.assertStatus(201)
            return r.body().user_ppp as string
        })
        assert.lengthOf(new Set(usuarios), 4)
    })

    test('dos altas a la vez con el mismo user_ppp: 201 y 409 user_ppp_duplicado', async ({
        client,
        assert,
    }) => {
        const clienteId = await crearClienteFila()
        const usuario = unico('mismo').replace('-', '.')
        const respuestas = await Promise.all(
            Array.from({ length: 3 }, () => crear(client, clienteId, { user_ppp: usuario })),
        )
        assert.deepEqual(respuestas.map((r: any) => r.status()).sort(), [201, 409, 409])
        for (const r of respuestas.filter((x: any) => x.status() === 409)) {
            assert.equal(codigo(r.body()), 'user_ppp_duplicado')
        }
    })

    test('renombres a la vez al mismo usuario: uno gana, el otro 409 user_ppp_duplicado', async ({
        client,
        assert,
    }) => {
        const clienteId = await crearClienteFila()
        const a = await leer(crear(client, clienteId), 201)
        const b = await leer(crear(client, clienteId), 201)
        const destino = unico('destino').replace('-', '.')
        const [ra, rb] = await Promise.all([
            editar(client, a.id, { version: a.version, user_ppp: destino }),
            editar(client, b.id, { version: b.version, user_ppp: destino }),
        ])
        assert.sameMembers([ra.status(), rb.status()], [200, 409])
        const perdedora = ra.status() === 409 ? ra : rb
        assert.equal(codigo(perdedora.body()), 'user_ppp_duplicado')
        const ganador = ra.status() === 200 ? a.id : b.id
        assert.equal(await autoriza(destino), ganador)
    })

    test('A→B y luego B→A en el mismo servicio: Redis queda con A y B en lápida', async ({
        client,
        assert,
    }) => {
        const clienteId = await crearClienteFila()
        const s = await leer(crear(client, clienteId), 201)
        const a = s.user_ppp as string
        const b = unico('b').replace('-', '.')
        const r1 = await leer(editar(client, s.id, { version: s.version, user_ppp: b }), 200)
        assert.equal(await autoriza(a), 'rechazo')
        assert.equal(await autoriza(b), s.id)
        const r2 = await leer(editar(client, s.id, { version: r1.version, user_ppp: a }), 200)
        assert.equal(await autoriza(a), s.id)
        assert.equal(await autoriza(b), 'rechazo')
        assert.equal((await enRedis(a))!.version, r2.version)
        const interno = await leer(
            client
                .get('/api/v1/internal/aaa/servicio')
                .qs({ user_ppp: a })
                .bearerToken(env.get('INTERNAL_TOKEN')),
            200,
        )
        assert.equal(interno.servicio_id, s.id)
    })

    test('dos servicios intercambian usuarios (A↔B por un temporal): cada clave queda con su dueño', async ({
        client,
        assert,
    }) => {
        const clienteId = await crearClienteFila()
        const s1 = await leer(crear(client, clienteId), 201)
        const s2 = await leer(crear(client, clienteId), 201)
        const [a, b] = [s1.user_ppp as string, s2.user_ppp as string]
        // directo: 409 (el otro todavía lo tiene)
        const directo = await leer(editar(client, s1.id, { version: s1.version, user_ppp: b }), 409)
        assert.equal(codigo(directo), 'user_ppp_duplicado')

        const tmp = unico('tmp').replace('-', '.')
        await leer(editar(client, s1.id, { version: s1.version, user_ppp: tmp }), 200)
        await leer(editar(client, s2.id, { version: s2.version, user_ppp: a }), 200)
        await leer(editar(client, s1.id, { version: await version(s1.id), user_ppp: b }), 200)
        assert.equal(await autoriza(a), s2.id)
        assert.equal(await autoriza(b), s1.id)
        assert.equal(await autoriza(tmp), 'rechazo')
    })

    test('un gancho atrasado (lápida o registro viejo) no pisa la clave que ya es de otro servicio', async ({
        client,
        assert,
    }) => {
        const clienteId = await crearClienteFila()
        const s1 = await leer(crear(client, clienteId), 201)
        const x = s1.user_ppp as string
        const [viejo] = await registrosAaaPorServicio([s1.id])
        const y = unico('y').replace('-', '.')
        const r1 = await leer(editar(client, s1.id, { version: s1.version, user_ppp: y }), 200)
        const s2 = await leer(crear(client, clienteId, { user_ppp: x }), 201)
        assert.equal(await autoriza(x), s2.id)

        // el gancho del renombre de s1 llega tarde: su lápida en x
        await escribirLapidaAaa(x, s1.id, r1.version)
        assert.equal(await autoriza(x), s2.id)
        // y una lectura vieja de s1 (antes del renombre) llega todavía más tarde
        await escribirRegistrosAaa([viejo!])
        assert.equal(await autoriza(x), s2.id)
        assert.equal(await autoriza(y), s1.id)
    })

    test('red de seguridad: si la lápida de un renombre no llegó a Redis, el consumidor aaa-cache la escribe', async ({
        client,
        assert,
    }) => {
        const clienteId = await crearClienteFila()
        const s = await leer(crear(client, clienteId), 201)
        const x = s.user_ppp as string
        const [viejo] = await registrosAaaPorServicio([s.id])
        const y = unico('y').replace('-', '.')
        await leer(editar(client, s.id, { version: s.version, user_ppp: y }), 200)
        // como si Redis hubiera fallado justo después del COMMIT: x sigue con el registro completo
        await redis().set(claveAaa(x), JSON.stringify(viejo))
        assert.equal(await autoriza(x), s.id)

        const evento = (await db
            .from('audit.outbox')
            .where('evento', 'servicio.config_cambiada')
            .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [s.id])
            .orderBy('id', 'desc')
            .firstOrFail()) as { id: number; evento: string; payload: Record<string, unknown> }
        const consumidor = new ConsumidorAaaCache()
        await consumidor.procesar({ id: evento.id, evento: evento.evento, payload: evento.payload })
        assert.equal(await autoriza(x), 'rechazo')
        assert.equal(await autoriza(y), s.id)
        // idempotente
        await consumidor.procesar({ id: evento.id, evento: evento.evento, payload: evento.payload })
        assert.equal(await autoriza(x), 'rechazo')
    })

    test('dejar PPPoE con el gancho caído: el consumidor deja la lápida en el usuario viejo', async ({
        client,
        assert,
    }) => {
        const esc = await crearEscenarioRouter()
        const clienteId = await crearClienteFila()
        const s = await leer(
            client.post('/api/v1/servicios').bearerToken(token).json({
                plantilla_facturacion_id: null,
                cliente_id: clienteId,
                router_id: esc.routerId,
                plan_id: planId,
            }),
            201,
        )
        const [viejo] = await registrosAaaPorServicio([s.id])
        await db.from('network.routers').where('id', esc.routerId).update({ tipo_conexion: 'ip_estatica' })
        await leer(editar(client, s.id, { version: s.version, tipo_conexion: 'ip_estatica' }), 200)
        await redis().set(claveAaa(s.user_ppp), JSON.stringify(viejo))
        const evento = (await db
            .from('audit.outbox')
            .where('evento', 'servicio.config_cambiada')
            .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [s.id])
            .orderBy('id', 'desc')
            .firstOrFail()) as { id: number; evento: string; payload: Record<string, unknown> }
        await new ConsumidorAaaCache().procesar({
            id: evento.id,
            evento: evento.evento,
            payload: evento.payload,
        })
        assert.equal(await autoriza(s.user_ppp), 'rechazo')
    })

    test('reúso tras eliminar: libre de inmediato; la lápida atrasada del eliminado no pisa al nuevo', async ({
        client,
        assert,
    }) => {
        const clienteId = await crearClienteFila()
        const s1 = await leer(crear(client, clienteId), 201)
        const x = s1.user_ppp as string
        await leer(
            client.delete(`/api/v1/servicios/${s1.id}`).qs({ version: s1.version }).bearerToken(token),
            204,
        )
        assert.equal(await autoriza(x), 'rechazo')
        const s2 = await leer(crear(client, clienteId, { user_ppp: x }), 201)
        assert.equal(await autoriza(x), s2.id)
        await escribirLapidaAaa(x, s1.id, s1.version + 1)
        assert.equal(await autoriza(x), s2.id)
    })

    test('retirado: su user_ppp no se reutiliza (409) y su clave queda en lápida', async ({
        client,
        assert,
    }) => {
        const clienteId = await crearClienteFila()
        const s = await leer(crear(client, clienteId), 201)
        await leer(
            client.post(`/api/v1/servicios/${s.id}/retirar`).bearerToken(token).json({ motivo: 'baja' }),
            200,
        )
        assert.equal(await autoriza(s.user_ppp), 'rechazo')
        const r = await leer(crear(client, clienteId, { user_ppp: s.user_ppp }), 409)
        assert.equal(codigo(r), 'user_ppp_duplicado')
        assert.equal(await autoriza(s.user_ppp), 'rechazo')
    })

    test('no se toma un user_ppp con una sesión abierta de otro servicio (409 user_ppp_en_sesion)', async ({
        client,
        assert,
    }) => {
        const clienteId = await crearClienteFila()
        const s1 = await leer(crear(client, clienteId), 201)
        const x = s1.user_ppp as string
        const sesion = await abrirSesion({ servicioId: s1.id, userPpp: x })
        const y = unico('y').replace('-', '.')
        const r1 = await leer(editar(client, s1.id, { version: s1.version, user_ppp: y }), 200)

        const ocupado = await leer(crear(client, clienteId, { user_ppp: x }), 409)
        assert.equal(codigo(ocupado), 'user_ppp_en_sesion')
        // el mismo servicio sí puede volver a su usuario
        const vuelta = await leer(editar(client, s1.id, { version: r1.version, user_ppp: x }), 200)
        await leer(editar(client, s1.id, { version: vuelta.version, user_ppp: y }), 200)

        await cerrarSesion(sesion)
        const s2 = await leer(crear(client, clienteId, { user_ppp: x }), 201)
        assert.equal(await autoriza(x), s2.id)
    })

    test('mayúsculas: RADIUS y RouterOS las distinguen, así que Juan y juan son usuarios distintos', async ({
        client,
        assert,
    }) => {
        const clienteId = await crearClienteFila()
        const base = unico('juan').replace('-', '.')
        const minus = await leer(crear(client, clienteId, { user_ppp: base }), 201)
        const mayus = await leer(crear(client, clienteId, { user_ppp: base.toUpperCase() }), 201)
        assert.equal(await autoriza(base), minus.id)
        assert.equal(await autoriza(base.toUpperCase()), mayus.id)
    })
})
