import { randomBytes } from 'node:crypto'
import { test } from '@japa/runner'
import { Queue } from 'bullmq'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { claveDesdeTexto, cifrar, descifrar } from '#shared/cifrado'
import { RouterOSFalso } from '#network/routeros/falso'
import { clienteDeRouter } from '#network/routeros/router'
import { bitacoraRed, type FabricaClientes } from '#network/routeros/dispatcher'
import { contactoRouterOS } from '#network/sesiones/contacto'
import ProbarConexion, { explicarError } from '#network/conexion/actions/probar_conexion'
import { RouterOSCredenciales, RouterOSInalcanzable } from '#network/routeros/errores'
import {
    NOMBRE_COLA_ROUTEROS,
    cerrarColaCambios,
    ejecutarReconciliacionManual,
    idJobReconciliar,
} from '#network/routeros/jobs'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearRouterFila, crearZonaFila, ipUnica } from '#tests/core/fabricas'

const SECRETO = 'secreto-del-nas-123'
const entornoOriginal = { ...process.env }

/** Como `fabricaPorDefecto`, sin reintentos (un router caído responde rápido). */
const rapida: FabricaClientes = (router, op = {}) =>
    clienteDeRouter(router, {
        clave: claveDesdeTexto(env.get('AAA_PPP_KEY')),
        bitacora: bitacoraRed,
        contacto: op.sinContacto ? null : contactoRouterOS,
        timeoutMs: 300,
        reintentos: 0,
        esperaMs: 5,
    })

test.group('Routers · probar conexión', (group) => {
    let falso: RouterOSFalso

    group.setup(async () => {
        falso = new RouterOSFalso()
        await falso.levantar()
        return () => falso.cerrar()
    })
    group.each.setup(() => {
        process.env.ARGOSISP_WG_CLAVE_PUBLICA = randomBytes(32).toString('base64')
        process.env.ARGOSISP_WG_ENDPOINT = 'vpn.argosisp.example'
        process.env.ARGOSISP_WG_RED = '10.255.0.0/16'
        process.env.ROUTERS_REGISTRO_LIMITE = '0'
        falso.lectura('/radius').splice(0)
        return () => {
            for (const nombre of Object.keys(process.env)) {
                if (!(nombre in entornoOriginal)) delete process.env[nombre]
            }
            Object.assign(process.env, entornoOriginal)
        }
    })

    async function routerConApi(datos: Record<string, unknown> = {}) {
        return crearRouterFila({
            nas_ip: ipUnica(),
            host: '127.0.0.1',
            api_url: falso.url,
            api_tls_verificar: false,
            api_usuario: falso.usuario,
            api_password: cifrar(falso.password),
            radius_secret: cifrar(SECRETO),
            ...datos,
        })
    }

    test('todo bien: túnel, API, equipo y RADIUS con el secreto correcto; audit.red y contacto', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const admin = await usuarioConRoles(['admin'])
        const routerId = await routerConApi()

        // conexión WireGuard registrada y con handshake
        const respuestaScript = await estado(
            client.get(`/api/v1/routers/${routerId}/script-conexion`).bearerToken(admin.token),
            200,
        )
        const script = respuestaScript.text()
        const registroToken = /:local registroToken "([^"]+)"/.exec(script)![1]
        const publica = randomBytes(32).toString('base64')
        await estado(
            client
                .post('/api/v1/routers/conexion/registrar')
                .json({ token: registroToken, public_key: publica }),
            200,
        )
        await estado(
            client
                .post('/api/v1/internal/routers/conexion/handshakes')
                .bearerToken(env.get('INTERNAL_TOKEN'))
                .json({ peers: [{ public_key: publica, ultimo_handshake: new Date().toISOString() }] }),
            200,
        )
        // el registro apuntó la API al túnel: en la prueba se vuelve al RouterOS falso
        await db
            .from('network.routers')
            .where('id', routerId)
            .update({ api_url: falso.url, api_password: cifrar(falso.password), api_usuario: falso.usuario })
        falso.lectura('/radius').push({
            '.id': '*1',
            address: '10.255.0.1',
            service: 'ppp',
            secret: SECRETO,
            disabled: 'false',
        })

        const r = await estado(
            client.post(`/api/v1/routers/${routerId}/probar-conexion`).bearerToken(token),
            200,
        )
        const cuerpo = r.body()
        assert.isTrue(cuerpo.ok)
        assert.deepEqual(
            cuerpo.chequeos.map((c: { clave: string; ok: boolean }) => [c.clave, c.ok]),
            [
                ['tunel', true],
                ['api', true],
                ['equipo', true],
                ['radius', true],
            ],
        )
        const equipo = cuerpo.chequeos.find((c: { clave: string }) => c.clave === 'equipo')
        assert.deepEqual(equipo.datos, {
            version: '7.24.5 (stable)',
            modelo: 'falso',
            uptime: '1d',
            cpu_pct: 3,
        })
        const radius = cuerpo.chequeos.find((c: { clave: string }) => c.clave === 'radius')
        assert.isTrue(radius.datos.secreto_verificado)
        assert.notInclude(JSON.stringify(cuerpo), SECRETO)

        const red = await db
            .from('audit.red')
            .where('router_id', routerId)
            .whereRaw("comando->>'operacion' = 'probar_conexion'")
        assert.sameMembers(
            red.map((f) => f.comando.ruta),
            ['/system/resource', '/radius'],
        )
        assert.notInclude(JSON.stringify(red), SECRETO)
        const contacto = await db.from('network.routers_contacto').where('router_id', routerId).firstOrFail()
        assert.equal(contacto.fuente, 'sondeo')
        const vista = await estado(client.get(`/api/v1/routers/${routerId}`).bearerToken(token), 200)
        assert.isTrue(vista.body().en_linea)
        const accion = await db
            .from('audit.acciones')
            .where({ accion: 'routers.probar_conexion', entidad_id: routerId })
            .firstOrFail()
        assert.equal(accion.resultado, 'ok')
    })

    test('RADIUS hacia otra IP o con otro secreto; sin secreto legible no se verifica', async ({
        assert,
    }) => {
        const routerId = await routerConApi()
        process.env.ROUTERS_RADIUS_DIRECCIONES = '192.0.2.10'
        const probar = () =>
            new ProbarConexion({ clientes: rapida }).execute({ router_id: routerId }, contextoPrueba())
        const radius = async () => {
            const salida = await probar()
            return salida.chequeos.find((c) => c.clave === 'radius')!
        }

        falso
            .lectura('/radius')
            .push({ '.id': '*1', address: '198.51.100.1', service: 'ppp', disabled: 'false' })
        const haciaOtra = await radius()
        assert.isFalse(haciaOtra.ok)

        falso
            .lectura('/radius')
            .push({ '.id': '*2', address: '192.0.2.10', service: 'ppp,dhcp', disabled: 'false' })
        const sinSecreto = await radius()
        assert.isTrue(sinSecreto.ok)
        assert.isFalse(sinSecreto.datos!.secreto_verificado)
        assert.include(sinSecreto.detalle, 'sensitive')

        falso.lectura('/radius')[1]!.secret = 'otro-secreto-123'
        const otro = await radius()
        assert.isFalse(otro.ok)
        assert.isTrue(otro.datos!.secreto_verificado)
        assert.notInclude(JSON.stringify(otro), 'otro-secreto-123')
    })

    test('API: credenciales rechazadas, no responde y sin credenciales; nunca lanza', async ({ assert }) => {
        const probar = (id: number) =>
            new ProbarConexion({ clientes: rapida }).execute({ router_id: id }, contextoPrueba())

        const malas = await probar(await routerConApi({ api_password: cifrar('no-es-la-clave') }))
        assert.isFalse(malas.ok)
        assert.containsSubset(malas.chequeos, [
            { clave: 'api', ok: false, motivo: 'credenciales' },
            { clave: 'equipo', ok: null },
            { clave: 'radius', ok: null },
        ])
        // sin conexión WireGuard no hay chequeo de túnel
        assert.notInclude(
            malas.chequeos.map((c) => c.clave),
            'tunel',
        )

        const caido = await probar(await routerConApi({ api_url: 'http://127.0.0.1:1' }))
        assert.containsSubset(caido.chequeos, [{ clave: 'api', ok: false, motivo: 'no_responde' }])

        const sinApi = await probar(
            await routerConApi({ api_usuario: null, api_password: null, modo_seguridad: 'api' }),
        )
        assert.deepEqual(
            sinApi.chequeos.map((c) => [c.clave, c.ok, c.motivo ?? null]),
            [
                ['api', false, 'sin_credenciales'],
                ['equipo', null, null],
            ],
        )

        assert.equal(
            explicarError(new RouterOSInalcanzable('cert', 'DEPTH_ZERO_SELF_SIGNED_CERT')).motivo,
            'certificado',
        )
        assert.equal(explicarError(new RouterOSCredenciales(401)).motivo, 'credenciales')
        assert.equal(explicarError(new RouterOSInalcanzable('x', 'ECONNREFUSED')).motivo, 'no_responde')
    })

    test('permisos: probar (admin, técnico, soporte); cajero 403; router inexistente 404', async ({
        client,
    }) => {
        const routerId = await routerConApi()
        const cajero = await usuarioConRoles(['cajero'])
        const tecnico = await usuarioConRoles(['tecnico'])
        await estado(
            client.post(`/api/v1/routers/${routerId}/probar-conexion`).bearerToken(cajero.token),
            403,
        )
        await estado(
            client.post(`/api/v1/routers/${routerId}/probar-conexion`).bearerToken(tecnico.token),
            200,
        )
        await estado(client.post('/api/v1/routers/999999999/probar-conexion').bearerToken(tecnico.token), 404)
    })
})

test.group('Routers · reconciliar ahora', (group) => {
    let falso: RouterOSFalso
    let cola: Queue

    group.setup(async () => {
        falso = new RouterOSFalso()
        await falso.levantar()
        cola = new Queue(NOMBRE_COLA_ROUTEROS, {
            connection: { host: env.get('REDIS_HOST') ?? '127.0.0.1', port: env.get('REDIS_PORT') ?? 6379 },
            prefix: env.get('COLAS_PREFIJO') ?? 'argosisp',
        })
        return async () => {
            await cerrarColaCambios()
            await cola.close()
            await falso.cerrar()
        }
    })

    test('encola un job por router (con lock), 202; el worker reconcilia con el actor', async ({
        client,
        assert,
    }) => {
        const routerId = await crearRouterFila({
            nas_ip: ipUnica(),
            api_url: falso.url,
            api_tls_verificar: false,
            api_usuario: falso.usuario,
            api_password: cifrar(falso.password),
        })
        const { token, usuario } = await usuarioConRoles(['tecnico'])
        await cola.remove(idJobReconciliar(routerId))

        const r = await estado(client.post(`/api/v1/routers/${routerId}/reconciliar`).bearerToken(token), 202)
        assert.deepEqual(r.body(), { router_id: routerId, job_id: `reconciliar-${routerId}`, encolado: true })
        const otra = await estado(
            client.post(`/api/v1/routers/${routerId}/reconciliar`).bearerToken(token),
            202,
        )
        assert.isFalse(otra.body().encolado)

        const job = await cola.getJob(`reconciliar-${routerId}`)
        assert.equal(job!.name, 'reconciliar_router')
        assert.containsSubset(job!.data, { router_id: routerId, actor: { tipo: 'usuario', id: usuario.id } })
        const salida = await ejecutarReconciliacionManual(job!.data, { clientes: rapida })
        assert.containsSubset(salida, { router_id: routerId, motivo: 'manual', error: null })
        await job!.remove()

        const accion = await db
            .from('audit.acciones')
            .where({ accion: 'routers.reconciliar', entidad_id: routerId })
            .count('* as n')
            .first()
        assert.equal(Number(accion.n), 2)
    })

    test('permisos: soporte 403; router inexistente 404', async ({ client }) => {
        const soporte = await usuarioConRoles(['soporte'])
        const admin = await usuarioConRoles(['admin'])
        const routerId = await crearRouterFila()
        await estado(client.post(`/api/v1/routers/${routerId}/reconciliar`).bearerToken(soporte.token), 403)
        await estado(client.post('/api/v1/routers/999999999/reconciliar').bearerToken(admin.token), 404)
    })
})

test.group('Routers · editar desde el panel', () => {
    test('clave vacía o null no cambia, quitar_* la borra; zona; auditoría con ***', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const zona = await crearZonaFila()
        const creado = await estado(
            client
                .post('/api/v1/routers')
                .bearerToken(token)
                .json({
                    nombre: unico('MK Editar'),
                    host: '192.0.2.40',
                    nas_ip: ipUnica(),
                    api_usuario: 'argos',
                    api_password: 'clave-1',
                    radius_secret: '',
                    zona_id: zona,
                }),
            201,
        )
        const id = creado.body().id
        assert.equal(creado.body().zona_id, zona)
        assert.isFalse(creado.body().tiene_radius_secret)

        const editado = await estado(
            client
                .put(`/api/v1/routers/${id}`)
                .bearerToken(token)
                .json({
                    version: 1,
                    nombre: unico('MK Editado'),
                    host: '192.0.2.41',
                    api_url: 'https://192.0.2.41:8443',
                    api_usuario: 'argos2',
                    api_password: '',
                    zona_id: null,
                    capacidad_bajada_kbps: 100000,
                }),
            200,
        )
        assert.containsSubset(editado.body(), {
            host: '192.0.2.41',
            api_url: 'https://192.0.2.41:8443',
            api_usuario: 'argos2',
            tiene_api_password: true,
            zona_id: null,
            capacidad_bajada_kbps: 100000,
        })
        let fila = await db.from('network.routers').where('id', id).firstOrFail()
        assert.equal(descifrar(fila.api_password), 'clave-1')
        const cambiosClave = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'router', entidad_id: id, campo: 'api_password' })
        // solo el alta: la clave vacía no es un cambio
        assert.lengthOf(cambiosClave, 1)

        await estado(
            client
                .put(`/api/v1/routers/${id}`)
                .bearerToken(token)
                .json({ version: 2, api_password: 'clave-2' }),
            200,
        )
        fila = await db.from('network.routers').where('id', id).firstOrFail()
        assert.equal(descifrar(fila.api_password), 'clave-2')
        const ultimo = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'router', entidad_id: id, campo: 'api_password' })
            .orderBy('id', 'desc')
            .firstOrFail()
        assert.deepEqual([ultimo.antes, ultimo.despues], ['***', '***'])

        const ambos = await estado(
            client
                .put(`/api/v1/routers/${id}`)
                .bearerToken(token)
                .json({ version: 3, api_password: 'x', quitar_api_password: true }),
            422,
        )
        assert.equal(ambos.body().errors[0].field, 'api_password')
        const quitada = await estado(
            client
                .put(`/api/v1/routers/${id}`)
                .bearerToken(token)
                .json({ version: 3, api_password: null, quitar_api_password: true }),
            200,
        )
        assert.isFalse(quitada.body().tiene_api_password)

        const zonaMala = await estado(
            client.put(`/api/v1/routers/${id}`).bearerToken(token).json({ version: 4, zona_id: 999999999 }),
            422,
        )
        assert.equal(zonaMala.body().errors[0].field, 'zona_id')
    })
})
