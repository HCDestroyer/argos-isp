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
        await limpiarHorus()
        return async () => {
            await limpiarHorus()
            delete process.env.HORUS_PERMITIR_HTTP
            delete process.env.API_PUBLIC_URL
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
})
