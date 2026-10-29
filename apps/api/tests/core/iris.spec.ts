import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { descifrar, cifrar } from '#shared/cifrado'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'
import { HorusSimulado } from '#tests/integraciones/horus_simulado'
import GenerarTokenIris from '#core/actions/generar_token_iris'
import GenerarTokenHorus from '#core/actions/generar_token_horus'
import { EMAIL_USUARIO_IRIS, PERMISOS_IRIS, ROL_IRIS } from '#core/integraciones_iris'
import { RUTA_TICKETS_IRIS } from '#integraciones/iris/actions/abrir_en_iris'
import { RUTA_RECEPTOR_IRIS, destinoWebhooksIris } from '#integraciones/iris/configuracion'

/**
 * Conector Iris (pedidos A2 y A8 de Iris, contrato `contratos/iris.md` §1): enlace de conexión,
 * usuario técnico, configuración, autologin en los dos sentidos, resolver y la interfaz de
 * webhooks para A6.
 */

const ARGOS = 'https://argos.isp.example'
const PANEL = 'https://panel.isp.example'
const BASE = '/api/v1/integraciones/iris'
const TOKEN_IRIS = `iris_pat_${'Zx9Yw8Vu'.repeat(5)}`
const SECRETO_IRIS = 'secreto-del-receptor-de-iris-0123456789'

function canje(codigo: string, extra: Record<string, unknown> = {}) {
    return {
        codigo,
        sistema: 'iris',
        base_url: 'https://iris.isp.example',
        token: TOKEN_IRIS,
        webhook: {
            url: 'https://iris.isp.example/api/v1/integraciones/argosisp/webhook/c-1',
            secreto: SECRETO_IRIS,
        },
        ...extra,
    }
}

async function limpiarIris() {
    await db.from('integraciones.iris_enlaces').delete()
    await db.from('integraciones.iris_conector').delete()
}

async function fijarConectorIris(datos: {
    activo?: boolean
    url_base?: string | null
    enlace?: number | null
}) {
    await limpiarIris()
    await db.table('integraciones.iris_conector').insert({
        id: 1,
        activo: datos.activo ?? true,
        url_base: datos.url_base ?? 'https://iris.isp.example',
        token_cifrado: cifrar(TOKEN_IRIS),
        webhook_salida_url: 'https://iris.isp.example/api/v1/integraciones/argosisp/webhook/c-1',
        webhook_salida_secreto_cifrado: cifrar(SECRETO_IRIS),
        token_argos_id: datos.enlace ?? null,
        conectado_por_enlace_en: datos.enlace ? new Date() : null,
    })
}

async function generarEnlace(client: any, admin: string): Promise<string> {
    const r = await estado(client.post(`${BASE}/enlace`).bearerToken(admin), 201)
    return (r.body().enlace as string).split('#')[1]!
}

test.group('integraciones · iris', (group) => {
    group.each.setup(async () => {
        process.env.API_PUBLIC_URL = ARGOS
        process.env.PANEL_URL_PUBLICA = PANEL
        await limpiarIris()
        return async () => {
            await limpiarIris()
            delete process.env.API_PUBLIC_URL
            delete process.env.PANEL_URL_PUBLICA
            delete process.env.IRIS_PERMITIR_HTTP
        }
    })

    test('enlace: Iris canjea una vez; atk_ del usuario técnico Iris con los permisos de §1.1; conector apagado', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const generado = await estado(client.post(`${BASE}/enlace`).bearerToken(admin), 201)
        assert.match(generado.body().enlace, /^https:\/\/argos\.isp\.example\/conectar#[A-Za-z0-9_-]{43}$/)
        const codigo = (generado.body().enlace as string).split('#')[1]!
        const fila = await db.from('integraciones.iris_enlaces').firstOrFail()
        assert.notInclude(JSON.stringify(fila), codigo)

        const r = await estado(client.post(`${BASE}/conexion/canjear`).json(canje(codigo)), 200)
        const cuerpo = r.body()
        assert.match(cuerpo.token, /^atk_/)
        assert.equal(cuerpo.webhook.url, `${ARGOS}${RUTA_RECEPTOR_IRIS}`)
        assert.match(cuerpo.webhook.secreto, /^whsec_/)
        assert.match(cuerpo.conector_id, /^argos_/)

        const conector = await db.from('integraciones.iris_conector').where('id', 1).firstOrFail()
        assert.isFalse(conector.activo)
        assert.equal(conector.url_base, 'https://iris.isp.example')
        assert.equal(descifrar(conector.token_cifrado), TOKEN_IRIS)
        assert.equal(descifrar(conector.webhook_salida_secreto_cifrado), SECRETO_IRIS)
        assert.isNotNull(conector.conectado_por_enlace_en)

        const dueno = await db
            .from('core.tokens_api as t')
            .join('core.usuarios as u', 'u.id', 't.usuario_id')
            .join('core.usuarios_roles as ur', 'ur.usuario_id', 'u.id')
            .join('core.roles as r', 'r.id', 'ur.role_id')
            .where('t.id', conector.token_argos_id)
            .select('u.email', 'r.nombre as rol', 't.alcances')
        assert.deepEqual(
            dueno.map((d: { rol: string }) => d.rol),
            [ROL_IRIS],
        )
        assert.equal(dueno[0].email, EMAIL_USUARIO_IRIS)
        assert.sameMembers(dueno[0].alcances.permisos, [...PERMISOS_IRIS])
        for (const permiso of [
            'servicios.activar_instalacion',
            'servicios.crear',
            'clientes.crear',
            'sso.emitir',
        ]) {
            assert.include(dueno[0].alcances.permisos, permiso)
        }

        // con el conector apagado el token igual autentica; no sirve para configurar Iris
        await estado(client.get(BASE).bearerToken(cuerpo.token), 403)

        // la misma petición repetida recibe la misma respuesta; otra, 410
        const repetida = await estado(client.post(`${BASE}/conexion/canjear`).json(canje(codigo)), 200)
        assert.deepEqual(repetida.body(), cuerpo)
        await estado(
            client
                .post(`${BASE}/conexion/canjear`)
                .json(canje(codigo, { token: `iris_pat_${'Q'.repeat(40)}` })),
            410,
        )

        // un canje nuevo revoca el atk_ del anterior
        const codigo2 = await generarEnlace(client, admin)
        await estado(client.post(`${BASE}/conexion/canjear`).json(canje(codigo2)), 200)
        const viejo = await db.from('core.tokens_api').where('id', conector.token_argos_id).firstOrFail()
        assert.isNotNull(viejo.revocado_en)

        // auditado sin secretos ni el código
        const acciones = await db
            .from('audit.acciones')
            .whereIn('accion', ['iris.canjear_enlace', 'iris.generar_enlace'])
        const cambios = await db.from('audit.cambios').where('entidad_tipo', 'conector_iris')
        const texto = JSON.stringify([acciones, cambios])
        for (const secreto of [codigo, TOKEN_IRIS, SECRETO_IRIS, cuerpo.token, cuerpo.webhook.secreto]) {
            assert.notInclude(texto, secreto)
        }
    })

    test('canje: código desconocido, vencido o anulado → 410; sistema horus, token o URL inválidos → 422', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        await estado(client.post(`${BASE}/conexion/canjear`).json(canje('x'.repeat(43))), 410)

        const anulado = await generarEnlace(client, admin)
        const vigente = await generarEnlace(client, admin)
        await estado(client.post(`${BASE}/conexion/canjear`).json(canje(anulado)), 410)

        const r = await estado(
            client
                .post(`${BASE}/conexion/canjear`)
                .json(
                    canje(vigente, { sistema: 'horus', token: 'hf_pat_xx', base_url: 'http://iris.local' }),
                ),
            422,
        )
        assert.sameMembers(
            r.body().errors.map((e: { field: string }) => e.field),
            ['sistema', 'token', 'base_url'],
        )
        // el código sigue valiendo tras un 422
        await estado(client.post(`${BASE}/conexion/canjear`).json(canje(vigente)), 200)

        const vencido = await generarEnlace(client, admin)
        await db
            .from('integraciones.iris_enlaces')
            .whereNull('usado_en')
            .update({ vence_en: new Date(Date.now() - 1000) })
        await estado(client.post(`${BASE}/conexion/canjear`).json(canje(vencido)), 410)
    })

    test('el atk_ de Iris activa una instalación y resuelve IPs; nada fuera de §1.1', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const { token } = await new GenerarTokenIris().execute({}, contextoPrueba())
        const escenario = await crearEscenarioRouter()
        const alta = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .header('Idempotency-Key', `iris:servicio:${unico('p')}`)
                .json({
                    plantilla_facturacion_id: null,
                    cliente_id: await crearClienteFila(),
                    router_id: escenario.routerId,
                    plan_id: await crearPlanFila(),
                    estado_inicial: 'pendiente_instalacion',
                }),
            201,
        )
        const s = alta.body()
        const activo = await estado(
            client
                .post(`/api/v1/servicios/${s.id}/activar-instalacion`)
                .bearerToken(token)
                .header('Idempotency-Key', `iris:instalacion:${unico('o')}`)
                .json({ version: s.version, origen_tipo: 'iris_orden', origen_id: '77' }),
            200,
        )
        assert.equal(activo.body().estado, 'activo')

        const resuelto = await estado(
            client
                .post(`${BASE}/resolver`)
                .bearerToken(token)
                .json({ ips: [s.ipv4, '203.0.113.250'] }),
            200,
        )
        assert.equal(resuelto.body().resultados[0].servicio_id, s.id)
        assert.equal(resuelto.body().resultados[1].error, 'no_encontrada')

        // fuera de §1.1
        await estado(
            client.post(`/api/v1/servicios/${s.id}/suspender`).bearerToken(token).json({ motivo: 'no debe' }),
            403,
        )
        await estado(client.get(BASE).bearerToken(token), 403)
        // el admin ve los tokens de Iris (sin valor)
        const tokens = await estado(client.get(`${BASE}/tokens`).bearerToken(admin), 200)
        assert.isAbove(tokens.body().length, 0)
        assert.notProperty(tokens.body()[0], 'token')
    })

    test('configurar a mano: secretos de solo escritura, encender exige URL y token, 409 por versión', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const vacio = await estado(client.get(BASE).bearerToken(admin), 200)
        assert.isFalse(vacio.body().activo)
        assert.equal(vacio.body().version, 0)

        const sinToken = await estado(
            client
                .put(BASE)
                .bearerToken(admin)
                .json({ version: 0, activo: true, url_base: 'https://iris.isp.example' }),
            422,
        )
        assert.equal(sinToken.body().errors[0].field, 'activo')

        const malo = await estado(
            client.put(BASE).bearerToken(admin).json({ version: 0, token: 'hf_pat_123' }),
            422,
        )
        assert.equal(malo.body().errors[0].field, 'token')

        const ok = await estado(
            client.put(BASE).bearerToken(admin).json({
                version: 0,
                activo: true,
                url_base: 'https://iris.isp.example/api/v1',
                token: TOKEN_IRIS,
            }),
            200,
        )
        assert.include(ok.body(), {
            activo: true,
            url_base: 'https://iris.isp.example',
            token: '***',
            version: 1,
        })

        await estado(client.put(BASE).bearerToken(admin).json({ version: 0, activo: false }), 409)

        const cambios = await db.from('audit.cambios').where('entidad_tipo', 'conector_iris')
        assert.notInclude(JSON.stringify(cambios), TOKEN_IRIS)

        // soporte no configura
        const { token: soporte } = await usuarioConRoles(['soporte'])
        await estado(client.put(BASE).bearerToken(soporte).json({ version: 1, activo: false }), 403)
    })

    test('autologin con Argos de destino: solo el atk_ de Iris; con enlace, solo el del canje y encendido', async ({
        client,
        assert,
    }) => {
        const iris = await new GenerarTokenIris().execute({}, contextoPrueba())
        const horus = await new GenerarTokenHorus().execute({}, contextoPrueba())
        const cuerpo = {
            usuario: { id_externo: 'u-9', correo: 'ana@isp.gt', nombre: 'Ana' },
            destino: { tipo: 'cliente', id_externo: String(await crearClienteFila()) },
        }

        const r = await estado(client.post(`${BASE}/sso/tickets`).bearerToken(iris.token).json(cuerpo), 201)
        assert.match(r.body().url, /^https:\/\/panel\.isp\.example\/sso\/entrar#.{16,}$/)
        const ticket = await db.from('core.sso_tickets').orderBy('id', 'desc').firstOrFail()
        assert.equal(ticket.conector, 'iris')
        assert.equal(Number(ticket.token_api_id), Number(iris.datos.id))

        // tokens cruzados: el de Horus no pide tickets de Iris ni al revés
        await estado(client.post(`${BASE}/sso/tickets`).bearerToken(horus.token).json(cuerpo), 403)
        await estado(
            client.post('/api/v1/integraciones/horus/sso/tickets').bearerToken(iris.token).json(cuerpo),
            403,
        )

        // conector preparado con enlace: solo el atk_ del canje, y 409 mientras esté apagado
        const otro = await new GenerarTokenIris().execute({}, contextoPrueba())
        await fijarConectorIris({ activo: false, enlace: Number(iris.datos.id) })
        const apagado = await estado(
            client.post(`${BASE}/sso/tickets`).bearerToken(iris.token).json(cuerpo),
            409,
        )
        assert.equal(apagado.body().type, 'urn:argosisp:problema:iris_apagado')
        await estado(client.post(`${BASE}/sso/tickets`).bearerToken(otro.token).json(cuerpo), 403)
        await db.from('integraciones.iris_conector').update({ activo: true })
        await estado(client.post(`${BASE}/sso/tickets`).bearerToken(iris.token).json(cuerpo), 201)

        // el canje del ticket en el panel acepta el conector iris (sin vinculación: pide login)
        const nuevo = await estado(
            client.post(`${BASE}/sso/tickets`).bearerToken(iris.token).json(cuerpo),
            201,
        )
        const canjeado = await estado(
            client
                .post('/api/v1/auth/sso/canjear')
                .json({ ticket: (nuevo.body().url as string).split('#')[1] }),
            200,
        )
        assert.equal(canjeado.body().conector, 'iris')
    })

    test('Ver en Iris: el servidor pide el ticket con el iris_pat_; apagado 422; error o URL inválida 502', async ({
        client,
        assert,
    }) => {
        process.env.IRIS_PERMITIR_HTTP = 'true'
        const { token: admin, usuario } = await usuarioConRoles(['admin'])
        const destino = { tipo: 'orden', id_externo: 'ord-42' }

        const apagado = await estado(client.post(`${BASE}/abrir`).bearerToken(admin).json({ destino }), 422)
        assert.equal(apagado.body().type, 'urn:argosisp:problema:iris_apagado')
        const estadoApagado = await estado(client.get(`${BASE}/estado`).bearerToken(admin), 200)
        assert.isFalse(estadoApagado.body().activo)

        const simulado = await new HorusSimulado().iniciar()
        try {
            await fijarConectorIris({ url_base: simulado.url })
            simulado.responder(RUTA_TICKETS_IRIS, () => ({
                status: 201,
                cuerpo: {
                    url: `https://iris-panel.isp.example/sso/entrar#${'t'.repeat(43)}`,
                    expira_en: '2026-10-28T20:00:00Z',
                },
            }))
            const r = await estado(client.post(`${BASE}/abrir`).bearerToken(admin).json({ destino }), 200)
            assert.equal(r.body().url, `https://iris-panel.isp.example/sso/entrar#${'t'.repeat(43)}`)
            const pedido = simulado.de(RUTA_TICKETS_IRIS)[0]!
            assert.equal(pedido.cabeceras.authorization, `Bearer ${TOKEN_IRIS}`)
            assert.deepEqual(pedido.json, {
                usuario: { id_externo: `u-${usuario.id}`, correo: usuario.email, nombre: usuario.nombre },
                destino,
            })

            simulado.responder(RUTA_TICKETS_IRIS, () => ({
                status: 201,
                cuerpo: { url: 'https://iris.example/otra#x' },
            }))
            const invalida = await estado(
                client.post(`${BASE}/abrir`).bearerToken(admin).json({ destino }),
                502,
            )
            assert.equal(invalida.body().type, 'urn:argosisp:problema:iris_error')

            simulado.responder(RUTA_TICKETS_IRIS, () => ({
                status: 500,
                cuerpo: { detail: 'Iris en mantenimiento' },
            }))
            const caida = await estado(client.post(`${BASE}/abrir`).bearerToken(admin).json({ destino }), 502)
            assert.include(caida.body().detail, 'Iris en mantenimiento')

            await estado(
                client
                    .post(`${BASE}/abrir`)
                    .bearerToken(admin)
                    .json({ destino: { tipo: 'cliente', id_externo: '1' } }),
                422,
            )
            const { token: cajero } = await usuarioConRoles(['cajero'])
            await estado(client.post(`${BASE}/abrir`).bearerToken(cajero).json({ destino }), 403)
        } finally {
            await simulado.detener()
        }
    })

    test('destinoWebhooksIris (interfaz para A6): null apagado o sin receptor; url, secreto y conector_id encendido', async ({
        assert,
    }) => {
        assert.isNull(await destinoWebhooksIris())
        await fijarConectorIris({ activo: false })
        assert.isNull(await destinoWebhooksIris())
        await db.from('integraciones.iris_conector').update({ activo: true })
        const destino = await destinoWebhooksIris()
        const fila = await db.from('integraciones.iris_conector').firstOrFail()
        assert.deepEqual(destino, {
            url: 'https://iris.isp.example/api/v1/integraciones/argosisp/webhook/c-1',
            secreto: SECRETO_IRIS,
            conector_id: fila.conector_id,
        })
        await db.from('integraciones.iris_conector').update({ webhook_salida_url: null })
        assert.isNull(await destinoWebhooksIris())
    })
})
