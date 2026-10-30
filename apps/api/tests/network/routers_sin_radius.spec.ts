import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { cifrar } from '#shared/cifrado'
import {
    crearClienteFila,
    crearEscenarioRouter,
    crearPlanFila,
    crearServicioFila,
    ipUnica,
} from '#tests/core/fabricas'

/**
 * Router sin RADIUS (bug del PM, Argos 1.4.0; `app/network/README.md`, «Modo de seguridad»): un
 * router `api` no exige `nas_ip` ni `radius_secret` y no es cliente de FreeRADIUS. PPPoE se admite
 * con secrets locales (`contratos/pppoe-local.md`, 30 oct) si el router tiene credenciales de la API.
 */

const MENSAJE_PPPOE =
    'Este router no usa RADIUS: los clientes PPPoE se crean como secrets por su API REST, y el router no ' +
    'tiene usuario y contraseña de la API. Complétalos en el router o usa uno con RADIUS'

/** Credenciales de la API (cifradas como las guarda la API; no se usan para conectar en estas pruebas). */
async function conCredenciales(routerId: number) {
    await db
        .from('network.routers')
        .where('id', routerId)
        .update({ api_usuario: 'argosisp-api', api_password: cifrar('clave-api') })
}

function crearRouter(client: any, token: string, cuerpo: Record<string, unknown>, requestId = unico('req')) {
    return client
        .post('/api/v1/routers')
        .bearerToken(token)
        .header('X-Request-Id', requestId)
        .json({ nombre: unico('MK'), host: `mk-${unico('h')}.lab`, ...cuerpo })
}

function editarRouter(client: any, token: string, id: number, cuerpo: Record<string, unknown>) {
    return client.put(`/api/v1/routers/${id}`).bearerToken(token).json(cuerpo)
}

function crearServicio(client: any, token: string, cuerpo: Record<string, unknown>) {
    return client
        .post('/api/v1/servicios')
        .bearerToken(token)
        .json({ plantilla_facturacion_id: null, ...cuerpo })
}

async function eventosRadius(routerId: number) {
    const filas = await db
        .from('audit.outbox')
        .where('evento', 'router.radius_cambiado')
        .whereRaw("(payload->>'router_id')::bigint = ?", [routerId])
        .orderBy('id')
    return filas.map((f) => f.payload.campos as string[])
}

/** Router con red IPv4 y pools IPv6 pasado a `api` (sin nas_ip), más un plan y un cliente. */
async function escenarioApi() {
    const esc = await crearEscenarioRouter()
    await db
        .from('network.routers')
        .where('id', esc.routerId)
        .update({ modo_seguridad: 'api', nas_ip: null, radius_secret: null })
    const planId = await crearPlanFila()
    const clienteId = await crearClienteFila({ nombre: 'Ana Sin Radius' })
    return { ...esc, planId, clienteId }
}

function codigo(respuesta: any): string {
    return String(respuesta.body().type).replace('urn:argosisp:problema:', '')
}

test.group('Routers sin RADIUS · alta y edición', () => {
    test('alta en modo api sin nas_ip ni radius_secret; dos routers sin nas_ip no chocan; sin evento RADIUS', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const uno = await estado(crearRouter(client, token, { modo_seguridad: 'api' }), 201)
        assert.containsSubset(uno.body(), {
            modo_seguridad: 'api',
            nas_ip: null,
            tiene_radius_secret: false,
        })
        // null explícito también vale, y no choca con el otro router sin nas_ip (UNIQUE con NULL)
        const dos = await estado(
            crearRouter(client, token, { modo_seguridad: 'api', nas_ip: null, radius_secret: null }),
            201,
        )
        assert.isNull(dos.body().nas_ip)
        assert.deepEqual(await eventosRadius(uno.body().id), [])

        // un router api puede traer nas_ip (no se usa para RADIUS)
        const conIp = await estado(
            crearRouter(client, token, { modo_seguridad: 'api', nas_ip: ipUnica() }),
            201,
        )
        assert.isString(conIp.body().nas_ip)

        // y no aparece en duplicados por compartir la falta de nas_ip
        const grupos = await estado(
            client.get('/api/v1/routers/duplicados').qs({ router_id: uno.body().id }).bearerToken(token),
            200,
        )
        assert.deepEqual(grupos.body(), [])
    })

    test('modo radius (o sin modo) sin nas_ip: 422 en nas_ip con mensaje claro; la base también lo exige', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        for (const cuerpo of [{}, { modo_seguridad: 'radius' }, { modo_seguridad: 'radius', nas_ip: null }]) {
            const r = await estado(crearRouter(client, token, cuerpo), 422)
            assert.deepEqual(
                r.body().errors.map((e: { field: string }) => e.field),
                ['nas_ip'],
            )
            assert.include(r.body().errors[0].message, 'elige el modo «api»')
        }
        await assert.rejects(() =>
            db.table('network.routers').insert({
                nombre: unico('MK Check'),
                host: '192.0.2.9',
                modo_seguridad: 'radius',
                nas_ip: null,
            }),
        )
    })

    test('edición: quitar nas_ip solo en api; volver a radius exige nas_ip; el cambio de modo avisa a FreeRADIUS', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const nasIp = ipUnica()
        const creado = await estado(
            crearRouter(client, token, { nas_ip: nasIp, radius_secret: 'secreto-radius-largo' }),
            201,
        )
        const id = creado.body().id

        // radius sin nas_ip: 422
        let r = await estado(editarRouter(client, token, id, { version: 1, nas_ip: null }), 422)
        assert.equal(r.body().errors[0].field, 'nas_ip')

        // a api, quitando nas_ip y el secreto
        r = await estado(
            editarRouter(client, token, id, {
                version: 1,
                modo_seguridad: 'api',
                nas_ip: null,
                quitar_radius_secret: true,
            }),
            200,
        )
        assert.containsSubset(r.body(), { modo_seguridad: 'api', nas_ip: null, tiene_radius_secret: false })

        // otros campos de un router api se editan sin nas_ip
        r = await estado(editarRouter(client, token, id, { version: 2, nombre: unico('MK Api') }), 200)

        // volver a radius sin nas_ip: 422; con nas_ip: 200
        r = await estado(editarRouter(client, token, id, { version: 3, modo_seguridad: 'radius' }), 422)
        assert.equal(r.body().errors[0].field, 'nas_ip')
        r = await estado(
            editarRouter(client, token, id, { version: 3, modo_seguridad: 'radius', nas_ip: nasIp }),
            200,
        )
        assert.equal(r.body().nas_ip, nasIp)

        const campos = await eventosRadius(id)
        assert.deepEqual(campos, [
            ['nas_ip', 'radius_secret'],
            ['nas_ip', 'radius_secret', 'modo_seguridad'],
            ['nas_ip', 'modo_seguridad'],
        ])

        const diff = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'router', entidad_id: id, campo: 'modo_seguridad' })
            .orderBy('id')
        assert.deepEqual(
            diff.map((d) => [d.antes, d.despues]),
            [
                [null, 'radius'],
                ['radius', 'api'],
                ['api', 'radius'],
            ],
        )
    })

    test('pasar a api con servicios pppoe no retirados: 422 servicios_pppoe_en_router con la lista', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { routerId: id } = await crearEscenarioRouter()
        const clienteId = await crearClienteFila()
        const planId = await crearPlanFila()
        const pppoe = await crearServicioFila({ cliente_id: clienteId, router_id: id, plan_id: planId })
        await crearServicioFila({ cliente_id: clienteId, router_id: id, plan_id: planId, estado: 'retirado' })
        await estado(
            crearServicio(client, token, {
                cliente_id: clienteId,
                router_id: id,
                plan_id: planId,
                tipo_conexion: 'ip_estatica',
            }),
            201,
        )

        const r = await estado(editarRouter(client, token, id, { version: 1, modo_seguridad: 'api' }), 422)
        assert.equal(codigo(r), 'servicios_pppoe_en_router')
        assert.include(r.body().detail, '1 servicio PPPoE')
        assert.deepEqual(
            r.body().errors.map((e: { field: string }) => e.field),
            [`servicios.${pppoe}`],
        )
        const fila = await db.from('network.routers').where('id', id).firstOrFail()
        assert.equal(fila.modo_seguridad, 'radius')
        assert.equal(fila.version, 1)

        // sin PPPoE vivos (el retirado y el ip_estatica no cuentan) se puede
        await db.from('core.servicios').where('id', pppoe).update({ estado: 'retirado' })
        await estado(editarRouter(client, token, id, { version: 1, modo_seguridad: 'api' }), 200)
    })

    test('script de conexión de un router api: 422 script_requiere_radius', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const creado = await estado(crearRouter(client, token, { modo_seguridad: 'api' }), 201)
        const r = await estado(
            client.get(`/api/v1/routers/${creado.body().id}/script-conexion`).bearerToken(token),
            422,
        )
        assert.equal(codigo(r), 'script_requiere_radius')
    })

    test('un router api sin nas_ip se puede eliminar y no es cliente de FreeRADIUS', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const api = await estado(crearRouter(client, token, { modo_seguridad: 'api' }), 201)
        const radius = await estado(
            crearRouter(client, token, { nas_ip: ipUnica(), radius_secret: 'secreto-radius-largo' }),
            201,
        )

        // la misma condición con que `services/aaa` arma los clients de FreeRADIUS (`leerRouters`)
        const clientes = (await db
            .from('network.routers')
            .where('activo', true)
            .where('modo_seguridad', 'radius')
            .select('id')) as Array<{ id: number }>
        const ids = clientes.map((f) => Number(f.id))
        assert.include(ids, radius.body().id)
        assert.notInclude(ids, api.body().id)

        const previa = await estado(
            client.get(`/api/v1/routers/${api.body().id}/eliminable`).bearerToken(token),
            200,
        )
        assert.deepEqual(previa.body(), { eliminable: true, motivos: [] })
        await estado(
            client.delete(`/api/v1/routers/${api.body().id}`).qs({ version: 1 }).bearerToken(token),
            204,
        )
    })
})

test.group('Routers sin RADIUS · servicios', () => {
    test('crear pppoe en un router api: sin credenciales de la API 422 pppoe_local_requiere_api; con ellas, secret local', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { routerId, planId, clienteId } = await escenarioApi()
        const base = { cliente_id: clienteId, router_id: routerId, plan_id: planId }

        // pppoe explícito o por defecto
        for (const cuerpo of [{ ...base, tipo_conexion: 'pppoe' }, base]) {
            const r = await estado(crearServicio(client, token, cuerpo), 422)
            assert.equal(codigo(r), 'pppoe_local_requiere_api')
            assert.equal(r.body().detail, MENSAJE_PPPOE)
            assert.equal(r.body().errors[0].field, 'router_id')
        }
        assert.isNull(await db.from('core.servicios').where('router_id', routerId).first())
        await conCredenciales(routerId)
        const pppoe = await estado(crearServicio(client, token, base), 201)
        assert.equal(pppoe.body().tipo_conexion, 'pppoe')

        const estatica = await estado(
            crearServicio(client, token, { ...base, tipo_conexion: 'ip_estatica' }),
            201,
        )
        assert.equal(estatica.body().tipo_conexion, 'ip_estatica')
        await estado(
            crearServicio(client, token, { ...base, tipo_conexion: 'dhcp_fija', mac: 'AA:BB:CC:00:11:33' }),
            201,
        )
    })

    test('mover un pppoe a un router api o pasar a pppoe en él: 422 sin credenciales de la API, 200 con ellas', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const api = await escenarioApi()
        const radius = await crearEscenarioRouter()

        const pppoe = await estado(
            crearServicio(client, token, {
                cliente_id: api.clienteId,
                router_id: radius.routerId,
                plan_id: api.planId,
            }),
            201,
        )
        let r = await estado(
            client
                .put(`/api/v1/servicios/${pppoe.body().id}`)
                .bearerToken(token)
                .json({ version: pppoe.body().version, router_id: api.routerId }),
            422,
        )
        assert.equal(codigo(r), 'pppoe_local_requiere_api')

        // moverlo cambiando a ip_estatica en la misma edición sí se puede
        r = await estado(
            client.put(`/api/v1/servicios/${pppoe.body().id}`).bearerToken(token).json({
                version: pppoe.body().version,
                router_id: api.routerId,
                tipo_conexion: 'ip_estatica',
            }),
            200,
        )
        assert.containsSubset(r.body(), { router_id: api.routerId, tipo_conexion: 'ip_estatica' })

        // y de vuelta a pppoe en el router api: 422 sin credenciales, 200 con ellas (secret local)
        const r2 = await estado(
            client
                .put(`/api/v1/servicios/${pppoe.body().id}`)
                .bearerToken(token)
                .json({ version: r.body().version, tipo_conexion: 'pppoe' }),
            422,
        )
        assert.equal(codigo(r2), 'pppoe_local_requiere_api')
        await conCredenciales(api.routerId)
        const r3 = await estado(
            client
                .put(`/api/v1/servicios/${pppoe.body().id}`)
                .bearerToken(token)
                .json({ version: r.body().version, tipo_conexion: 'pppoe' }),
            200,
        )
        assert.containsSubset(r3.body(), { router_id: api.routerId, tipo_conexion: 'pppoe' })
    })
})
