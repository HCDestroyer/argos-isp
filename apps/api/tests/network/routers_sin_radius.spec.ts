import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { randomBytes } from 'node:crypto'
import { cifrar, descifrar } from '#shared/cifrado'
import {
    crearClienteFila,
    crearEscenarioRouter,
    crearRouterFila,
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

const entornoOriginal = { ...process.env }

/** Entorno del túnel y del servicio para generar el script (como en `conexion_routers.spec.ts`). */
const ENTORNO_SCRIPT: Record<string, string> = {
    ARGOSISP_WIREGUARD: '1',
    ARGOSISP_WG_ENDPOINT: 'vpn.argosisp.example',
    ARGOSISP_WG_RED: '10.255.0.0/16',
    ARGOSISP_WG_PUERTO: '51820',
    API_PUBLIC_URL: 'https://argos.example',
    ROUTERS_REGISTRO_LIMITE: '0',
    ROUTERS_SERVICIO_WAN_INTERFAZ: 'ether1',
    ROUTERS_SERVICIO_PPP_LOCAL_V4: '10.10.0.1',
    ROUTERS_SERVICIO_POOL_V4_RANGOS: '10.10.0.10-10.10.0.250',
    ROUTERS_SERVICIO_CLIENTES_V4: '10.10.0.0/16',
    ROUTERS_SERVICIO_POOL_V6_ENLACE_PREFIJO: '2001:db8:100::/48',
    ROUTERS_SERVICIO_POOL_V6_PD_PREFIJO: '2001:db8:200::/40',
    ROUTERS_SERVICIO_PORTAL_V4: '192.0.2.20',
    ROUTERS_SERVICIO_PORTAL_V6: '2001:db8:ffff::20',
    ROUTERS_SERVICIO_PORTAL_FQDN: 'portal.argosisp.example',
    ROUTERS_SERVICIO_DNS_V4: '192.0.2.53',
}

function generarScript(client: any, token: string, routerId: number, qs: Record<string, string> = {}) {
    return estado(client.get(`/api/v1/routers/${routerId}/script-conexion`).qs(qs).bearerToken(token), 200)
}

async function textoScript(client: any, token: string, routerId: number): Promise<string> {
    const r = await generarScript(client, token, routerId)
    return r.text()
}

/** Lo propio del script sin RADIUS: sin `/radius add` ni su secreto; `use-radius=no` y `sensitive`. */
function assertSinRadius(assert: any, script: string, secreto?: string) {
    assert.notMatch(script, /\{\{/)
    assert.notInclude(script, '{{radius_secret}}')
    assert.notMatch(script, /^\s*\/radius add/m)
    assert.notMatch(script, /^\s*\/radius\s*\n\s*add/m)
    assert.notMatch(script, /use-radius=yes/)
    assert.notMatch(script, /:local radiusSecret/)
    assert.match(script, /^\/ppp aaa set use-radius=no/m)
    assert.match(script, /name="argosisp-api"\] policy=[a-z,-]*sensitive/)
    if (secreto) assert.notInclude(script, secreto)
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

test.group('Routers sin RADIUS · script de conexión', (group) => {
    group.each.setup(async () => {
        Object.assign(process.env, ENTORNO_SCRIPT)
        await db.rawQuery(
            `INSERT INTO network.wireguard_servidor (id, public_key) VALUES (1, ?)
             ON CONFLICT (id) DO UPDATE SET public_key = EXCLUDED.public_key`,
            [randomBytes(32).toString('base64')],
        )
        return () => {
            for (const nombre of Object.keys(process.env)) {
                if (!(nombre in entornoOriginal)) delete process.env[nombre]
            }
            Object.assign(process.env, entornoOriginal)
        }
    })

    test('router api: plantilla sin RADIUS, sin exigir radius_secret; con servicio también', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const creado = await estado(
            crearRouter(client, token, { modo_seguridad: 'api', interfaz_clientes: 'ether2' }),
            201,
        )
        const routerId = creado.body().id as number

        const script = await generarScript(client, token, routerId)
        assertSinRadius(assert, script.text())
        assert.notMatch(script.text(), /pppoe-server/)
        assert.include(script.header('content-disposition'), `argosisp-router-${routerId}.rsc`)
        // el registro y la clave de la API son los de siempre
        const fila = await db.from('network.routers_conexion').where('router_id', routerId).firstOrFail()
        assert.match(script.text(), new RegExp(`:local wgIp "${fila.ip_tunel.replace(/\./g, '\\.')}"`))
        assert.lengthOf(descifrar(fila.api_password_pendiente), 32)
        const acciones = await db
            .from('audit.acciones')
            .where({ accion: 'routers.generar_script', entidad_tipo: 'router', entidad_id: routerId })
        assert.lengthOf(acciones, 1)

        const conServicio = await generarScript(client, token, routerId, { incluir: 'servicio' })
        assertSinRadius(assert, conServicio.text())
        assert.match(conServicio.text(), /pppoe-server/)
    })

    test('rotar la conexión de un router api: script sin RADIUS', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const routerId = await crearRouterFila({ modo_seguridad: 'api', nas_ip: null, radius_secret: null })
        await generarScript(client, token, routerId)
        const r = await estado(
            client.post(`/api/v1/routers/${routerId}/conexion/rotar`).bearerToken(token),
            200,
        )
        assertSinRadius(assert, r.text())
        const acciones = await db
            .from('audit.acciones')
            .where({ accion: 'routers.rotar_conexion', entidad_tipo: 'router', entidad_id: routerId })
        assert.lengthOf(acciones, 1)
    })

    test('router api con un radius_secret guardado: no lo exige ni lo pone en el script', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        // inválido para RADIUS (corto): en modo api no importa
        const corto = await crearRouterFila({ modo_seguridad: 'api', radius_secret: cifrar('corto') })
        assertSinRadius(assert, await textoScript(client, token, corto), 'corto')
        const largo = await crearRouterFila({
            modo_seguridad: 'api',
            radius_secret: cifrar('secreto-guardado-de-antes'),
        })
        assertSinRadius(assert, await textoScript(client, token, largo), 'secreto-guardado-de-antes')
    })

    test('router radius: sigue con la plantilla RADIUS y exige su secreto (422 radius_secret_requerido)', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const sinSecreto = await crearRouterFila({ radius_secret: null })
        const r = await estado(
            client.get(`/api/v1/routers/${sinSecreto}/script-conexion`).bearerToken(token),
            422,
        )
        assert.equal(codigo(r), 'radius_secret_requerido')

        const conSecreto = await crearRouterFila({ radius_secret: cifrar('secreto-del-nas-1234') })
        const script = await textoScript(client, token, conSecreto)
        assert.match(script, /:local radiusSecret "secreto-del-nas-1234"/)
        assert.notMatch(script, /use-radius=no/)
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
