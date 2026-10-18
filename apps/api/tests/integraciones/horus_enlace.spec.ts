import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, usuarioConRoles } from '#tests/ayudas'
import { crearCliente, crearServicio } from '#tests/notify/ayudas_notify'
import { descifrar } from '#shared/cifrado'
import { RUTA_CANJE_HORUS } from '#integraciones/horus/actions/conectar_con_enlace_horus'
import { RUTA_TICKETS_HORUS } from '#integraciones/horus/actions/abrir_en_horus'
import { RUTA_RECEPTOR } from '#integraciones/horus/panel'
import {
    HorusSimulado,
    contar,
    cuerpoDe,
    SECRETO_SALIDA,
    TOKEN_HORUS,
    fijarConector,
    limpiarHorus,
} from '#tests/integraciones/horus_simulado'

/**
 * Enlace de conexión (§1.4) en los dos sentidos y "Ver en Horus" (§1.5, lado emisor).
 */

const ARGOS = 'https://argos.isp.example'
const PANEL = 'https://panel.isp.example'

/** Usuario con un rol hecho a la medida (p. ej. `horus.abrir` sin `horus.ver`). */
async function usuarioConPermisos(permisos: string[]) {
    const { usuario, token } = await usuarioConRoles([])
    const [rol] = (await db
        .table('core.roles')
        .insert({ nombre: `prueba_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` })
        .returning('id')) as Array<{ id: number }>
    const ids = (await db.from('core.permisos').whereIn('nombre', permisos).select('id')) as Array<{
        id: number
    }>
    await db
        .table('core.roles_permisos')
        .multiInsert(ids.map((p) => ({ role_id: rol!.id, permiso_id: p.id })))
    await db.table('core.usuarios_roles').insert({ usuario_id: usuario.id, role_id: rol!.id })
    return { usuario, token }
}

function canje(codigo: string, extra: Record<string, unknown> = {}) {
    return {
        codigo,
        sistema: 'horus',
        base_url: 'https://horus.isp.example',
        token: TOKEN_HORUS,
        webhook: {
            url: 'https://horus.isp.example/api/v1/integrations/argosisp/webhook/c-9',
            secreto: SECRETO_SALIDA,
        },
        ...extra,
    }
}

test.group('integraciones · horus · enlace de conexión y autologin', (group) => {
    group.each.setup(async () => {
        process.env.HORUS_PERMITIR_HTTP = 'true'
        process.env.API_PUBLIC_URL = ARGOS
        process.env.PANEL_URL_PUBLICA = PANEL
        await limpiarHorus()
        return async () => {
            await limpiarHorus()
            delete process.env.HORUS_PERMITIR_HTTP
            delete process.env.API_PUBLIC_URL
            delete process.env.PANEL_URL_PUBLICA
        }
    })

    test('Argos genera el enlace (solo SHA-256), Horus lo canjea una vez: atk_, receptor y secreto; conector apagado', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const generado = await estado(
            client.post('/api/v1/integraciones/horus/enlace').bearerToken(admin),
            201,
        )
        const enlace: string = generado.body().enlace
        assert.match(enlace, /^https:\/\/argos\.isp\.example\/conectar#[A-Za-z0-9_-]{43}$/)
        const codigo = enlace.split('#')[1]!
        const fila = await db.from('integraciones.horus_enlaces').first()
        assert.match(fila.codigo_sha256, /^[0-9a-f]{64}$/)
        assert.notInclude(JSON.stringify(fila), codigo)
        const venceMin = (new Date(fila.vence_en).getTime() - Date.now()) / 60_000
        assert.isAbove(venceMin, 14)
        assert.isBelow(venceMin, 15.1)

        const r = await estado(
            client.post('/api/v1/integraciones/horus/conexion/canjear').json(canje(codigo)),
            200,
        )
        const cuerpo = r.body()
        assert.match(cuerpo.token, /^atk_/)
        assert.equal(cuerpo.webhook.url, `${ARGOS}${RUTA_RECEPTOR}`)
        assert.match(cuerpo.webhook.secreto, /^whsec_/)
        assert.match(cuerpo.conector_id, /^argos_/)

        // guardado cifrado y apagado
        const conector = await db.from('integraciones.horus_conector').where('id', 1).first()
        assert.isFalse(conector.activo)
        assert.equal(conector.url_base, 'https://horus.isp.example')
        assert.equal(descifrar(conector.token_cifrado), TOKEN_HORUS)
        assert.equal(descifrar(conector.webhook_entrada_secreto_cifrado), cuerpo.webhook.secreto)
        assert.equal(descifrar(conector.webhook_salida_secreto_cifrado), SECRETO_SALIDA)

        // el token de Argos sirve para leer (§1.2) y no para más
        const servicioId = await crearServicio(await crearCliente())
        await estado(client.get(`/api/v1/servicios/${servicioId}`).bearerToken(cuerpo.token), 200)
        await estado(client.get('/api/v1/integraciones/horus').bearerToken(cuerpo.token), 403)
        // lo emitió A1: usuario técnico Horus con el rol integracion_horus
        const dueno = await db
            .from('core.tokens_api as t')
            .join('core.usuarios as u', 'u.id', 't.usuario_id')
            .join('core.usuarios_roles as ur', 'ur.usuario_id', 'u.id')
            .join('core.roles as r', 'r.id', 'ur.role_id')
            .where('t.id', conector.token_argos_id)
            .select('u.email', 'r.nombre as rol', 't.alcances')
        assert.deepEqual(
            dueno.map((d: { rol: string }) => d.rol),
            ['integracion_horus'],
        )
        assert.equal(dueno[0].email, 'horus@integraciones.argosisp.local')
        assert.sameMembers(dueno[0].alcances.permisos, [
            'ip.resolver',
            'clientes.ver',
            'servicios.ver',
            'sso.emitir',
        ])

        // un solo uso
        await estado(client.post('/api/v1/integraciones/horus/conexion/canjear').json(canje(codigo)), 410)

        // auditado sin secretos ni el código
        const acciones = await db
            .from('audit.acciones')
            .whereIn('accion', ['horus.canjear_enlace', 'horus.generar_enlace'])
        const cambios = await db.from('audit.cambios').where('entidad_tipo', 'conector_horus')
        const texto = JSON.stringify([acciones, cambios])
        assert.isAbove(acciones.length, 2)
        for (const secreto of [codigo, TOKEN_HORUS, SECRETO_SALIDA, cuerpo.token, cuerpo.webhook.secreto]) {
            assert.notInclude(texto, secreto)
        }
    })

    test('código vencido o inexistente → 410; datos inválidos → 422 y el código sigue valiendo; nuevo canje revoca el token anterior', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        await estado(
            client.post('/api/v1/integraciones/horus/conexion/canjear').json(canje('x'.repeat(43))),
            410,
        )

        const vencido = await cuerpoDe(
            client.post('/api/v1/integraciones/horus/enlace').bearerToken(admin),
            201,
        )
        await db.from('integraciones.horus_enlaces').update({ vence_en: new Date(Date.now() - 1000) })
        await estado(
            client
                .post('/api/v1/integraciones/horus/conexion/canjear')
                .json(canje(vencido.enlace.split('#')[1])),
            410,
        )

        const enlace1 = await cuerpoDe(
            client.post('/api/v1/integraciones/horus/enlace').bearerToken(admin),
            201,
        )
        const codigo1 = enlace1.enlace.split('#')[1]
        delete process.env.HORUS_PERMITIR_HTTP
        await estado(
            client
                .post('/api/v1/integraciones/horus/conexion/canjear')
                .json(canje(codigo1, { base_url: 'http://horus.local' })),
            422,
        )
        const primero = await cuerpoDe(
            client.post('/api/v1/integraciones/horus/conexion/canjear').json(canje(codigo1)),
            200,
        )

        const enlace2 = await cuerpoDe(
            client.post('/api/v1/integraciones/horus/enlace').bearerToken(admin),
            201,
        )
        await estado(
            client
                .post('/api/v1/integraciones/horus/conexion/canjear')
                .json(canje(enlace2.enlace.split('#')[1])),
            200,
        )
        const servicioId = await crearServicio(await crearCliente())
        await estado(client.get(`/api/v1/servicios/${servicioId}`).bearerToken(primero.token), 401)
        assert.isNotNull(
            await db.from('core.tokens_api').where('hash', '!=', '').whereNotNull('revocado_en').first(),
        )
    })

    test('conectar con enlace de Horus: Argos manda su atk_ y su receptor, guarda lo de Horus apagado; 410 de Horus → 422 sin token', async ({
        client,
        assert,
    }) => {
        const horus = await new HorusSimulado().iniciar()
        try {
            const { token: admin } = await usuarioConRoles(['admin'])
            horus.responder(RUTA_CANJE_HORUS, () => ({
                status: 200,
                cuerpo: {
                    token: TOKEN_HORUS,
                    webhook: {
                        url: `${horus.url}/api/v1/integrations/argosisp/webhook/c-1`,
                        secreto: SECRETO_SALIDA,
                    },
                    conector_id: 'hc_1',
                },
            }))
            const r = await estado(
                client
                    .post('/api/v1/integraciones/horus/conexion/conectar')
                    .bearerToken(admin)
                    .json({ enlace: `${horus.url}/conectar#${'Q'.repeat(43)}` }),
                200,
            )
            assert.containsSubset(r.body(), {
                activo: false,
                url_base: horus.url,
                token: '***',
                webhook_salida_secreto: '***',
            })
            const enviado = horus.de(RUTA_CANJE_HORUS)[0]!.json
            assert.containsSubset(enviado, {
                codigo: 'Q'.repeat(43),
                sistema: 'argosisp',
                base_url: ARGOS,
                webhook: { url: `${ARGOS}${RUTA_RECEPTOR}` },
            })
            assert.match(enviado.token, /^atk_/)
            const conector = await db.from('integraciones.horus_conector').where('id', 1).first()
            assert.equal(descifrar(conector.webhook_entrada_secreto_cifrado), enviado.webhook.secreto)
            assert.equal(descifrar(conector.token_cifrado), TOKEN_HORUS)
            const auditoria = JSON.stringify(
                await db.from('audit.acciones').where('accion', 'horus.conectar_enlace'),
            )
            assert.notInclude(auditoria, 'Q'.repeat(43))

            const tokens = await contar('core.tokens_api')
            horus.responder(RUTA_CANJE_HORUS, () => ({ status: 410, cuerpo: { error: 'gone' } }))
            const vencido = await estado(
                client
                    .post('/api/v1/integraciones/horus/conexion/conectar')
                    .bearerToken(admin)
                    .json({ enlace: `${horus.url}/conectar#${'R'.repeat(43)}` }),
                422,
            )
            assert.equal(vencido.body().type, 'urn:argosisp:problema:enlace_vencido')
            assert.equal(await contar('core.tokens_api'), tokens)

            await estado(
                client
                    .post('/api/v1/integraciones/horus/conexion/conectar')
                    .bearerToken(admin)
                    .json({ enlace: 'no-es-enlace' }),
                422,
            )
        } finally {
            await horus.detener()
        }
    })

    test('Ver en Horus: el servidor pide el ticket con hf_pat_ y devuelve solo la URL; apagado 422; sin permiso 403', async ({
        client,
        assert,
    }) => {
        const horus = await new HorusSimulado().iniciar()
        try {
            const { usuario, token: admin } = await usuarioConRoles(['admin'])
            const servicioId = await crearServicio(await crearCliente())
            await fijarConector({ url_base: horus.url })
            horus.responder(RUTA_TICKETS_HORUS, () => ({
                status: 201,
                cuerpo: { url: `${horus.url}/sso/entrar#ticket-1`, expira_en: '2026-10-17T10:01:00Z' },
            }))
            const r = await estado(
                client
                    .post('/api/v1/integraciones/horus/abrir')
                    .bearerToken(admin)
                    .json({ destino: { tipo: 'servicio', id_externo: String(servicioId) } }),
                200,
            )
            assert.deepEqual(r.body(), {
                url: `${horus.url}/sso/entrar#ticket-1`,
                expira_en: '2026-10-17T10:01:00Z',
            })
            const pedido = horus.de(RUTA_TICKETS_HORUS)[0]!
            assert.equal(pedido.cabeceras.authorization, `Bearer ${TOKEN_HORUS}`)
            assert.deepEqual(pedido.json, {
                usuario: { id_externo: `u-${usuario.id}`, correo: usuario.email, nombre: usuario.nombre },
                destino: { tipo: 'servicio', id_externo: String(servicioId) },
            })
            const auditada = await db
                .from('audit.acciones')
                .where('accion', 'horus.abrir')
                .where('actor_id', usuario.id)
                .first()
            assert.equal(auditada.entidad_id, servicioId)

            // URL de otro sitio: no se abre
            horus.responder(RUTA_TICKETS_HORUS, () => ({
                status: 201,
                cuerpo: { url: 'https://malo.example/x' },
            }))
            await estado(
                client
                    .post('/api/v1/integraciones/horus/abrir')
                    .bearerToken(admin)
                    .json({ destino: { tipo: 'router', id_externo: '3' } }),
                502,
            )

            const { token: soporte } = await usuarioConRoles(['soporte'])
            await estado(
                client
                    .post('/api/v1/integraciones/horus/abrir')
                    .bearerToken(soporte)
                    .json({ destino: { tipo: 'router', id_externo: '3' } }),
                403,
            )
            await fijarConector({ activo: false, url_base: horus.url })
            await estado(
                client
                    .post('/api/v1/integraciones/horus/abrir')
                    .bearerToken(admin)
                    .json({ destino: { tipo: 'hallazgo', id_externo: 'f-1' } }),
                422,
            )
        } finally {
            await horus.detener()
        }
    })
    test('el enlace abierto en el navegador lleva a la página /conectar del panel; el canje sigue en la API', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const generado = await estado(
            client.post('/api/v1/integraciones/horus/enlace').bearerToken(admin),
            201,
        )
        const enlace = new URL(generado.body().enlace)
        // Horus canjea en <host del enlace>/api/v1/…: el host es el de la API (contrato §1.4)
        assert.equal(enlace.origin, ARGOS)
        assert.equal(enlace.pathname, '/conectar')

        // el navegador pide la ruta sin el fragmento: 302 a la página del panel
        const abierto = await client.get(enlace.pathname).redirects(0)
        abierto.assertStatus(302)
        assert.equal(abierto.header('location'), `${PANEL}/conectar`)

        // sin PANEL_URL_PUBLICA, en desarrollo, el panel local
        delete process.env.PANEL_URL_PUBLICA
        const local = await client.get('/conectar').redirects(0)
        local.assertStatus(302)
        assert.equal(local.header('location'), 'http://localhost:3000/conectar')

        // el código sigue sirviendo para el canje en la API
        const codigo = generado.body().enlace.split('#')[1]!
        await estado(client.post('/api/v1/integraciones/horus/conexion/canjear').json(canje(codigo)), 200)
    })

    test('estado del conector con horus.abrir sin horus.ver: solo activo y pausa, sin secretos', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConPermisos(['horus.abrir'])
        // con horus.abrir no se ve la configuración…
        await estado(client.get('/api/v1/integraciones/horus').bearerToken(token), 403)

        // …pero sí el estado: sin conector, apagado
        const sinConector = await estado(
            client.get('/api/v1/integraciones/horus/estado').bearerToken(token),
            200,
        )
        assert.deepEqual(sinConector.body(), { activo: false, reintentar_en: null })

        await fijarConector({ url_base: 'https://horus.isp.example' })
        const encendido = await estado(
            client.get('/api/v1/integraciones/horus/estado').bearerToken(token),
            200,
        )
        assert.deepEqual(encendido.body(), { activo: true, reintentar_en: null })
        assert.notInclude(JSON.stringify(encendido.body()), 'hf_pat_')
        assert.notInclude(JSON.stringify(encendido.body()), 'horus.isp.example')

        // en pausa por la espera exponencial: hasta cuándo
        const pausa = new Date(Date.now() + 5 * 60_000)
        await db
            .from('integraciones.horus_salud')
            .where('id', 1)
            .update({ fallos_seguidos: 3, pausa_hasta: pausa })
        const enPausa = await estado(client.get('/api/v1/integraciones/horus/estado').bearerToken(token), 200)
        assert.deepEqual(enPausa.body(), { activo: true, reintentar_en: pausa.toISOString() })

        await fijarConector({ activo: false, url_base: 'https://horus.isp.example' })
        const apagado = await estado(client.get('/api/v1/integraciones/horus/estado').bearerToken(token), 200)
        assert.deepEqual(apagado.body(), { activo: false, reintentar_en: null })

        // sin horus.abrir: 403
        const { token: soporte } = await usuarioConRoles(['soporte'])
        await estado(client.get('/api/v1/integraciones/horus/estado').bearerToken(soporte), 403)
    })

    test('Horus en pausa: detail con la hora de Guatemala y reintentar_en (ISO UTC) en el problem+json y en las lecturas', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const servicioId = await crearServicio(await crearCliente())
        await fijarConector({ url_base: 'https://horus.isp.example' })
        // 20:33:04 UTC = 14:33 en Guatemala (UTC−6, sin horario de verano)
        const pausa = new Date('2099-10-17T20:33:04.119Z')
        await db.from('integraciones.horus_salud').where('id', 1).update({
            fallos_seguidos: 4,
            pausa_hasta: pausa,
            ultimo_error: 'Horus respondió 503: mantenimiento',
        })

        const abrir = await estado(
            client
                .post('/api/v1/integraciones/horus/abrir')
                .bearerToken(admin)
                .json({ destino: { tipo: 'servicio', id_externo: String(servicioId) } }),
            502,
        )
        assert.equal(abrir.body().reintentar_en, '2099-10-17T20:33:04.119Z')
        assert.include(
            abrir.body().detail,
            'se reintenta después de las 17/10/2099 14:33 (hora de Guatemala)',
        )
        assert.notInclude(abrir.body().detail, '2099-10-17T')

        const ficha = await estado(
            client.get(`/api/v1/servicios/${servicioId}/horus`).bearerToken(admin),
            200,
        )
        assert.equal(ficha.body().reintentar_en, '2099-10-17T20:33:04.119Z')
        assert.include(ficha.body().error, '14:33 (hora de Guatemala)')

        const seguridad = await estado(
            client
                .post('/api/v1/integraciones/horus/seguridad')
                .bearerToken(admin)
                .json({ servicio_ids: [servicioId] }),
            200,
        )
        assert.equal(seguridad.body().reintentar_en, '2099-10-17T20:33:04.119Z')

        const consumo = await estado(
            client.get(`/api/v1/servicios/${servicioId}/horus/consumo`).bearerToken(admin),
            200,
        )
        assert.equal(consumo.body().reintentar_en, '2099-10-17T20:33:04.119Z')

        // sin pausa, el campo va en null
        await db.from('integraciones.horus_salud').where('id', 1).update({ pausa_hasta: null })
        await fijarConector({ activo: false, url_base: 'https://horus.isp.example' })
        const apagada = await estado(
            client.get(`/api/v1/servicios/${servicioId}/horus`).bearerToken(admin),
            200,
        )
        assert.isNull(apagada.body().reintentar_en)
    })
    test('la primera falla ya trae reintentar_en (la pausa que acaba de abrir) en abrir, 360, consumo y seguridad', async ({
        client,
        assert,
    }) => {
        const horus = await new HorusSimulado().iniciar()
        try {
            const { token: admin } = await usuarioConRoles(['admin'])
            const servicioId = await crearServicio(await crearCliente())
            const caido = () => ({ status: 503, cuerpo: { detail: 'mantenimiento' } })
            for (const ruta of [
                RUTA_TICKETS_HORUS,
                '/api/v1/integrations/ip-lookup',
                '/api/v1/integrations/consumption',
                '/api/v1/integrations/security-states',
            ]) {
                horus.responder(ruta, caido)
            }

            /** Conector limpio (sin pausa), una llamada que falla y la pausa que dejó. */
            async function primeraFalla(pedir: () => PromiseLike<any>, status: number) {
                await fijarConector({ url_base: horus.url })
                const r = await estado(pedir(), status)
                const salud = await db.from('integraciones.horus_salud').where('id', 1).first()
                assert.equal(salud.fallos_seguidos, 1)
                return { cuerpo: r.body(), pausa: new Date(salud.pausa_hasta).toISOString() }
            }

            const abrir = await primeraFalla(
                () =>
                    client
                        .post('/api/v1/integraciones/horus/abrir')
                        .bearerToken(admin)
                        .json({ destino: { tipo: 'servicio', id_externo: String(servicioId) } }),
                502,
            )
            assert.equal(abrir.cuerpo.reintentar_en, abrir.pausa)
            assert.include(
                abrir.cuerpo.detail,
                'Horus respondió 503: mantenimiento; se reintenta después de las ',
            )
            assert.include(abrir.cuerpo.detail, '(hora de Guatemala)')

            const ficha = await primeraFalla(
                () => client.get(`/api/v1/servicios/${servicioId}/horus`).bearerToken(admin),
                200,
            )
            assert.equal(ficha.cuerpo.reintentar_en, ficha.pausa)
            assert.include(ficha.cuerpo.error, '(hora de Guatemala)')

            const consumo = await primeraFalla(
                () => client.get(`/api/v1/servicios/${servicioId}/horus/consumo`).bearerToken(admin),
                200,
            )
            assert.equal(consumo.cuerpo.reintentar_en, consumo.pausa)

            const seguridad = await primeraFalla(
                () =>
                    client
                        .post('/api/v1/integraciones/horus/seguridad')
                        .bearerToken(admin)
                        .json({ servicio_ids: [servicioId] }),
                200,
            )
            assert.equal(seguridad.cuerpo.reintentar_en, seguridad.pausa)

            // un 4xx de Horus no abre pausa: sin reintentar_en
            horus.responder(RUTA_TICKETS_HORUS, () => ({ status: 403, cuerpo: { detail: 'sin scope' } }))
            await fijarConector({ url_base: horus.url })
            const prohibido = await estado(
                client
                    .post('/api/v1/integraciones/horus/abrir')
                    .bearerToken(admin)
                    .json({ destino: { tipo: 'router', id_externo: '3' } }),
                502,
            )
            assert.isUndefined(prohibido.body().reintentar_en)
            assert.equal(prohibido.body().detail, 'Horus respondió 403: sin scope')
        } finally {
            await horus.detener()
        }
    })
})
