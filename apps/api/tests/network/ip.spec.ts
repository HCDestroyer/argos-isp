import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import {
    bloqueV6Unico,
    crearClienteFila,
    crearEscenarioRouter,
    crearPlanFila,
    crearServicioFila,
    ipUnica,
} from '#tests/core/fabricas'

/**
 * Tarea 13: `GET /ip/{ip}` resuelve IPv4 o IPv6 por prefijo más largo contra sesiones activas y
 * asignaciones vigentes.
 */

async function sesion(datos: Record<string, unknown>) {
    await db.table('network.sesiones').insert({
        nas_ip: ipUnica(),
        acct_session_id: unico('acct'),
        user_ppp: unico('ppp'),
        ...datos,
    })
}

async function servicioSuelto() {
    const clienteId = await crearClienteFila()
    const servicioId = await crearServicioFila({ cliente_id: clienteId })
    return { clienteId, servicioId }
}

const resolver = (client: any, token: string, ip: string) =>
    client.get(`/api/v1/ip/${encodeURIComponent(ip)}`).bearerToken(token)

/** Cuerpo de una respuesta con el status esperado. */
async function cuerpo(peticion: PromiseLike<any>, status = 200) {
    const respuesta = await estado(peticion, status)
    return respuesta.body()
}

test.group('Red · GET /ip/{ip}', () => {
    test('servicio creado por la API: su IPv4, su /64 y su /56 resuelven al servicio y cliente', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const { routerId, base, raiz } = await crearEscenarioRouter()
        const planId = await crearPlanFila({ bajada_limitada_kbps: 1024, subida_limitada_kbps: 512 })
        const clienteId = await crearClienteFila()
        const s = await cuerpo(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({ cliente_id: clienteId, router_id: routerId, plan_id: planId }),
            201,
        )

        assert.deepEqual(await cuerpo(resolver(client, token, `${base}.2`)), {
            servicio_id: s.id,
            cliente_id: clienteId,
            prefijo: `${base}.2/32`,
        })
        assert.deepEqual(await cuerpo(resolver(client, token, `${raiz}10:ab::1`)), {
            servicio_id: s.id,
            cliente_id: clienteId,
            prefijo: `${raiz}10::/56`,
        })
        const enlace = await cuerpo(resolver(client, token, `${raiz}00::abcd`))
        assert.equal(enlace.prefijo, `${raiz}00::/64`)
        await estado(resolver(client, token, `${base}.3`), 404)
    })

    test('prefijo más largo: un /56 de sesión dentro de un /48 asignado gana para sus IPs', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const a = await servicioSuelto()
        const b = await servicioSuelto()
        const raiz = bloqueV6Unico().replace('00::/40', '')
        await db.table('network.ipv6_asignaciones').insert({
            servicio_id: a.servicioId,
            prefijo: `${raiz}30::/48`,
            tipo: 'delegacion',
        })
        await sesion({ servicio_id: b.servicioId, prefijo_delegado_v6: `${raiz}30:1200::/56` })

        const dentro = await cuerpo(resolver(client, token, `${raiz}30:1234::1`))
        assert.deepEqual(dentro, {
            servicio_id: b.servicioId,
            cliente_id: b.clienteId,
            prefijo: `${raiz}30:1200::/56`,
        })
        const fuera = await cuerpo(resolver(client, token, `${raiz}30:ff00::1`))
        assert.equal(fuera.servicio_id, a.servicioId)
        assert.equal(fuera.prefijo, `${raiz}30::/48`)
    })

    test('misma IPv4: la sesión activa gana a la asignación; una sesión terminada no cuenta', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const fija = await servicioSuelto()
        const conectado = await servicioSuelto()
        const ip = ipUnica().replace(/^10\./, '198.')
        const { routerId } = await crearEscenarioRouter()
        const [red] = (await db
            .table('network.redes_ipv4')
            .insert({
                router_id: routerId,
                cidr: `${ip.split('.').slice(0, 3).join('.')}.0/24`,
                tipo: 'estatico',
            })
            .returning('id')) as Array<{ id: number }>
        await db
            .table('network.ipv4_asignaciones')
            .insert({ servicio_id: fija.servicioId, red_id: red!.id, ip })

        const antes = await cuerpo(resolver(client, token, ip))
        assert.equal(antes.servicio_id, fija.servicioId)

        await sesion({ servicio_id: conectado.servicioId, ipv4: ip, fin: new Date() })
        const conTerminada = await cuerpo(resolver(client, token, ip))
        assert.equal(conTerminada.servicio_id, fija.servicioId)

        await sesion({ servicio_id: conectado.servicioId, ipv4: ip })
        assert.deepEqual(await cuerpo(resolver(client, token, ip)), {
            servicio_id: conectado.servicioId,
            cliente_id: conectado.clienteId,
            prefijo: `${ip}/32`,
        })
    })

    test('IP inválida 422, sin dueño 404, cajero sin ip.resolver 403', async ({ client }) => {
        const { token } = await usuarioConRoles(['soporte'])
        await estado(resolver(client, token, 'no-es-ip'), 422)
        await estado(resolver(client, token, '203.0.113.250'), 404)
        await estado(resolver(client, token, '2001:db8:ffff:ffff::1'), 404)
        const cajero = await usuarioConRoles(['cajero'])
        await estado(resolver(client, cajero.token, '203.0.113.250'), 403)
    })
})
