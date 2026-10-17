import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import { estado, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearRouterFila, crearServicioFila, ipUnica } from '#tests/core/fabricas'
import { limpiarCredenciales } from '#network/sesiones/eventos_red'

/**
 * Semana 3 · tarea 1 de A2: `GET /red/eventos`, lectura paginada de `audit.red` para la pantalla
 * "Migración de router" de A4. Las filas se insertan como lo hacen `coa` y el cliente de RouterOS.
 */

interface Fila {
    tipo: 'coa' | 'disconnect' | 'routeros'
    router_id: number | null
    servicio_id: number | null
    ok: boolean
    comando?: Record<string, unknown>
    respuesta?: Record<string, unknown> | null
    created_at?: Date
}

async function insertar(f: Fila): Promise<number> {
    const [fila] = (await db
        .table('audit.red')
        .insert({
            tipo: f.tipo,
            router_id: f.router_id,
            servicio_id: f.servicio_id,
            comando: JSON.stringify(f.comando ?? { intento: 1 }),
            respuesta: f.respuesta === null ? null : JSON.stringify(f.respuesta ?? { resultado: 'ack' }),
            ok: f.ok,
            ...(f.created_at ? { created_at: f.created_at } : {}),
        })
        .returning('id')) as Array<{ id: number | string }>
    return Number(fila!.id)
}

async function escenario() {
    const routerId = await crearRouterFila({ nas_ip: ipUnica() })
    const servicioId = await crearServicioFila({
        cliente_id: await crearClienteFila(),
        router_id: routerId,
        ipv6_modo: 'ninguno',
    })
    return { routerId, servicioId }
}

type Pagina = { data: Array<Record<string, unknown> & { id: number }>; nextCursor: string | null }

async function leer(client: ApiClient, token: string, qs: Record<string, unknown>): Promise<Pagina> {
    const r = await estado(client.get('/api/v1/red/eventos').qs(qs).bearerToken(token), 200)
    return r.body() as Pagina
}

test.group('network · GET /red/eventos (audit.red)', () => {
    test('filtra por router, servicio, tipo, resultado y fechas, con el contrato EventoRed', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const e = await escenario()
        const otro = await escenario()
        const ayer = new Date(Date.now() - 86_400_000)

        const coaOk = await insertar({
            tipo: 'coa',
            router_id: e.routerId,
            servicio_id: e.servicioId,
            ok: true,
            comando: { evento: 'servicio.estado_cambiado', sesion_id: 1, atributos: { 'User-Name': 'x' } },
            respuesta: { resultado: 'ack', codigo: 44, rtt_ms: 3, final: true },
        })
        const discNak = await insertar({
            tipo: 'disconnect',
            router_id: e.routerId,
            servicio_id: e.servicioId,
            ok: false,
            respuesta: { resultado: 'nak', error: 'Session-Context-Not-Found', final: true },
        })
        const rosViejo = await insertar({
            tipo: 'routeros',
            router_id: e.routerId,
            servicio_id: null,
            ok: false,
            comando: { operacion: 'reconciliar', final: true },
            respuesta: { error: 'sin respuesta', tipo_error: 'inalcanzable', final: true },
            created_at: ayer,
        })
        const deOtro = await insertar({
            tipo: 'coa',
            router_id: otro.routerId,
            servicio_id: otro.servicioId,
            ok: true,
        })

        const todos = await leer(client, token, { router_id: e.routerId })
        assert.deepEqual(
            todos.data.map((x) => x.id),
            // orden de inserción (id), no `created_at`: la fila "vieja" se insertó al final
            [rosViejo, discNak, coaOk],
        )
        assert.isNull(todos.nextCursor)
        const primero = todos.data.find((x) => x.id === coaOk)!
        assert.deepEqual(Object.keys(primero).sort(), [
            'comando',
            'created_at',
            'id',
            'ok',
            'respuesta',
            'router_id',
            'router_nombre',
            'servicio_id',
            'tipo',
        ])
        assert.include(primero, { tipo: 'coa', router_id: e.routerId, servicio_id: e.servicioId, ok: true })
        assert.isString(primero.router_nombre)
        assert.isString(primero.created_at)
        assert.deepEqual(primero.respuesta, { resultado: 'ack', codigo: 44, rtt_ms: 3, final: true })

        const ids = async (qs: Record<string, unknown>) => {
            const p = await leer(client, token, { router_id: e.routerId, ...qs })
            return p.data.map((x) => x.id)
        }

        assert.deepEqual(await ids({ resultado: 'error' }), [rosViejo, discNak])
        assert.deepEqual(await ids({ resultado: 'ok' }), [coaOk])
        assert.deepEqual(await ids({ tipo: 'disconnect' }), [discNak])
        assert.deepEqual(await ids({ tipo: 'routeros', resultado: 'error' }), [rosViejo])
        assert.deepEqual(await ids({ servicio_id: e.servicioId }), [discNak, coaOk])
        const haceUnaHora = new Date(Date.now() - 3_600_000).toISOString()
        assert.deepEqual(await ids({ desde: haceUnaHora }), [discNak, coaOk])
        assert.deepEqual(await ids({ hasta: haceUnaHora }), [rosViejo])
        // `desde` inclusive
        assert.deepEqual(await ids({ desde: ayer.toISOString(), tipo: 'routeros' }), [rosViejo])
        assert.notInclude(await ids({}), deOtro)

        await estado(client.get('/api/v1/red/eventos').qs({ tipo: 'otro' }).bearerToken(token), 422)
        await estado(client.get('/api/v1/red/eventos').qs({ resultado: 'nak' }).bearerToken(token), 422)
        await estado(client.get('/api/v1/red/eventos').qs({ desde: 'ayer' }).bearerToken(token), 422)
    })

    test('pagina por cursor', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const e = await escenario()
        const creados: number[] = []
        for (let i = 0; i < 3; i++) {
            creados.push(
                await insertar({ tipo: 'coa', router_id: e.routerId, servicio_id: e.servicioId, ok: true }),
            )
        }
        const p1 = await leer(client, token, { router_id: e.routerId, limit: 2 })
        assert.deepEqual(
            p1.data.map((x) => x.id),
            [creados[2], creados[1]],
        )
        assert.isString(p1.nextCursor)
        const p2 = await leer(client, token, { router_id: e.routerId, limit: 2, cursor: p1.nextCursor })
        assert.deepEqual(
            p2.data.map((x) => x.id),
            [creados[0]],
        )
        assert.isNull(p2.nextCursor)
    })

    test('las credenciales nunca salen en la respuesta', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const e = await escenario()
        const id = await insertar({
            tipo: 'routeros',
            router_id: e.routerId,
            servicio_id: e.servicioId,
            ok: true,
            comando: {
                metodo: 'PUT',
                ruta: '/ppp/secret',
                propiedades: {
                    name: 'cliente1',
                    password: 'clave-ppp',
                    'private-key': 'wg-privada',
                    comment: 'argosisp:servicio:1',
                },
                radius: [{ secret: 'radius-secreto', address: '10.0.0.1' }],
                atributos: { 'User-Name': 'cliente1', 'User-Password': 'otra', 'CHAP-Password': 'chap' },
                api_password: 'v1:cifrada',
                Authorization: 'Basic dXNlcjpwYXNz',
            },
            respuesta: { status: 200, objeto: { '.id': '*1', password: 'clave-ppp', name: 'cliente1' } },
        })
        const r = await estado(
            client.get('/api/v1/red/eventos').qs({ servicio_id: e.servicioId }).bearerToken(token),
            200,
        )
        const fila = (r.body() as Pagina).data.find((x) => x.id === id)!
        const texto = JSON.stringify(fila)
        for (const secreto of [
            'clave-ppp',
            'wg-privada',
            'radius-secreto',
            'otra',
            'chap',
            'v1:cifrada',
            'dXNlcjpwYXNz',
        ]) {
            assert.notInclude(texto, secreto)
        }
        const comando = fila.comando as Record<string, any>
        assert.equal(comando.propiedades.password, '***')
        assert.equal(comando.propiedades['private-key'], '***')
        assert.equal(comando.propiedades.name, 'cliente1')
        assert.equal(comando.propiedades.comment, 'argosisp:servicio:1')
        assert.equal(comando.radius[0].secret, '***')
        assert.equal(comando.radius[0].address, '10.0.0.1')
        assert.equal(comando.atributos['User-Name'], 'cliente1')
        assert.equal(comando.atributos['User-Password'], '***')
        assert.equal((fila.respuesta as Record<string, any>).objeto.password, '***')
        assert.equal((fila.respuesta as Record<string, any>).objeto['.id'], '*1')

        // `clave` (identificador de objeto en el cambio de modo) y `Message-Authenticator` no se tapan
        assert.deepEqual(
            limpiarCredenciales({ clave: 'cola:1', 'Message-Authenticator': 'x', token: null }),
            {
                clave: 'cola:1',
                'Message-Authenticator': 'x',
                token: null,
            },
        )
    })

    test('respeta permiso y alcance por router', async ({ client, assert }) => {
        const { token: sinPermiso } = await usuarioConRoles(['cajero'])
        await estado(client.get('/api/v1/red/eventos').bearerToken(sinPermiso), 403)
        const { token: contabilidad } = await usuarioConRoles(['contabilidad'])
        await estado(client.get('/api/v1/red/eventos').bearerToken(contabilidad), 403)

        const a = await escenario()
        const b = await escenario()
        const desde = new Date(Date.now() - 1000).toISOString()
        const ea = await insertar({
            tipo: 'coa',
            router_id: a.routerId,
            servicio_id: a.servicioId,
            ok: false,
        })
        const eb = await insertar({
            tipo: 'coa',
            router_id: b.routerId,
            servicio_id: b.servicioId,
            ok: false,
        })
        const sinRouter = await insertar({
            tipo: 'disconnect',
            router_id: null,
            servicio_id: null,
            ok: false,
        })

        const { usuario, token } = await usuarioConRoles([])
        const rol = (await db.from('core.roles').where('nombre', 'tecnico').select('id').first()) as {
            id: number
        }
        await db.table('core.usuarios_roles').insert({
            usuario_id: usuario.id,
            role_id: rol.id,
            alcance_tipo: 'router',
            alcance_id: a.routerId,
        })
        const r = await estado(
            client
                .get('/api/v1/red/eventos')
                .qs({ resultado: 'error', desde, limit: 200 })
                .bearerToken(token),
            200,
        )
        const ids = (r.body() as Pagina).data.map((x) => x.id)
        assert.include(ids, ea)
        assert.notInclude(ids, eb)
        assert.notInclude(ids, sinRouter)

        const { token: libre } = await usuarioConRoles(['lectura'])
        const todo = await estado(
            client
                .get('/api/v1/red/eventos')
                .qs({ resultado: 'error', desde, limit: 200 })
                .bearerToken(libre),
            200,
        )
        assert.includeMembers(
            (todo.body() as Pagina).data.map((x) => x.id),
            [ea, eb, sinRouter],
        )
    })
})
