import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearServicioFila } from '#tests/core/fabricas'

/**
 * Contrato Iris 0.8.1: `buscar_red=false` en `GET /clientes` y `GET /servicios` hace que `q` no
 * coincida por datos de red (IPv4, prefijo IPv6, user_ppp; la MAC y el router nunca se buscaron).
 * Sin el parámetro, la búsqueda es la de siempre. Un valor no booleano es 422 en `buscar_red`.
 */

let contadorNit = 0

async function escenario() {
    const marca = unico('BuscarRed').replace(/-/g, '')
    contadorNit += 1
    // NIT de 9 dígitos único por corrida (solo se compara exacto)
    const nit = `9${String(Date.now()).slice(-6)}${String(contadorNit).padStart(2, '0')}`
    const clienteId = await crearClienteFila({ nombre: `Lucía ${marca}`, nit_cui: nit })
    const { routerId, raiz } = await crearEscenarioRouter()
    const router = await db.from('network.routers').where('id', routerId).firstOrFail()
    const userPpp = unico('lucia.ppp')
    const mac = `02:00:${String(contadorNit % 100).padStart(2, '0')}:${String(Date.now() % 100).padStart(2, '0')}:aa:bb`
    const servicioId = await crearServicioFila({
        cliente_id: clienteId,
        router_id: routerId,
        user_ppp: userPpp,
        mac,
    })
    const red = await db.from('network.redes_ipv4').where('router_id', routerId).firstOrFail()
    const ipv4 = `${String(red.cidr).replace('.0/24', '')}.20`
    await db.table('network.ipv4_asignaciones').insert({ servicio_id: servicioId, red_id: red.id, ip: ipv4 })
    await db.table('network.ipv6_asignaciones').insert({
        servicio_id: servicioId,
        prefijo: `${raiz}10::/56`,
        tipo: 'delegacion',
    })
    return {
        marca,
        nit,
        clienteId,
        servicioId,
        userPpp,
        mac,
        ipv4,
        ipv6: `${raiz}10::1`,
        router: router.nombre as string,
    }
}

async function ids(
    client: any,
    token: string,
    recurso: 'clientes' | 'servicios',
    qs: Record<string, unknown>,
) {
    const r = await estado(
        client
            .get(`/api/v1/${recurso}`)
            .qs({ limit: 200, ...qs })
            .bearerToken(token),
        200,
    )
    return (r.body().data as Array<{ id: number }>).map((f) => f.id)
}

test.group('Iris 0.8.1 · buscar_red', () => {
    test('GET /clientes: con false no coincide por IP, user_ppp ni MAC; sí por nombre y documento', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const e = await escenario()
        const parcial = e.userPpp.slice(0, -3)

        // por defecto (y con true): la búsqueda de siempre, red incluida
        for (const extra of [{}, { buscar_red: true }, { buscar_red: 1 }]) {
            for (const q of [e.ipv4, e.ipv6, parcial, e.marca, e.nit]) {
                assert.include(await ids(client, token, 'clientes', { q, ...extra }), e.clienteId, `${q}`)
            }
        }

        for (const falso of [false, 0]) {
            for (const q of [e.ipv4, e.ipv6, parcial, e.userPpp, e.mac, e.router]) {
                assert.notInclude(
                    await ids(client, token, 'clientes', { q, buscar_red: falso }),
                    e.clienteId,
                    q,
                )
            }
            assert.include(
                await ids(client, token, 'clientes', { q: e.marca, buscar_red: falso }),
                e.clienteId,
            )
            assert.include(await ids(client, token, 'clientes', { q: e.nit, buscar_red: falso }), e.clienteId)
        }
    })

    test('GET /servicios: con false no coincide por IP, user_ppp ni MAC; sí por nombre del cliente', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const e = await escenario()
        const parcial = e.userPpp.slice(0, -3)

        for (const extra of [{}, { buscar_red: true }]) {
            for (const q of [e.ipv4, e.ipv6, parcial, e.marca]) {
                assert.include(await ids(client, token, 'servicios', { q, ...extra }), e.servicioId, `${q}`)
            }
        }

        for (const q of [e.ipv4, e.ipv6, parcial, e.userPpp, e.mac, e.router]) {
            assert.notInclude(
                await ids(client, token, 'servicios', { q, buscar_red: false }),
                e.servicioId,
                q,
            )
        }
        assert.include(await ids(client, token, 'servicios', { q: e.marca, buscar_red: false }), e.servicioId)
        assert.include(
            await ids(client, token, 'servicios', { q: e.marca.toLowerCase(), buscar_red: 0 }),
            e.servicioId,
        )
    })

    test('un valor no booleano responde 422 en buscar_red', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        for (const recurso of ['clientes', 'servicios']) {
            const r = await estado(
                client.get(`/api/v1/${recurso}`).qs({ q: 'x', buscar_red: 'talvez' }).bearerToken(token),
                422,
            )
            const campos = (r.body().errors as Array<{ field: string }>).map((f) => f.field)
            assert.include(campos, 'buscar_red', recurso)
        }
    })
})
