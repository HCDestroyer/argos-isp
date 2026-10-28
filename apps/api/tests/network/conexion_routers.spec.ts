import { randomBytes } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { cifrar, descifrar } from '#shared/cifrado'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearRouterFila } from '#tests/core/fabricas'

/** Clave pública WireGuard válida (32 bytes en base64). */
const clave = () => randomBytes(32).toString('base64')
const CLAVE_SERVIDOR = clave()
const TOKEN_INTERNO = () => env.get('INTERNAL_TOKEN')

const entornoOriginal = { ...process.env }

function extraer(script: string, variable: string): string {
    const m = new RegExp(`:local ${variable} (?:\\[:to[a-z]+ )?"((?:[^"\\\\]|\\\\.)*)"`).exec(script)
    if (!m) throw new Error(`No está ${variable} en el script`)
    return m[1]!
}

/** Lo que publica el `wireguard-agente` (la clave del servidor va en el script). */
async function publicarServidor() {
    await db.rawQuery(
        `INSERT INTO network.wireguard_servidor (id, public_key) VALUES (1, ?)
         ON CONFLICT (id) DO UPDATE SET public_key = EXCLUDED.public_key`,
        [CLAVE_SERVIDOR],
    )
}

const SERVICIO: Record<string, string> = {
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

async function routerRadius(datos: Record<string, unknown> = {}) {
    return crearRouterFila({ radius_secret: cifrar('secreto-del-nas-1234'), ...datos })
}

async function generar(client: any, token: string, routerId: number, qs: Record<string, string> = {}) {
    const r = await estado(
        client.get(`/api/v1/routers/${routerId}/script-conexion`).qs(qs).bearerToken(token),
        200,
    )
    return r.text()
}

test.group('Conexión de routers · API', (group) => {
    group.each.setup(async () => {
        process.env.ARGOSISP_WIREGUARD = '1'
        process.env.ARGOSISP_WG_ENDPOINT = 'vpn.argosisp.example'
        process.env.ARGOSISP_WG_RED = '10.255.0.0/16'
        process.env.ARGOSISP_WG_PUERTO = '51820'
        process.env.API_PUBLIC_URL = 'https://argos.example'
        process.env.ROUTERS_REGISTRO_LIMITE = '0'
        await publicarServidor()
        return () => {
            for (const nombre of Object.keys(process.env)) {
                if (!(nombre in entornoOriginal)) delete process.env[nombre]
            }
            Object.assign(process.env, entornoOriginal)
        }
    })

    test('generar el script: plantilla de A6, IP del túnel estable, token rotado y sin secretos en auditoría', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const routerId = await routerRadius({ api_password: cifrar('clave-vieja') })

        const r = await estado(
            client
                .get(`/api/v1/routers/${routerId}/script-conexion`)
                .qs({ admin: '203.0.113.5,198.51.100.0/24' })
                .bearerToken(token),
            200,
        )
        assert.match(r.header('content-type') ?? '', /^text\/plain/)
        assert.include(r.header('content-disposition'), `argosisp-router-${routerId}.rsc`)
        assert.equal(r.header('cache-control'), 'no-store')
        const script = r.text()
        assert.notMatch(script, /\{\{/)
        assert.notMatch(script, /pppoe-server/)

        const fila = await db.from('network.routers_conexion').where('router_id', routerId).firstOrFail()
        const ipTunel = extraer(script, 'wgIp')
        assert.match(ipTunel, /^10\.255\.\d+\.\d+$/)
        assert.isNull(fila.public_key)
        assert.equal(extraer(script, 'routerId'), String(routerId))
        assert.equal(extraer(script, 'wgServidorIp'), '10.255.0.1')
        assert.equal(extraer(script, 'wgRed'), '10.255.0.0/16')
        assert.equal(extraer(script, 'wgServidorPub'), CLAVE_SERVIDOR)
        assert.equal(extraer(script, 'wgServidorEndpoint'), 'vpn.argosisp.example')
        assert.equal(extraer(script, 'wgServidorPuerto'), '51820')
        assert.equal(extraer(script, 'argosUrl'), 'https://argos.example')
        assert.equal(extraer(script, 'radiusSecret'), 'secreto-del-nas-1234')
        assert.equal(extraer(script, 'apiNombre'), `router-${routerId}.argosisp`)
        assert.equal(extraer(script, 'adminIps'), '203.0.113.5,198.51.100.0/24')

        const tokenRegistro = extraer(script, 'token')
        const password = extraer(script, 'apiPassword')
        assert.lengthOf(password, 32)
        assert.match(password, /^[A-Za-z0-9]+$/)
        assert.equal(descifrar(fila.api_password_pendiente), password)
        // la clave vieja sigue hasta que el router se registre con este script
        const router = await db.from('network.routers').where('id', routerId).firstOrFail()
        assert.equal(descifrar(router.api_password), 'clave-vieja')

        const acciones = await db
            .from('audit.acciones')
            .where({ accion: 'routers.generar_script', entidad_tipo: 'router', entidad_id: routerId })
        assert.lengthOf(acciones, 1)
        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'router_conexion', entidad_id: routerId })
        assert.isTrue(cambios.some((c) => c.campo === 'ip_tunel'))
        const eventos = await db
            .from('audit.outbox')
            .where('evento', 'router.conexion_generada')
            .whereRaw("(payload->>'router_id')::bigint = ?", [routerId])
        assert.lengthOf(eventos, 1)
        assert.containsSubset(eventos[0].payload, {
            router_id: routerId,
            empresa_id: null,
            actor: { tipo: 'usuario' },
        })
        const todo = JSON.stringify([acciones, cambios, eventos])
        for (const secreto of [tokenRegistro, password, 'secreto-del-nas-1234', fila.token_hash]) {
            assert.notInclude(todo, secreto)
        }

        // segunda generación: misma IP, token y clave nuevos; el token anterior deja de valer
        const script2 = await generar(client, token, routerId)
        assert.equal(extraer(script2, 'wgIp'), ipTunel)
        assert.notEqual(extraer(script2, 'token'), tokenRegistro)
        assert.notEqual(extraer(script2, 'apiPassword'), password)
        assert.equal(extraer(script2, 'adminIps'), '')
        await estado(
            client
                .post('/api/v1/routers/conexion/registrar')
                .json({ token: tokenRegistro, public_key: clave() }),
            410,
        )
    })

    test('?incluir=servicio: plantilla de servicio con los datos del servidor; sin ellos 422', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const routerId = await routerRadius({ interfaz_clientes: 'ether2' })
        const falta = await estado(
            client
                .get(`/api/v1/routers/${routerId}/script-conexion`)
                .qs({ incluir: 'servicio' })
                .bearerToken(token),
            422,
        )
        assert.equal(falta.body().type, 'urn:argosisp:problema:servicio_incompleto')
        assert.include(falta.body().detail, 'ROUTERS_SERVICIO_PPP_LOCAL_V4')
        assert.notInclude(falta.body().detail, 'interfaz_clientes')

        Object.assign(process.env, SERVICIO)
        const script = await generar(client, token, routerId, { incluir: 'servicio' })
        assert.match(script, /pppoe-server/)
        assert.notMatch(script, /\{\{/)
    })

    test('registro por token: aplica clave, CA, host, nas_ip y api_url al túnel; un solo uso; vencido 410', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const routerId = await routerRadius({
            api_password: cifrar('clave-vieja'),
            api_url: 'https://mk:8443',
            api_tls_verificar: false,
        })
        const script = await generar(client, token, routerId)
        const tokenRegistro = extraer(script, 'token')
        const ipTunel = extraer(script, 'wgIp')
        const publica = clave()
        const ca = '-----BEGIN CERTIFICATE-----\nMIIBcaDelRouter\n-----END CERTIFICATE-----'

        const r = await estado(
            client.post('/api/v1/routers/conexion/registrar').json({
                token: tokenRegistro,
                public_key: publica,
                routeros_version: '7.24.5 (stable)',
                api_ca: ca,
            }),
            200,
        )
        assert.deepEqual(r.body(), {
            router_id: routerId,
            ip_tunel: ipTunel,
            servidor: {
                public_key: CLAVE_SERVIDOR,
                endpoint: 'vpn.argosisp.example',
                puerto: 51820,
                ip: '10.255.0.1',
            },
        })
        const router = await db
            .from('network.routers')
            .where('id', routerId)
            .select(
                'host',
                db.raw('host(nas_ip) AS nas_ip'),
                'api_usuario',
                'api_url',
                'api_password',
                'api_tls_verificar',
                'api_ca',
            )
            .firstOrFail()
        assert.containsSubset(router, {
            host: ipTunel,
            nas_ip: ipTunel,
            api_usuario: 'argosisp-api',
            api_url: `https://${ipTunel}`,
            api_tls_verificar: true,
            api_ca: ca,
        })
        assert.equal(descifrar(router.api_password), extraer(script, 'apiPassword'))

        const conexion = await estado(
            client.get(`/api/v1/routers/${routerId}/conexion`).bearerToken(token),
            200,
        )
        assert.containsSubset(conexion.body(), {
            router_id: routerId,
            estado: 'pendiente',
            ip_tunel: ipTunel,
            public_key: publica,
            ultimo_handshake: null,
            handshake_reciente: false,
            routeros_version: '7.24.5 (stable)',
            token_vence: null,
        })
        assert.isString(conexion.body().registrado_en)

        const eventos = await db
            .from('audit.outbox')
            .where('evento', 'router.conexion_registrada')
            .whereRaw("(payload->>'router_id')::bigint = ?", [routerId])
        assert.deepEqual(eventos[0].payload, { router_id: routerId, empresa_id: null, ip_tunel: ipTunel })
        for (const campo of ['api_password', 'api_ca']) {
            const cambio = await db
                .from('audit.cambios')
                .where({ entidad_tipo: 'router', entidad_id: routerId, campo })
                .orderBy('id', 'desc')
                .firstOrFail()
            assert.equal(cambio.despues, '***')
        }
        const registro = await db
            .from('audit.acciones')
            .where({ accion: 'routers.registrar_conexion', entidad_id: routerId })
            .firstOrFail()
        assert.equal(registro.entrada.token, '***')

        const usado = await estado(
            client
                .post('/api/v1/routers/conexion/registrar')
                .json({ token: tokenRegistro, public_key: publica }),
            410,
        )
        assert.equal(usado.body().type, 'urn:argosisp:problema:token_invalido')
        await estado(
            client
                .post('/api/v1/routers/conexion/registrar')
                .json({ token: 'x'.repeat(32), public_key: publica }),
            410,
        )
        const script2 = await generar(client, token, routerId)
        await db
            .from('network.routers_conexion')
            .where('router_id', routerId)
            .update({ token_vence: new Date(Date.now() - 60_000) })
        await estado(
            client
                .post('/api/v1/routers/conexion/registrar')
                .json({ token: extraer(script2, 'token'), public_key: publica }),
            410,
        )
        await estado(
            client
                .post('/api/v1/routers/conexion/registrar')
                .json({ token: tokenRegistro, public_key: 'corta' }),
            422,
        )
    })

    test('registro: la clave de otro router da 409 y hay límite por IP (429)', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const publica = clave()
        const a = await routerRadius()
        const b = await routerRadius()
        await estado(
            client
                .post('/api/v1/routers/conexion/registrar')
                .json({ token: extraer(await generar(client, token, a), 'token'), public_key: publica }),
            200,
        )
        const conflicto = await estado(
            client
                .post('/api/v1/routers/conexion/registrar')
                .json({ token: extraer(await generar(client, token, b), 'token'), public_key: publica }),
            409,
        )
        assert.equal(conflicto.body().type, 'urn:argosisp:problema:clave_en_uso')

        process.env.ROUTERS_REGISTRO_LIMITE = '2'
        process.env.ROUTERS_REGISTRO_PREFIJO = unico('a1c-registro')
        await estado(client.post('/api/v1/routers/conexion/registrar').json({}), 422)
        await estado(client.post('/api/v1/routers/conexion/registrar').json({}), 422)
        const limitado = await estado(client.post('/api/v1/routers/conexion/registrar').json({}), 429)
        assert.isString(limitado.header('retry-after'))
    })

    test('sin secreto RADIUS válido 422; WireGuard apagado, sin clave del servidor o sin https 503', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const sinSecreto = await crearRouterFila()
        const r = await estado(
            client.get(`/api/v1/routers/${sinSecreto}/script-conexion`).bearerToken(token),
            422,
        )
        assert.equal(r.body().type, 'urn:argosisp:problema:radius_secret_requerido')
        const corto = await crearRouterFila({ radius_secret: cifrar('corto') })
        await estado(client.get(`/api/v1/routers/${corto}/script-conexion`).bearerToken(token), 422)

        const routerId = await routerRadius()
        const no503 = async (detalle: RegExp) => {
            const respuesta = await estado(
                client.get(`/api/v1/routers/${routerId}/script-conexion`).bearerToken(token),
                503,
            )
            assert.equal(respuesta.body().type, 'urn:argosisp:problema:wireguard_no_configurado')
            assert.match(respuesta.body().detail, detalle)
        }
        process.env.API_PUBLIC_URL = 'http://argos.example'
        await no503(/https/)
        process.env.API_PUBLIC_URL = 'https://argos.example'
        process.env.ARGOSISP_WIREGUARD = '0'
        await no503(/ARGOSISP_WIREGUARD/)
        process.env.ARGOSISP_WIREGUARD = '1'
        await db.from('network.wireguard_servidor').delete()
        await no503(/clave pública/)
        await publicarServidor()
        await estado(
            client
                .get(`/api/v1/routers/${routerId}/script-conexion`)
                .qs({ admin: 'no-ip' })
                .bearerToken(token),
            422,
        )
        await estado(client.get('/api/v1/routers/999999999/script-conexion').bearerToken(token), 404)
    })

    test('permisos: generar (admin, técnico), rotar (admin), pegar clave (admin, técnico)', async ({
        client,
    }) => {
        const routerId = await routerRadius()
        const cajero = await usuarioConRoles(['cajero'])
        const soporte = await usuarioConRoles(['soporte'])
        const tecnico = await usuarioConRoles(['tecnico'])
        for (const { token } of [cajero, soporte]) {
            await estado(client.get(`/api/v1/routers/${routerId}/script-conexion`).bearerToken(token), 403)
            await estado(
                client
                    .post(`/api/v1/routers/${routerId}/conexion/clave`)
                    .json({ public_key: clave() })
                    .bearerToken(token),
                403,
            )
        }
        await estado(
            client.post(`/api/v1/routers/${routerId}/conexion/rotar`).bearerToken(tecnico.token),
            403,
        )
        await estado(client.get(`/api/v1/routers/${routerId}/conexion`).bearerToken(soporte.token), 200)
        await estado(client.get(`/api/v1/routers/${routerId}/conexion`).bearerToken(cajero.token), 403)
        await estado(
            client.get(`/api/v1/routers/${routerId}/script-conexion`).bearerToken(tecnico.token),
            200,
        )
    })

    test('pegar la clave a mano: exige script previo y consume el token', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const routerId = await routerRadius()
        const sinScript = await estado(
            client
                .post(`/api/v1/routers/${routerId}/conexion/clave`)
                .json({ public_key: clave() })
                .bearerToken(token),
            422,
        )
        assert.equal(sinScript.body().type, 'urn:argosisp:problema:script_no_generado')
        const vacia = await estado(client.get(`/api/v1/routers/${routerId}/conexion`).bearerToken(token), 200)
        assert.containsSubset(vacia.body(), { estado: 'sin_configurar', ip_tunel: null, version: 0 })

        const script = await generar(client, token, routerId)
        const publica = clave()
        const r = await estado(
            client
                .post(`/api/v1/routers/${routerId}/conexion/clave`)
                .json({ public_key: publica })
                .bearerToken(token),
            200,
        )
        assert.containsSubset(r.body(), { estado: 'pendiente', public_key: publica, token_vence: null })
        const router = await db.from('network.routers').where('id', routerId).firstOrFail()
        assert.equal(descifrar(router.api_password), extraer(script, 'apiPassword'))
        await estado(
            client
                .post('/api/v1/routers/conexion/registrar')
                .json({ token: extraer(script, 'token'), public_key: publica }),
            410,
        )
        const acciones = await db
            .from('audit.acciones')
            .where({ accion: 'routers.conexion_clave', entidad_id: routerId })
            .orderBy('id')
        assert.deepEqual(
            acciones.map((a) => a.resultado),
            ['error', 'ok'],
        )
    })

    test('estado del wireguard-agente: clave del servidor, conectado con handshake < 3 min; peers', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const routerId = await routerRadius()
        const script = await generar(client, token, routerId)
        const publica = clave()
        await estado(
            client
                .post('/api/v1/routers/conexion/registrar')
                .json({ token: extraer(script, 'token'), public_key: publica }),
            200,
        )
        const peers = await estado(
            client.get('/api/v1/internal/wireguard/peers').bearerToken(TOKEN_INTERNO()),
            200,
        )
        assert.deepInclude(peers.body().data, {
            router_id: routerId,
            public_key: publica,
            ip_tunel: extraer(script, 'wgIp'),
        })
        await estado(client.get('/api/v1/internal/wireguard/peers').bearerToken(token), 401)

        const nuevaClave = clave()
        const informe = (handshake: Date | null, generado = new Date()) => ({
            servidor: {
                public_key: nuevaClave,
                ip: '10.255.0.1',
                red: '10.255.0.0/16',
                puerto: 51820,
                interfaz: 'wg-argos',
                modo: 'kernel',
            },
            peers: [
                {
                    public_key: publica,
                    ultimo_handshake: handshake?.toISOString() ?? null,
                    endpoint: '203.0.113.9:13231',
                    rx_bytes: 100,
                    tx_bytes: 200,
                },
                { public_key: clave(), ultimo_handshake: new Date().toISOString() },
            ],
            generado_en: generado.toISOString(),
        })
        const contarAcciones = async () => {
            const fila = await db
                .from('audit.acciones')
                .where('accion', 'routers.registrar_estado_wireguard')
                .count('* as n')
                .first()
            return Number(fila.n)
        }
        const inicio = await contarAcciones()
        const ahora = new Date()
        await estado(
            client
                .post('/api/v1/internal/wireguard/estado')
                .bearerToken(TOKEN_INTERNO())
                .json(informe(ahora)),
            204,
        )
        const servidor = await db.from('network.wireguard_servidor').where('id', 1).firstOrFail()
        assert.equal(servidor.public_key, nuevaClave)
        // los scripts nuevos llevan la clave publicada
        assert.equal(extraer(await generar(client, token, await routerRadius()), 'wgServidorPub'), nuevaClave)

        const conectado = await estado(
            client.get(`/api/v1/routers/${routerId}/conexion`).bearerToken(token),
            200,
        )
        assert.containsSubset(conectado.body(), {
            estado: 'conectado',
            ultimo_handshake: ahora.toISOString(),
            handshake_reciente: true,
        })
        // un informe igual (sin cambios de estado) no deja fila; uno atrasado no retrocede el handshake
        await estado(
            client
                .post('/api/v1/internal/wireguard/estado')
                .bearerToken(TOKEN_INTERNO())
                .json(informe(new Date(ahora.getTime() - 60_000))),
            204,
        )
        assert.equal(await contarAcciones(), inicio + 1)
        // 4 min sin handshake: vuelve a pendiente
        await estado(
            client
                .post('/api/v1/internal/wireguard/estado')
                .bearerToken(TOKEN_INTERNO())
                .json(informe(ahora, new Date(ahora.getTime() + 4 * 60_000))),
            204,
        )
        assert.equal(await contarAcciones(), inicio + 2)
        const fila = await db.from('network.routers_conexion').where('router_id', routerId).firstOrFail()
        assert.equal(fila.estado, 'pendiente')
        assert.equal(new Date(fila.ultimo_handshake).toISOString(), ahora.toISOString())
        const cambiosEstado = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'router_conexion', entidad_id: routerId, campo: 'estado' })
            .orderBy('id')
        // (el alta de la conexión deja `null → pendiente`)
        assert.deepEqual(
            cambiosEstado.filter((c) => c.antes !== null).map((c) => [c.antes, c.despues]),
            [
                ['pendiente', 'conectado'],
                ['conectado', 'pendiente'],
            ],
        )
    })

    test('desactivar un router con túnel: sale de los peers y emite conexion_eliminada; reactivarlo lo devuelve', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const routerId = await routerRadius()
        const script = await generar(client, token, routerId)
        await estado(
            client
                .post('/api/v1/routers/conexion/registrar')
                .json({ token: extraer(script, 'token'), public_key: clave() }),
            200,
        )
        const { version } = await db.from('network.routers').where('id', routerId).firstOrFail()
        await estado(
            client.put(`/api/v1/routers/${routerId}`).bearerToken(token).json({ version, activo: false }),
            200,
        )
        const eliminada = await db
            .from('audit.outbox')
            .where('evento', 'router.conexion_eliminada')
            .whereRaw("(payload->>'router_id')::bigint = ?", [routerId])
            .firstOrFail()
        assert.deepEqual(eliminada.payload, { router_id: routerId, empresa_id: null })
        const peers = await estado(
            client.get('/api/v1/internal/wireguard/peers').bearerToken(TOKEN_INTERNO()),
            200,
        )
        assert.isFalse(peers.body().data.some((p: { router_id: number }) => p.router_id === routerId))

        await estado(
            client
                .put(`/api/v1/routers/${routerId}`)
                .bearerToken(token)
                .json({ version: version + 1, activo: true }),
            200,
        )
        const registradas = await db
            .from('audit.outbox')
            .where('evento', 'router.conexion_registrada')
            .whereRaw("(payload->>'router_id')::bigint = ?", [routerId])
        assert.lengthOf(registradas, 2)
    })

    test('rotar: borra el peer, emite conexion_rotada y entrega un script nuevo con la misma IP', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const routerId = await routerRadius()
        const script = await generar(client, token, routerId)
        const publica = clave()
        await estado(
            client
                .post('/api/v1/routers/conexion/registrar')
                .json({ token: extraer(script, 'token'), public_key: publica }),
            200,
        )
        const r = await estado(
            client
                .post(`/api/v1/routers/${routerId}/conexion/rotar`)
                .qs({ admin: '203.0.113.9' })
                .bearerToken(token),
            200,
        )
        const nuevo = r.text()
        assert.equal(extraer(nuevo, 'wgIp'), extraer(script, 'wgIp'))
        assert.equal(extraer(nuevo, 'adminIps'), '203.0.113.9')
        const fila = await db.from('network.routers_conexion').where('router_id', routerId).firstOrFail()
        assert.isNull(fila.public_key)
        assert.equal(fila.estado, 'pendiente')
        const rotada = await db
            .from('audit.outbox')
            .where('evento', 'router.conexion_rotada')
            .whereRaw("(payload->>'router_id')::bigint = ?", [routerId])
            .firstOrFail()
        assert.deepEqual(rotada.payload, {
            router_id: routerId,
            empresa_id: null,
            ip_tunel: extraer(script, 'wgIp'),
        })
        const peers = await estado(
            client.get('/api/v1/internal/wireguard/peers').bearerToken(TOKEN_INTERNO()),
            200,
        )
        assert.isFalse(peers.body().data.some((p: { router_id: number }) => p.router_id === routerId))
        await estado(
            client
                .post('/api/v1/routers/conexion/registrar')
                .json({ token: extraer(nuevo, 'token'), public_key: publica }),
            200,
        )
    })

    test('IPAM del túnel: salta la .1, las nas_ip ocupadas y responde 422 con la red llena', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const tercero = 100 + (process.pid % 100)
        process.env.ARGOSISP_WG_RED = `10.254.${tercero}.0/29`
        await routerRadius({ nas_ip: `10.254.${tercero}.2` })
        const ips: string[] = []
        for (let i = 0; i < 4; i++) {
            ips.push(extraer(await generar(client, token, await routerRadius()), 'wgIp'))
        }
        assert.deepEqual(
            ips,
            [3, 4, 5, 6].map((n) => `10.254.${tercero}.${n}`),
        )
        const llena = await estado(
            client.get(`/api/v1/routers/${await routerRadius()}/script-conexion`).bearerToken(token),
            422,
        )
        assert.equal(llena.body().type, 'urn:argosisp:problema:red_tunel_llena')
    })
})
