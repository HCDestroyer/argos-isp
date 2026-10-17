import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { crearCliente, crearServicio } from '#tests/notify/ayudas_notify'
import { crearEmpresaFila } from '#tests/core/fabricas'
import { configHorus, invalidarConfigHorus } from '#integraciones/horus/configuracion'
import {
    HorusSimulado,
    SECRETO_SALIDA,
    TOKEN_HORUS,
    fijarConector,
    limpiarHorus,
    urlSinServidor,
} from '#tests/integraciones/horus_simulado'

/**
 * Conector Horus: configuración desde el panel (secretos como `***`, en la respuesta y en la
 * auditoría), prueba de conexión, consulta 360 con caída a la IP, consumo, seguridad por lotes y
 * degradación (`stale` con el último dato y espera exponencial). Horus es un servidor local.
 */

const RUTA_360 = '/api/v1/integrations/ip-lookup'
const RUTA_CONSUMO = '/api/v1/integrations/consumption'
const RUTA_SEGURIDAD = '/api/v1/integrations/security-states'

async function servicioConIp(empresaId = 1) {
    const clienteId = await crearCliente()
    const servicioId = await crearServicio(clienteId, undefined, empresaId)
    const ip = `100.127.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`
    const servicio = (await db.from('core.servicios').where('id', servicioId).first()) as {
        router_id: number
    }
    await db.table('network.sesiones').insert({
        servicio_id: servicioId,
        router_id: servicio.router_id,
        nas_ip: '10.9.9.9',
        acct_session_id: `s-${servicioId}`,
        user_ppp: `ppp-${servicioId}`,
        ipv4: ip,
    })
    return { servicioId, clienteId, ip }
}

test.group('integraciones · horus · configuración', (group) => {
    group.each.setup(async () => {
        process.env.HORUS_PERMITIR_HTTP = 'true'
        await limpiarHorus()
        return async () => {
            await limpiarHorus()
            delete process.env.HORUS_PERMITIR_HTTP
        }
    })

    test('apagado por defecto; admin guarda con version 0 y los secretos salen como *** (también en la auditoría)', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const inicial = await estado(client.get('/api/v1/integraciones/horus').bearerToken(admin), 200)
        assert.containsSubset(inicial.body(), { activo: false, version: 0, token: null })

        const guardado = await estado(
            client.put('/api/v1/integraciones/horus').bearerToken(admin).json({
                version: 0,
                url_base: 'https://horus.isp.example/',
                token: TOKEN_HORUS,
                webhook_salida_url: 'https://horus.isp.example/api/v1/integrations/argosisp/webhook/c1',
                webhook_salida_secreto: SECRETO_SALIDA,
            }),
            200,
        )
        const cuerpo = guardado.body()
        assert.containsSubset(cuerpo, {
            activo: false,
            url_base: 'https://horus.isp.example',
            token: '***',
            webhook_salida_secreto: '***',
            webhook_entrada_secreto: '***',
            version: 1,
        })
        // el secreto del receptor de Argos se muestra una sola vez
        assert.match(cuerpo.webhook_entrada_secreto_nuevo, /^whsec_/)
        const texto = JSON.stringify(cuerpo)
        assert.notInclude(texto, TOKEN_HORUS)
        assert.notInclude(texto, SECRETO_SALIDA)

        const otraVez = await estado(client.get('/api/v1/integraciones/horus').bearerToken(admin), 200)
        assert.notProperty(otraVez.body(), 'webhook_entrada_secreto_nuevo')
        assert.notInclude(JSON.stringify(otraVez.body()), cuerpo.webhook_entrada_secreto_nuevo)

        // en la base, cifrados
        const fila = await db.from('integraciones.horus_conector').where('id', 1).first()
        assert.match(fila.token_cifrado, /^v1\./)
        assert.notInclude(JSON.stringify(fila), TOKEN_HORUS)

        // auditoría y outbox sin secretos
        const acciones = await db.from('audit.acciones').where('accion', 'integraciones.horus.configurar')
        const cambios = await db.from('audit.cambios').where('entidad_tipo', 'conector_horus')
        const outbox = await db.from('audit.outbox').where('evento', 'horus.config_cambiada')
        const auditoria = JSON.stringify([acciones, cambios, outbox])
        assert.isAbove(acciones.length, 0)
        assert.isAbove(outbox.length, 0)
        assert.include(auditoria, '***')
        assert.notInclude(auditoria, TOKEN_HORUS)
        assert.notInclude(auditoria, SECRETO_SALIDA)
        assert.notInclude(auditoria, cuerpo.webhook_entrada_secreto_nuevo)
    })

    test('valida: solo https sin el flag de laboratorio, hf_pat_, encender exige URL y token, version 409', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        delete process.env.HORUS_PERMITIR_HTTP
        const http = await estado(
            client.put('/api/v1/integraciones/horus').bearerToken(admin).json({
                version: 0,
                url_base: 'http://horus.local',
                token: 'no-es-de-horus',
                activo: true,
            }),
            422,
        )
        const campos = (http.body().errors as Array<{ field: string }>).map((e) => e.field)
        assert.includeMembers(campos, ['url_base', 'token'])

        process.env.HORUS_PERMITIR_HTTP = 'true'
        await estado(
            client.put('/api/v1/integraciones/horus').bearerToken(admin).json({ version: 0, activo: true }),
            422,
        )
        await estado(
            client
                .put('/api/v1/integraciones/horus')
                .bearerToken(admin)
                .json({ version: 0, url_base: 'http://horus.local', token: TOKEN_HORUS, activo: true }),
            200,
        )
        await estado(
            client.put('/api/v1/integraciones/horus').bearerToken(admin).json({ version: 0, activo: false }),
            409,
        )
        // guardar invalida la caché de este proceso (regla 5): la próxima lectura ve lo nuevo
        const encendido = await configHorus()
        assert.isTrue(encendido.activo)
        await estado(
            client.put('/api/v1/integraciones/horus').bearerToken(admin).json({ version: 1, activo: false }),
            200,
        )
        const apagado = await configHorus()
        assert.isFalse(apagado.activo)
    })

    test('permisos: soporte no ve ni configura; admin tiene ver, configurar, probar y abrir', async ({
        client,
        assert,
    }) => {
        const { token: soporte } = await usuarioConRoles(['soporte'])
        await estado(client.get('/api/v1/integraciones/horus').bearerToken(soporte), 403)
        await estado(client.put('/api/v1/integraciones/horus').bearerToken(soporte).json({ version: 0 }), 403)
        await estado(client.post('/api/v1/integraciones/horus/probar').bearerToken(soporte), 403)
        const admin = (await db
            .from('core.roles_permisos as rp')
            .join('core.roles as r', 'r.id', 'rp.role_id')
            .join('core.permisos as p', 'p.id', 'rp.permiso_id')
            .where('r.nombre', 'admin')
            .whereLike('p.nombre', 'integraciones.horus.%')
            .select('p.nombre')) as Array<{ nombre: string }>
        assert.sameMembers(
            admin.map((p) => p.nombre),
            [
                'integraciones.horus.ver',
                'integraciones.horus.configurar',
                'integraciones.horus.probar',
                'integraciones.horus.abrir',
            ],
        )
    })

    test('probar conexión: muestra el error real, Bearer hf_pat_ y ping firmado al receptor', async ({
        client,
        assert,
    }) => {
        const horus = await new HorusSimulado().iniciar()
        try {
            const { token: admin } = await usuarioConRoles(['admin'])
            horus.responder('/api/v1/routers/status', () => ({
                status: 401,
                cuerpo: { detail: 'token revocado' },
            }))
            horus.responder('/webhook', () => ({ status: 200, cuerpo: { ok: true } }))
            await fijarConector({
                activo: false,
                url_base: horus.url,
                webhook_salida_url: `${horus.url}/webhook`,
                webhook_salida_secreto: SECRETO_SALIDA,
            })
            const fallo = await estado(
                client.post('/api/v1/integraciones/horus/probar').bearerToken(admin),
                200,
            )
            assert.isFalse(fallo.body().ok)
            assert.equal(fallo.body().api.status, 401)
            assert.include(fallo.body().api.error, 'token revocado')
            assert.isTrue(fallo.body().webhook.ok)
            assert.equal(
                horus.de('/api/v1/routers/status')[0]!.cabeceras.authorization,
                `Bearer ${TOKEN_HORUS}`,
            )
            const ping = horus.de('/webhook')[0]!
            assert.equal(ping.json.evento, 'ping')
            assert.match(String(ping.cabeceras['x-webhook-signature']), /^v1=[0-9a-f]{64}$/)

            horus.responder('/api/v1/routers/status', () => ({ status: 200, cuerpo: { items: [] } }))
            const ok = await estado(client.post('/api/v1/integraciones/horus/probar').bearerToken(admin), 200)
            assert.isTrue(ok.body().ok)
            const vista = await estado(client.get('/api/v1/integraciones/horus').bearerToken(admin), 200)
            assert.containsSubset(vista.body().ultima_prueba, { ok: true, error: null })

            // Horus caído: el error de red real
            await db
                .from('integraciones.horus_conector')
                .where('id', 1)
                .update({ url_base: await urlSinServidor() })
            invalidarConfigHorus()
            const caido = await estado(
                client.post('/api/v1/integraciones/horus/probar').bearerToken(admin),
                200,
            )
            assert.include(caido.body().api.error, 'ECONNREFUSED')
        } finally {
            await horus.detener()
        }
    })
})

test.group('integraciones · horus · lecturas y degradación', (group) => {
    group.each.setup(async () => {
        process.env.HORUS_PERMITIR_HTTP = 'true'
        await limpiarHorus()
        return async () => {
            await limpiarHorus()
            await soloEmpresaPrincipal()
            delete process.env.HORUS_PERMITIR_HTTP
        }
    })

    test('conector apagado: no hay ninguna llamada a Horus', async ({ client, assert }) => {
        const horus = await new HorusSimulado().iniciar()
        try {
            const { token: admin } = await usuarioConRoles(['admin'])
            const { servicioId } = await servicioConIp()
            await fijarConector({ activo: false, url_base: horus.url })
            const r360 = await estado(
                client.get(`/api/v1/servicios/${servicioId}/horus`).bearerToken(admin),
                200,
            )
            assert.containsSubset(r360.body(), { conector: 'apagado', stale: false, datos: null })
            const consumo = await estado(
                client.get(`/api/v1/servicios/${servicioId}/horus/consumo`).bearerToken(admin),
                200,
            )
            assert.equal(consumo.body().conector, 'apagado')
            const seguridad = await estado(
                client
                    .post('/api/v1/integraciones/horus/seguridad')
                    .bearerToken(admin)
                    .json({ servicio_ids: [servicioId] }),
                200,
            )
            assert.equal(seguridad.body().conector, 'apagado')
            assert.lengthOf(horus.peticiones, 0)
        } finally {
            await horus.detener()
        }
    })

    test('360 por external_service_id; si Horus no lo acepta (422) pregunta por la IP actual', async ({
        client,
        assert,
    }) => {
        const horus = await new HorusSimulado().iniciar()
        try {
            const { token: admin } = await usuarioConRoles(['admin'])
            const { servicioId, ip } = await servicioConIp()
            await fijarConector({ url_base: horus.url })
            horus.responder(RUTA_360, (p) => {
                if (p.json.external_service_id) {
                    return { status: 422, cuerpo: { detail: 'address is required' } }
                }
                return {
                    status: 200,
                    cuerpo: { customer: { address: p.json.address }, security: { state: 'clean' } },
                }
            })
            const r = await estado(
                client.get(`/api/v1/servicios/${servicioId}/horus`).bearerToken(admin),
                200,
            )
            assert.containsSubset(r.body(), {
                conector: 'activo',
                stale: false,
                error: null,
                consulta: 'address',
                ip,
                datos: { customer: { address: ip } },
            })
            assert.isString(r.body().actualizado_en)
            const llamadas = horus.de(RUTA_360)
            assert.lengthOf(llamadas, 2)
            assert.equal(llamadas[0]!.json.external_service_id, servicioId)
            assert.equal(llamadas[1]!.json.address, ip)
            assert.equal(llamadas[0]!.cabeceras.authorization, `Bearer ${TOKEN_HORUS}`)

            // Horus 1.2.0: responde por servicio, sin segunda llamada
            horus.peticiones.length = 0
            horus.responder(RUTA_360, () => ({
                status: 200,
                cuerpo: { external: { service_id: servicioId } },
            }))
            const directo = await estado(
                client.get(`/api/v1/servicios/${servicioId}/horus`).bearerToken(admin),
                200,
            )
            assert.equal(directo.body().consulta, 'external_service_id')
            assert.lengthOf(horus.peticiones, 1)
        } finally {
            await horus.detener()
        }
    })

    test('Horus caído: último dato conocido con stale, y espera exponencial (no se vuelve a llamar)', async ({
        client,
        assert,
    }) => {
        const horus = await new HorusSimulado().iniciar()
        try {
            const { token: admin } = await usuarioConRoles(['admin'])
            const { servicioId } = await servicioConIp()
            await fijarConector({ url_base: horus.url })
            horus.responder(RUTA_360, () => ({ status: 200, cuerpo: { health: { last_seen_minutes: 2 } } }))
            const fresco = await estado(
                client.get(`/api/v1/servicios/${servicioId}/horus`).bearerToken(admin),
                200,
            )
            assert.isFalse(fresco.body().stale)
            const actualizado = fresco.body().actualizado_en

            // Horus responde 503: dato viejo marcado stale, con el error
            horus.responder(RUTA_360, () => ({ status: 503, cuerpo: { detail: 'mantenimiento' } }))
            const viejo = await estado(
                client.get(`/api/v1/servicios/${servicioId}/horus`).bearerToken(admin),
                200,
            )
            assert.containsSubset(viejo.body(), {
                conector: 'activo',
                stale: true,
                actualizado_en: actualizado,
                datos: { health: { last_seen_minutes: 2 } },
            })
            assert.include(viejo.body().error, '503')
            const salud = await db.from('integraciones.horus_salud').where('id', 1).first()
            assert.equal(salud.fallos_seguidos, 1)
            assert.isAbove(new Date(salud.pausa_hasta).getTime(), Date.now() + 10_000)
            assert.isBelow(new Date(salud.pausa_hasta).getTime(), Date.now() + 16_000)

            // en pausa: no hay llamada, sigue el último dato
            const llamadas = horus.de(RUTA_360).length
            const enPausa = await estado(
                client.get(`/api/v1/servicios/${servicioId}/horus`).bearerToken(admin),
                200,
            )
            assert.isTrue(enPausa.body().stale)
            assert.equal(horus.de(RUTA_360).length, llamadas)

            // pasada la pausa, otro fallo duplica la espera; el tope es 15 min
            await db
                .from('integraciones.horus_salud')
                .where('id', 1)
                .update({ pausa_hasta: null, fallos_seguidos: 9 })
            await estado(client.get(`/api/v1/servicios/${servicioId}/horus`).bearerToken(admin), 200)
            const tope = await db.from('integraciones.horus_salud').where('id', 1).first()
            assert.equal(tope.fallos_seguidos, 10)
            assert.isBelow(new Date(tope.pausa_hasta).getTime(), Date.now() + 15 * 60_000 + 2000)
            assert.isAbove(new Date(tope.pausa_hasta).getTime(), Date.now() + 14 * 60_000)

            // sin servidor (ECONNREFUSED) y sin dato previo: datos null, stale false, con error
            await db.from('integraciones.horus_salud').where('id', 1).update({ pausa_hasta: null })
            await db
                .from('integraciones.horus_conector')
                .where('id', 1)
                .update({ url_base: await urlSinServidor() })
            invalidarConfigHorus()
            const otro = await servicioConIp()
            const sinDato = await estado(
                client.get(`/api/v1/servicios/${otro.servicioId}/horus`).bearerToken(admin),
                200,
            )
            assert.containsSubset(sinDato.body(), { stale: false, datos: null, actualizado_en: null })
            assert.include(sinDato.body().error, 'ECONNREFUSED')
        } finally {
            await horus.detener()
        }
    })

    test('consumo mensual por servicio y por lotes; caído devuelve el último consumo stale', async ({
        client,
        assert,
    }) => {
        const horus = await new HorusSimulado().iniciar()
        try {
            const { token: admin } = await usuarioConRoles(['admin'])
            const a = await servicioConIp()
            const b = await servicioConIp()
            await fijarConector({ url_base: horus.url })
            horus.responder(RUTA_CONSUMO, (p) => ({
                status: 200,
                cuerpo: {
                    items: (p.json.items as Array<{ external_service_id: number }>).map((i) =>
                        i.external_service_id === b.servicioId
                            ? { external_service_id: i.external_service_id, error: 'not_found' }
                            : {
                                  external_service_id: i.external_service_id,
                                  up_bytes: 10,
                                  down_bytes: 99,
                                  addresses: [a.ip],
                                  series: [{ day: '2026-10-01', up_bytes: 10, down_bytes: 99 }],
                              },
                    ),
                },
            }))
            const r = await estado(
                client
                    .post('/api/v1/integraciones/horus/consumo')
                    .bearerToken(admin)
                    .json({
                        servicio_ids: [a.servicioId, b.servicioId],
                        mes: '2026-10',
                        granularidad: 'day',
                    }),
                200,
            )
            assert.equal(r.body().desde, '2026-10-01T06:00:00.000Z')
            assert.equal(r.body().hasta, '2026-11-01T06:00:00.000Z')
            const peticion = horus.de(RUTA_CONSUMO)[0]!.json
            assert.containsSubset(peticion, { from: '2026-10-01T06:00:00.000Z', granularity: 'day' })
            assert.containsSubset(r.body().items, [
                {
                    servicio_id: a.servicioId,
                    bajada_bytes: 99,
                    subida_bytes: 10,
                    stale: false,
                    direcciones: [a.ip],
                },
                { servicio_id: b.servicioId, error: 'not_found', bajada_bytes: null },
            ])

            horus.responder(RUTA_CONSUMO, () => ({ status: 500 }))
            const caido = await estado(
                client
                    .get(`/api/v1/servicios/${a.servicioId}/horus/consumo?mes=2026-10&granularidad=day`)
                    .bearerToken(admin),
                200,
            )
            assert.isTrue(caido.body().stale)
            assert.containsSubset(caido.body().items, [
                { servicio_id: a.servicioId, bajada_bytes: 99, stale: true },
            ])
        } finally {
            await horus.detener()
        }
    })

    test('seguridad por lotes: §3.5 si existe; sin H9 (404) la alternativa con el último 360', async ({
        client,
        assert,
    }) => {
        const horus = await new HorusSimulado().iniciar()
        try {
            const { token: admin } = await usuarioConRoles(['admin'])
            const a = await servicioConIp()
            const b = await servicioConIp()
            await fijarConector({ url_base: horus.url })
            // 360 previa de A deja su estado de seguridad
            horus.responder(RUTA_360, () => ({
                status: 200,
                cuerpo: {
                    security: { state: 'suspected', open_findings: 1, findings: [{ severity: 'high' }] },
                },
            }))
            await estado(client.get(`/api/v1/servicios/${a.servicioId}/horus`).bearerToken(admin), 200)

            // Horus sin §3.5 (404 de ruta): alternativa, sin una llamada por servicio
            const antes = horus.peticiones.length
            const alt = await estado(
                client
                    .post('/api/v1/integraciones/horus/seguridad')
                    .bearerToken(admin)
                    .json({ servicio_ids: [a.servicioId, b.servicioId] }),
                200,
            )
            assert.equal(alt.body().modo, 'alternativa')
            assert.containsSubset(alt.body().items, [
                {
                    servicio_id: a.servicioId,
                    estado: 'suspected',
                    severidad_maxima: 'high',
                    fuente: 'consulta_360',
                    stale: true,
                },
                { servicio_id: b.servicioId, estado: null },
            ])
            assert.equal(horus.peticiones.length, antes + 1)
            assert.equal(horus.peticiones.at(-1)!.ruta, RUTA_SEGURIDAD)

            // Horus con §3.5
            horus.responder(RUTA_SEGURIDAD, (p) => ({
                status: 200,
                cuerpo: {
                    items: (p.json.items as Array<{ external_service_id: number }>).map((i) => ({
                        external_service_id: i.external_service_id,
                        state: 'clean',
                        open_findings: 0,
                    })),
                    meta: { at: '2026-10-17T10:00:00Z' },
                },
            }))
            const lotes = await estado(
                client
                    .post('/api/v1/integraciones/horus/seguridad')
                    .bearerToken(admin)
                    .json({ servicio_ids: [a.servicioId, b.servicioId] }),
                200,
            )
            assert.containsSubset(lotes.body(), { modo: 'lotes', stale: false })
            assert.containsSubset(lotes.body().items, [
                { servicio_id: a.servicioId, estado: 'clean', fuente: 'horus' },
                { servicio_id: b.servicioId, estado: 'clean' },
            ])
        } finally {
            await horus.detener()
        }
    })

    test('multiempresa: un usuario de otra empresa no consulta el servicio (403)', async ({ client }) => {
        const otra = await crearEmpresaFila()
        const { servicioId } = await servicioConIp(otra)
        const { usuario, token } = await usuarioConRoles(['admin'])
        await db.from('core.usuarios').where('id', usuario.id).update({ alcance_global: false })
        await db.table('core.usuarios_empresas').insert({ usuario_id: usuario.id, empresa_id: 1 })
        await fijarConector({ activo: false, url_base: 'https://horus.isp.example' })
        await estado(client.get(`/api/v1/servicios/${servicioId}/horus`).bearerToken(token), 403)
        await estado(
            client
                .post('/api/v1/integraciones/horus/seguridad')
                .bearerToken(token)
                .json({ servicio_ids: [servicioId] }),
            403,
        )
    })
})
