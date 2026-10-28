import { randomBytes } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { cifrar, descifrar } from '#shared/cifrado'
import { escaparRouterOS, listaRouterOS, PlantillaInvalida, renderScript } from '#network/conexion/render'
import { leerRedTunel, parsearAdmin } from '#network/conexion/config'
import { PLANTILLA_MINIMA } from '#network/conexion/plantilla_minima'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearRouterFila } from '#tests/core/fabricas'

/** Clave pública WireGuard válida (32 bytes en base64). */
const clave = () => randomBytes(32).toString('base64')
const CLAVE_SERVIDOR = clave()
const TOKEN_INTERNO = () => env.get('INTERNAL_TOKEN')

const entornoOriginal = { ...process.env }

function extraer(script: string, variable: string): string {
    const m = new RegExp(`:local ${variable} "((?:[^"\\\\]|\\\\.)*)"`).exec(script)
    if (!m) throw new Error(`No está ${variable} en el script`)
    return m[1]!
}

async function routerRadius(datos: Record<string, unknown> = {}) {
    return crearRouterFila({ radius_secret: cifrar('secreto-del-nas-123'), ...datos })
}

async function generar(client: any, token: string, routerId: number, qs: Record<string, string> = {}) {
    const r = await estado(
        client.get(`/api/v1/routers/${routerId}/script-conexion`).qs(qs).bearerToken(token),
        200,
    )
    return r.text()
}

test.group('Conexión de routers · render', () => {
    test('escapa comillas, $, \\, ? y caracteres de control para RouterOS', ({ assert }) => {
        assert.equal(escaparRouterOS('a"b$c\\d?e'), 'a\\"b\\$c\\\\d\\?e')
        assert.equal(escaparRouterOS('uno\ndos\r\t'), 'uno\\0Ados\\0D\\09')
        assert.equal(escaparRouterOS('Señal ñ'), 'Señal ñ')
        assert.equal(listaRouterOS(['1.2.3.4', 'x"$']), '{"1.2.3.4";"x\\"\\$"}')
        assert.equal(listaRouterOS([]), '{}')
    })

    test('secciones, listas y variables; un marcador desconocido es error', ({ assert }) => {
        const vars = {
            textos: { a: 'v"1' },
            listas: { l: ['x'] },
            secciones: { si: true, no: false },
        }
        assert.equal(
            renderScript(
                ':local a "{{a}}" {{lista:l}}{{#si}} S{{/si}}{{#no}} N{{/no}}{{^no}} !N{{/no}}',
                vars,
            ),
            ':local a "v\\"1" {"x"} S !N',
        )
        assert.throws(() => renderScript('{{b}}', vars), PlantillaInvalida as any)
        assert.throws(() => renderScript('{{#zz}}x{{/zz}}', vars), PlantillaInvalida as any)
        assert.throws(() => renderScript('{{lista:otra}}', vars), PlantillaInvalida as any)
    })

    test('la plantilla mínima solo usa variables conocidas', ({ assert }) => {
        const textos = Object.fromEntries(
            [
                'router_id',
                'router_nombre',
                'generado_en',
                'token_vence',
                'ip_tunel',
                'ip_tunel_cidr',
                'red_tunel',
                'servidor_ip',
                'servidor_public_key',
                'servidor_endpoint',
                'servidor_puerto',
                'registro_url',
                'registro_token',
                'api_usuario',
                'api_grupo',
                'api_password',
                'radius_secret',
            ].map((n) => [n, n]),
        )
        const script = renderScript(PLANTILLA_MINIMA, {
            textos,
            listas: { admin_ips: [] },
            secciones: { radius: true, incluir_servicio: false, admin: false },
        })
        assert.notInclude(script, '{{')
        assert.include(script, '/radius add')
    })

    test('red del túnel y lista de administración', ({ assert }) => {
        assert.deepEqual(leerRedTunel('10.255.3.9/16'), {
            cidr: '10.255.0.0/16',
            base: 184483840,
            prefijo: 16,
            servidor: '10.255.0.1',
        })
        assert.deepEqual(parsearAdmin(' 203.0.113.5, 198.51.100.0/24,203.0.113.5 '), [
            '203.0.113.5',
            '198.51.100.0/24',
        ])
        assert.deepEqual(parsearAdmin(undefined), [])
        assert.throws(() => parsearAdmin('1.2.3.4,no-es-ip'))
        assert.throws(() => parsearAdmin('1.2.3.4/33'))
    })
})

test.group('Conexión de routers · API', (group) => {
    group.each.setup(() => {
        process.env.ARGOSISP_WG_CLAVE_PUBLICA = CLAVE_SERVIDOR
        process.env.ARGOSISP_WG_ENDPOINT = 'vpn.argosisp.example'
        process.env.ARGOSISP_WG_RED = '10.255.0.0/16'
        process.env.ARGOSISP_WG_PUERTO = '51820'
        process.env.API_PUBLIC_URL = 'https://argos.example'
        process.env.ROUTERS_REGISTRO_LIMITE = '0'
        return () => {
            for (const nombre of Object.keys(process.env)) {
                if (!(nombre in entornoOriginal)) delete process.env[nombre]
            }
            Object.assign(process.env, entornoOriginal)
        }
    })

    test('generar el script: IP del túnel estable, token rotado, clave pendiente y sin secretos en auditoría', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const nombre = `MK "Centro" $x ?\nfin`
        const routerId = await routerRadius({ nombre: unico(nombre), api_password: cifrar('clave-vieja') })

        const r = await estado(
            client
                .get(`/api/v1/routers/${routerId}/script-conexion`)
                .qs({ admin: '203.0.113.5,198.51.100.0/24', incluir: 'servicio' })
                .bearerToken(token),
            200,
        )
        assert.match(r.header('content-type') ?? '', /^text\/plain/)
        assert.include(r.header('content-disposition'), `argosisp-router-${routerId}.rsc`)
        assert.equal(r.header('cache-control'), 'no-store')
        const script = r.text()

        const fila = await db.from('network.routers_conexion').where('router_id', routerId).firstOrFail()
        const ipTunel = extraer(script, 'tunelIp')
        assert.match(ipTunel, /^10\.255\.\d+\.\d+$/)
        assert.equal(fila.estado, 'pendiente')
        assert.isNull(fila.public_key)
        assert.equal(extraer(script, 'tunelCidr'), `${ipTunel}/16`)
        assert.equal(extraer(script, 'servidorIp'), '10.255.0.1')
        assert.equal(extraer(script, 'servidorPub'), CLAVE_SERVIDOR)
        assert.equal(extraer(script, 'servidorEndpoint'), 'vpn.argosisp.example')
        assert.equal(
            extraer(script, 'registroUrl'),
            'https://argos.example/api/v1/routers/conexion/registrar',
        )
        assert.equal(extraer(script, 'radiusSecret'), 'secreto-del-nas-123')
        assert.include(script, ':local adminIps {"203.0.113.5";"198.51.100.0/24"}')
        assert.include(script, 'no incluye la configuración de servicio')
        // el nombre va escapado: ni comillas sueltas ni saltos de línea
        assert.include(script, 'MK \\"Centro\\" \\$x \\?\\0Afin')

        const tokenRegistro = extraer(script, 'registroToken')
        const password = extraer(script, 'apiPassword')
        assert.lengthOf(password, 32)
        assert.match(password, /^[A-Za-z0-9]+$/)
        assert.equal(descifrar(fila.api_password_pendiente), password)
        // la clave vieja sigue hasta que el router se registre con este script
        const router = await db.from('network.routers').where('id', routerId).firstOrFail()
        assert.equal(descifrar(router.api_password), 'clave-vieja')

        // auditoría y outbox sin secretos
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
        for (const secreto of [tokenRegistro, password, 'secreto-del-nas-123', fila.token_hash]) {
            assert.notInclude(todo, secreto)
        }

        // segunda generación: misma IP, token y clave nuevos; el token anterior deja de valer
        const script2 = await generar(client, token, routerId)
        assert.equal(extraer(script2, 'tunelIp'), ipTunel)
        assert.notEqual(extraer(script2, 'registroToken'), tokenRegistro)
        assert.notEqual(extraer(script2, 'apiPassword'), password)
        assert.include(script2, ':local adminIps {}')
        assert.notInclude(script2, 'no incluye la configuración de servicio')
        await estado(
            client
                .post('/api/v1/routers/conexion/registrar')
                .json({ token: tokenRegistro, public_key: clave() }),
            410,
        )
    })

    test('registro por token: aplica clave, host y nas_ip al túnel; un solo uso; vencido 410', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const routerId = await routerRadius({
            api_password: cifrar('clave-vieja'),
            api_url: 'https://mk:8443',
        })
        const script = await generar(client, token, routerId)
        const tokenRegistro = extraer(script, 'registroToken')
        const ipTunel = extraer(script, 'tunelIp')
        const publica = clave()

        const r = await estado(
            client
                .post('/api/v1/routers/conexion/registrar')
                .json({ token: tokenRegistro, public_key: publica }),
            200,
        )
        assert.deepEqual(r.body(), {
            router_id: routerId,
            ip_tunel: ipTunel,
            ip_tunel_cidr: `${ipTunel}/16`,
            servidor_ip: '10.255.0.1',
            servidor_public_key: CLAVE_SERVIDOR,
            servidor_endpoint: 'vpn.argosisp.example',
            servidor_puerto: 51820,
        })
        const router = await db
            .from('network.routers')
            .where('id', routerId)
            .select('host', db.raw('host(nas_ip) AS nas_ip'), 'api_usuario', 'api_url', 'api_password')
            .firstOrFail()
        assert.containsSubset(router, {
            host: ipTunel,
            nas_ip: ipTunel,
            api_usuario: 'argosisp-api',
            api_url: null,
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
            token_vence: null,
        })
        assert.isString(conexion.body().registrado_en)

        const eventos = await db
            .from('audit.outbox')
            .where('evento', 'router.conexion_registrada')
            .whereRaw("(payload->>'router_id')::bigint = ?", [routerId])
        assert.deepEqual(eventos[0].payload, { router_id: routerId, empresa_id: null, ip_tunel: ipTunel })
        const cambioClave = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'router', entidad_id: routerId, campo: 'api_password' })
            .firstOrFail()
        assert.deepEqual([cambioClave.antes, cambioClave.despues], ['***', '***'])
        const registro = await db
            .from('audit.acciones')
            .where({ accion: 'routers.registrar_conexion', entidad_id: routerId })
            .firstOrFail()
        assert.equal(registro.entrada.token, '***')

        // un solo uso
        const usado = await estado(
            client
                .post('/api/v1/routers/conexion/registrar')
                .json({ token: tokenRegistro, public_key: publica }),
            410,
        )
        assert.equal(usado.body().type, 'urn:argosisp:problema:token_invalido')
        // desconocido
        await estado(
            client
                .post('/api/v1/routers/conexion/registrar')
                .json({ token: 'x'.repeat(32), public_key: publica }),
            410,
        )
        // vencido
        const script2 = await generar(client, token, routerId)
        await db
            .from('network.routers_conexion')
            .where('router_id', routerId)
            .update({ token_vence: new Date(Date.now() - 60_000) })
        await estado(
            client
                .post('/api/v1/routers/conexion/registrar')
                .json({ token: extraer(script2, 'registroToken'), public_key: publica }),
            410,
        )
        // clave pública inválida: 422
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
            client.post('/api/v1/routers/conexion/registrar').json({
                token: extraer(await generar(client, token, a), 'registroToken'),
                public_key: publica,
            }),
            200,
        )
        const conflicto = await estado(
            client.post('/api/v1/routers/conexion/registrar').json({
                token: extraer(await generar(client, token, b), 'registroToken'),
                public_key: publica,
            }),
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

    test('sin secreto RADIUS 422; sin WireGuard configurado 503; router en modo api sin bloque RADIUS', async ({
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

        const modoApi = await crearRouterFila({ modo_seguridad: 'api' })
        const script = await generar(client, token, modoApi)
        assert.notInclude(script, '/radius add')
        assert.equal(extraer(script, 'radiusSecret'), '')

        delete process.env.ARGOSISP_WG_CLAVE_PUBLICA
        const sinWg = await estado(
            client.get(`/api/v1/routers/${modoApi}/script-conexion`).bearerToken(token),
            503,
        )
        assert.equal(sinWg.body().type, 'urn:argosisp:problema:wireguard_no_configurado')
        await estado(
            client
                .get(`/api/v1/routers/${modoApi}/script-conexion`)
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
                .json({ token: extraer(script, 'registroToken'), public_key: publica }),
            410,
        )
        const accion = await db
            .from('audit.acciones')
            .where({ accion: 'routers.conexion_clave', entidad_id: routerId })
            .orderBy('id')
        assert.deepEqual(
            accion.map((a) => a.resultado),
            ['error', 'ok'],
        )
    })

    test('handshakes del servicio wireguard: conectado con el primero, nunca retrocede; peers', async ({
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
                .json({ token: extraer(script, 'registroToken'), public_key: publica }),
            200,
        )
        const peers = await estado(
            client.get('/api/v1/internal/routers/conexion/peers').bearerToken(TOKEN_INTERNO()),
            200,
        )
        assert.deepInclude(peers.body(), {
            router_id: routerId,
            public_key: publica,
            ip_tunel: extraer(script, 'tunelIp'),
        })
        await estado(client.get('/api/v1/internal/routers/conexion/peers').bearerToken(token), 401)

        const antesDeAuditar = await db
            .from('audit.acciones')
            .where('accion', 'routers.registrar_handshakes')
            .count('* as n')
            .first()
        const sinNada = await estado(
            client
                .post('/api/v1/internal/routers/conexion/handshakes')
                .bearerToken(TOKEN_INTERNO())
                .json({ peers: [{ public_key: clave(), ultimo_handshake: new Date().toISOString() }] }),
            200,
        )
        assert.deepEqual(sinNada.body(), { actualizados: 0, conectados: [] })

        const ahora = new Date()
        const r = await estado(
            client
                .post('/api/v1/internal/routers/conexion/handshakes')
                .bearerToken(TOKEN_INTERNO())
                .json({ peers: [{ public_key: publica, ultimo_handshake: ahora.toISOString() }] }),
            200,
        )
        assert.deepEqual(r.body(), { actualizados: 1, conectados: [routerId] })
        await estado(
            client
                .post('/api/v1/internal/routers/conexion/handshakes')
                .bearerToken(TOKEN_INTERNO())
                .json({
                    peers: [
                        {
                            public_key: publica,
                            ultimo_handshake: new Date(ahora.getTime() - 60_000).toISOString(),
                        },
                    ],
                }),
            200,
        )
        const conexion = await estado(
            client.get(`/api/v1/routers/${routerId}/conexion`).bearerToken(token),
            200,
        )
        assert.containsSubset(conexion.body(), {
            estado: 'conectado',
            ultimo_handshake: ahora.toISOString(),
            handshake_reciente: true,
        })
        const despues = await db
            .from('audit.acciones')
            .where('accion', 'routers.registrar_handshakes')
            .count('* as n')
            .first()
        // solo el informe que conectó al router deja fila
        assert.equal(Number(despues.n) - Number(antesDeAuditar.n), 1)
        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'router_conexion', entidad_id: routerId, campo: 'estado' })
            .orderBy('id', 'desc')
            .firstOrFail()
        assert.deepEqual([cambio.antes, cambio.despues], ['pendiente', 'conectado'])
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
                .json({ token: extraer(script, 'registroToken'), public_key: publica }),
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
        assert.equal(extraer(nuevo, 'tunelIp'), extraer(script, 'tunelIp'))
        assert.include(nuevo, '{"203.0.113.9"}')
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
            ip_tunel: extraer(script, 'tunelIp'),
        })
        const peers = await estado(
            client.get('/api/v1/internal/routers/conexion/peers').bearerToken(TOKEN_INTERNO()),
            200,
        )
        assert.isFalse(peers.body().some((p: { router_id: number }) => p.router_id === routerId))
        // el script nuevo registra de nuevo
        await estado(
            client
                .post('/api/v1/routers/conexion/registrar')
                .json({ token: extraer(nuevo, 'registroToken'), public_key: publica }),
            200,
        )
    })

    test('IPAM del túnel: salta la .1, las nas_ip ocupadas y responde 422 con la red llena', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        // red /29 propia: hosts .2 a .6 para routers
        const tercero = 100 + (process.pid % 100)
        process.env.ARGOSISP_WG_RED = `10.254.${tercero}.0/29`
        await routerRadius({ nas_ip: `10.254.${tercero}.2` })
        const ips: string[] = []
        for (let i = 0; i < 4; i++) {
            ips.push(extraer(await generar(client, token, await routerRadius()), 'tunelIp'))
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
