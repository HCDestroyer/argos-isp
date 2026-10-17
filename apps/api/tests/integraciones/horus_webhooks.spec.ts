import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, soloEmpresaPrincipal } from '#tests/ayudas'
import EditarCliente from '#core/actions/editar_cliente'
import { ColaFalsa, crearCliente, crearServicio, eventoOutbox } from '#tests/notify/ayudas_notify'
import { crearEmpresaFila } from '#tests/core/fabricas'
import { ConsumidorHorus } from '#integraciones/horus/consumidor'
import { INTENTOS_MAXIMOS, entregarPendientes, idWebhook, registrarEnvio } from '#integraciones/horus/envios'
import { cabecerasFirmadas, firmar, verificarFirma } from '#integraciones/horus/firma'
import { ConsumidorAlertas } from '#notify/consumidor_alertas'
import { fijarChatEquipo } from '#notify/alertas'
import {
    HorusSimulado,
    contar,
    SECRETO_ENTRADA,
    SECRETO_SALIDA,
    fijarConector,
    limpiarHorus,
} from '#tests/integraciones/horus_simulado'

/**
 * Webhooks firmados en los dos sentidos (§1.3): Argos → Horus (grupo `horus`, reintentos a 1 min,
 * 5 min, 30 min, 2 h y 12 h) y Horus → Argos (firma, desfase, deduplicación, eventos internos y
 * alertas al equipo por empresa). Horus es un servidor local.
 */

const consumidor = new ConsumidorHorus()

async function evento(nombre: string, payload: Record<string, unknown>) {
    const id = await eventoOutbox(nombre, payload)
    await consumidor.procesar({ id, evento: nombre, payload })
    return id
}

test.group('integraciones · horus · webhooks Argos → Horus', (group) => {
    group.each.setup(async () => {
        process.env.HORUS_PERMITIR_HTTP = 'true'
        await limpiarHorus()
        return async () => {
            await limpiarHorus()
            delete process.env.HORUS_PERMITIR_HTTP
        }
    })

    test('servicio.estado_cambiado: cuerpo { id, evento, ocurrido_en, payload } con empresa_id y firma verificable', async ({
        assert,
    }) => {
        const horus = await new HorusSimulado().iniciar()
        try {
            horus.responder('/receptor', () => ({ status: 202 }))
            await fijarConector({
                url_base: horus.url,
                webhook_salida_url: `${horus.url}/receptor`,
                webhook_salida_secreto: SECRETO_SALIDA,
            })
            const servicioId = await crearServicio(await crearCliente())
            const id = await evento('servicio.estado_cambiado', {
                servicio_id: servicioId,
                empresa_id: 1,
                de: 'activo',
                a: 'suspendido',
                motivo: 'corte',
            })
            // el bus lo entrega dos veces: un solo envío
            await consumidor.procesar({
                id,
                evento: 'servicio.estado_cambiado',
                payload: {
                    servicio_id: servicioId,
                    empresa_id: 1,
                    de: 'activo',
                    a: 'suspendido',
                    motivo: 'corte',
                },
            })
            assert.lengthOf(await db.from('integraciones.horus_envios'), 1)

            const r = await entregarPendientes()
            assert.equal(r.enviados, 1)
            const recibida = horus.de('/receptor')[0]!
            assert.deepEqual(recibida.json.payload, {
                servicio_id: servicioId,
                empresa_id: 1,
                estado: 'suspendido',
                estado_anterior: 'activo',
            })
            assert.equal(recibida.json.id, idWebhook(id))
            assert.equal(recibida.json.evento, 'servicio.estado_cambiado')
            assert.isString(recibida.json.ocurrido_en)
            assert.equal(recibida.cabeceras['x-webhook-id'], idWebhook(id))
            const ts = String(recibida.cabeceras['x-webhook-timestamp'])
            assert.equal(
                recibida.cabeceras['x-webhook-signature'],
                firmar(SECRETO_SALIDA, ts, recibida.cuerpo),
            )
            const envio = await db.from('integraciones.horus_envios').first()
            assert.containsSubset(envio, { estado: 'enviado', intentos: 1, ultimo_status: 202 })
        } finally {
            await horus.detener()
        }
    })

    test('reintentos a 1 min, 5 min, 30 min, 2 h y 12 h; después fallido', async ({ assert }) => {
        const horus = await new HorusSimulado().iniciar()
        try {
            horus.responder('/receptor', () => ({ status: 500, cuerpo: { error: 'boom' } }))
            await fijarConector({
                url_base: horus.url,
                webhook_salida_url: `${horus.url}/receptor`,
                webhook_salida_secreto: SECRETO_SALIDA,
            })
            const servicioId = await crearServicio(await crearCliente())
            await evento('servicio.estado_cambiado', {
                servicio_id: servicioId,
                empresa_id: 1,
                de: 'activo',
                a: 'limitado',
                motivo: 'x',
            })

            let ahora = new Date()
            const esperas: number[] = []
            for (let intento = 1; intento <= INTENTOS_MAXIMOS; intento++) {
                // antes de su hora no se manda
                if (intento > 1) {
                    const antes = await entregarPendientes({ ahora: new Date(ahora.getTime() - 1000) })
                    assert.equal(antes.reintentar + antes.fallidos, 0)
                }
                await entregarPendientes({ ahora })
                const envio = await db.from('integraciones.horus_envios').first()
                assert.equal(envio.intentos, intento)
                assert.include(envio.ultimo_error, 'HTTP 500')
                if (intento < INTENTOS_MAXIMOS) {
                    assert.equal(envio.estado, 'pendiente')
                    const proximo = new Date(envio.proximo_intento_en)
                    esperas.push(Math.round((proximo.getTime() - ahora.getTime()) / 1000))
                    ahora = proximo
                } else {
                    assert.equal(envio.estado, 'fallido')
                    assert.isNull(envio.proximo_intento_en)
                }
            }
            assert.deepEqual(esperas, [60, 300, 1800, 7200, 43200])
            assert.lengthOf(horus.de('/receptor'), INTENTOS_MAXIMOS)
            // los firmó todos con el mismo id
            assert.lengthOf(new Set(horus.de('/receptor').map((p) => p.cabeceras['x-webhook-id'])), 1)
        } finally {
            await horus.detener()
        }
    })

    test('conector apagado: no registra ni manda nada; apagado después de registrar → descartado sin llamada', async ({
        assert,
    }) => {
        const horus = await new HorusSimulado().iniciar()
        try {
            horus.responder('/receptor', () => ({ status: 200 }))
            await fijarConector({
                activo: false,
                url_base: horus.url,
                webhook_salida_url: `${horus.url}/receptor`,
                webhook_salida_secreto: SECRETO_SALIDA,
            })
            const servicioId = await crearServicio(await crearCliente())
            await evento('servicio.estado_cambiado', {
                servicio_id: servicioId,
                empresa_id: 1,
                de: 'activo',
                a: 'limitado',
                motivo: 'x',
            })
            assert.lengthOf(await db.from('integraciones.horus_envios'), 0)

            await db.from('integraciones.horus_conector').update({ activo: true })
            const { invalidarConfigHorus } = await import('#integraciones/horus/configuracion')
            invalidarConfigHorus()
            await evento('servicio.estado_cambiado', {
                servicio_id: servicioId,
                empresa_id: 1,
                de: 'limitado',
                a: 'activo',
                motivo: 'x',
            })
            assert.lengthOf(await db.from('integraciones.horus_envios'), 1)
            await db.from('integraciones.horus_conector').update({ activo: false })
            invalidarConfigHorus()
            const r = await entregarPendientes()
            assert.equal(r.descartados, 1)
            assert.lengthOf(horus.peticiones, 0)
        } finally {
            await horus.detener()
        }
    })

    test('cliente.actualizado real de A1 (EditarCliente) llega a Horus', async ({ assert }) => {
        const horus = await new HorusSimulado().iniciar()
        try {
            horus.responder('/receptor', () => ({ status: 200 }))
            await fijarConector({
                url_base: horus.url,
                webhook_salida_url: `${horus.url}/receptor`,
                webhook_salida_secreto: SECRETO_SALIDA,
            })
            const clienteId = await crearCliente()
            const fila = await db.from('core.clientes').where('id', clienteId).first()
            await new EditarCliente().execute(
                { id: clienteId, version: fila.version, nombre: `Renombrado ${clienteId}` },
                contextoPrueba(),
            )
            const ev = await db
                .from('audit.outbox')
                .where('evento', 'cliente.actualizado')
                .whereRaw("(payload->>'cliente_id')::bigint = ?", [clienteId])
                .first()
            assert.isNotNull(ev)
            await consumidor.procesar({ id: ev.id, evento: ev.evento, payload: ev.payload })
            await entregarPendientes()
            const recibido = horus.de('/receptor')[0]!.json
            assert.containsSubset(recibido, {
                id: idWebhook(ev.id),
                evento: 'cliente.actualizado',
                payload: { cliente_id: clienteId, campos: ['nombre'] },
            })
        } finally {
            await horus.detener()
        }
    })

    test('un envío recién registrado sale en la entrega inmediata (reloj de la base, no el de Node)', async ({
        assert,
    }) => {
        // Regresión: `proximo_intento_en = now()` (µs) contra `new Date()` (ms truncado) dejaba fuera
        // ~1 % de los envíos registrados en el mismo milisegundo de la entrega.
        const horus = await new HorusSimulado().iniciar()
        try {
            horus.responder('/receptor', () => ({ status: 200 }))
            await fijarConector({
                url_base: horus.url,
                webhook_salida_url: `${horus.url}/receptor`,
                webhook_salida_secreto: SECRETO_SALIDA,
            })
            let omitidos = 0
            for (let i = 0; i < 200; i++) {
                await registrarEnvio({
                    id: `reloj-${i}`,
                    evento: 'cliente.actualizado',
                    payload: { cliente_id: 1, campos: ['nombre'] },
                })
                const r = await entregarPendientes()
                if (r.enviados !== 1) omitidos++
            }
            assert.equal(omitidos, 0)
            assert.lengthOf(horus.de('/receptor'), 200)
        } finally {
            await horus.detener()
        }
    })

    test('mapeo: asignacion.cambiada, sesion.iniciada (prefijos de la sesión) y cliente.actualizado', async ({
        assert,
    }) => {
        const horus = await new HorusSimulado().iniciar()
        try {
            horus.responder('/receptor', () => ({ status: 200 }))
            await fijarConector({
                url_base: horus.url,
                webhook_salida_url: `${horus.url}/receptor`,
                webhook_salida_secreto: SECRETO_SALIDA,
            })
            const clienteId = await crearCliente()
            const servicioId = await crearServicio(clienteId)
            const servicio = await db.from('core.servicios').where('id', servicioId).first()
            await db.table('network.sesiones').insert({
                servicio_id: servicioId,
                router_id: servicio.router_id,
                nas_ip: '10.8.8.8',
                acct_session_id: `h-${servicioId}`,
                user_ppp: servicio.user_ppp,
                ipv4: '100.70.0.9',
                prefijo_enlace_v6: '2001:db8:1:1::/64',
                prefijo_delegado_v6: '2001:db8:2:100::/56',
            })
            await evento('asignacion.cambiada', {
                servicio_id: servicioId,
                empresa_id: 1,
                ipv4: ['100.70.0.9'],
                prefijo_enlace_v6: '2001:db8:1:1::/64',
                prefijo_delegado_v6: '2001:db8:2:100::/56',
                inicio: '2026-10-17T00:00:00Z',
                fin: null,
            })
            await evento('sesion.iniciada', {
                servicio_id: servicioId,
                nas_ip: '10.8.8.8',
                acct_session_id: `h-${servicioId}`,
                ipv4: '100.70.0.9',
                prefijos_v6: ['2001:db8:1:1::/64', '2001:db8:2:100::/56'],
            })
            // sin servicio: no sirve a Horus
            await evento('sesion.terminada', {
                servicio_id: null,
                nas_ip: '10.8.8.8',
                acct_session_id: 'x',
                ipv4: null,
                prefijos_v6: [],
                motivo: null,
            })
            await evento('cliente.actualizado', { cliente_id: clienteId, campos: ['nombre'] })
            await entregarPendientes()
            const cuerpos = horus.de('/receptor').map((p) => p.json)
            assert.lengthOf(cuerpos, 3)
            assert.containsSubset(cuerpos, [
                {
                    evento: 'asignacion.cambiada',
                    payload: {
                        servicio_id: servicioId,
                        empresa_id: 1,
                        ipv4: '100.70.0.9',
                        prefijo_v6: '2001:db8:2:100::/56',
                    },
                },
                {
                    evento: 'sesion.iniciada',
                    payload: {
                        servicio_id: servicioId,
                        empresa_id: 1,
                        ipv4: '100.70.0.9',
                        prefijo_enlace_v6: '2001:db8:1:1::/64',
                        prefijo_delegado_v6: '2001:db8:2:100::/56',
                    },
                },
                { evento: 'cliente.actualizado', payload: { cliente_id: clienteId, campos: ['nombre'] } },
            ])
        } finally {
            await horus.detener()
        }
    })
})

/** POST firmado al receptor de Argos. */
function webhookFirmado(
    client: any,
    cuerpo: Record<string, unknown>,
    opciones: { secreto?: string; ahora?: Date; firma?: string } = {},
) {
    const texto = JSON.stringify(cuerpo)
    const cabeceras = cabecerasFirmadas(
        opciones.secreto ?? SECRETO_ENTRADA,
        String(cuerpo.id),
        texto,
        opciones.ahora,
    )
    if (opciones.firma) cabeceras['x-webhook-signature'] = opciones.firma
    return client.post('/api/v1/integraciones/horus/webhook').headers(cabeceras).json(cuerpo)
}

test.group('integraciones · horus · receptor Horus → Argos', (group) => {
    group.each.setup(async () => {
        process.env.HORUS_PERMITIR_HTTP = 'true'
        await limpiarHorus()
        await fijarConector({ url_base: 'https://horus.isp.example' })
        return async () => {
            await limpiarHorus()
            fijarChatEquipo(undefined)
            await soloEmpresaPrincipal()
            delete process.env.HORUS_PERMITIR_HTTP
        }
    })

    test('firma válida: 202, evento interno horus.hallazgo_abierto con servicio y empresa; duplicado no repite', async ({
        client,
        assert,
    }) => {
        const empresa = await crearEmpresaFila()
        const clienteId = await crearCliente()
        const servicioId = await crearServicio(clienteId, undefined, empresa)
        const cuerpo = {
            id: `wh-${servicioId}-a`,
            event: 'finding.opened',
            occurred_at: '2026-10-17T10:00:00Z',
            tenant: 'isp',
            campo_nuevo: 'se ignora',
            data: {
                finding: {
                    id: 'f-1',
                    kind: 'outbound_scanning',
                    severity: 'high',
                    summary: 'Escaneo',
                    opened_at: '2026-10-17T09:59:00Z',
                    reopened: false,
                },
                customer: { id: 'c', address: '100.64.1.20', alias: 'X' },
                external: { customer_id: clienteId, service_id: servicioId, company_id: empresa },
            },
        }
        const r = await estado(webhookFirmado(client, cuerpo), 202)
        assert.deepEqual(r.body(), {
            recibido: true,
            duplicado: false,
            estado: 'procesado',
            evento_interno: 'horus.hallazgo_abierto',
        })
        const repetido = await estado(webhookFirmado(client, cuerpo), 202)
        assert.isTrue(repetido.body().duplicado)

        const eventos = await db
            .from('audit.outbox')
            .where('evento', 'horus.hallazgo_abierto')
            .whereRaw("payload->>'webhook_id' = ?", [cuerpo.id])
        assert.lengthOf(eventos, 1)
        assert.containsSubset(eventos[0].payload, {
            servicio_id: servicioId,
            cliente_id: clienteId,
            empresa_id: empresa,
            ip: '100.64.1.20',
            hallazgo: { id: 'f-1', tipo: 'outbound_scanning', severidad: 'high' },
        })
        // Horus no decide cortes
        const servicio = await db.from('core.servicios').where('id', servicioId).first()
        assert.equal(servicio.estado, 'activo')
        const fila = await db.from('integraciones.horus_recibidos').where('webhook_id', cuerpo.id).first()
        assert.containsSubset(fila, { servicio_id: servicioId, empresa_id: empresa, estado: 'procesado' })

        // alerta al equipo con la configuración de la empresa del servicio
        fijarChatEquipo('-100999')
        const cola = new ColaFalsa()
        await new ConsumidorAlertas(cola).procesar({
            id: eventos[0].id,
            evento: 'horus.hallazgo_abierto',
            payload: eventos[0].payload,
        })
        const envio = await db
            .from('notify.envios')
            .where('evento', 'alerta.horus.hallazgo')
            .orderBy('id', 'desc')
            .first()
        assert.equal(envio.empresa_id, empresa)
        assert.include(envio.cuerpo, 'outbound_scanning')
        // severidad baja: sin alerta
        const antes = await contar('notify.envios', (q) => q.where('evento', 'alerta.horus.hallazgo'))
        await new ConsumidorAlertas(cola).procesar({
            id: `prueba-${servicioId}`,
            evento: 'horus.hallazgo_abierto',
            payload: { ...eventos[0].payload, hallazgo: { id: 'f-2', severidad: 'low', tipo: 'x' } },
        })
        assert.lengthOf(await db.from('notify.envios').where('evento', 'alerta.horus.hallazgo'), antes)
    })

    test('firma inválida 401, desfase de más de 5 min 401, sin firma 401; conector apagado 503', async ({
        client,
        assert,
    }) => {
        const cuerpo = { id: 'wh-firma', event: 'ping', data: {} }
        const mala = await estado(webhookFirmado(client, cuerpo, { secreto: 'otro-secreto-cualquiera' }), 401)
        assert.equal(mala.body().type, 'urn:argosisp:problema:firma_invalida')
        const vieja = await estado(
            webhookFirmado(client, cuerpo, { ahora: new Date(Date.now() - 6 * 60_000) }),
            401,
        )
        assert.equal(vieja.body().type, 'urn:argosisp:problema:timestamp_fuera_de_ventana')
        await estado(client.post('/api/v1/integraciones/horus/webhook').json(cuerpo), 401)
        assert.lengthOf(await db.from('integraciones.horus_recibidos'), 0)

        await fijarConector({ activo: false, url_base: 'https://horus.isp.example' })
        await estado(webhookFirmado(client, cuerpo), 503)

        // la verificación acepta varias firmas (rotación) y compara en tiempo constante
        const ts = String(Math.floor(Date.now() / 1000))
        assert.isTrue(
            verificarFirma({
                secreto: 's',
                cuerpo: '{}',
                timestamp: ts,
                firma: `v1=00, ${firmar('s', ts, '{}')}`,
            }).ok,
        )
    })

    test('ping y test responden sin efecto; eventos desconocidos se ignoran; estado de seguridad queda como último dato', async ({
        client,
        assert,
    }) => {
        const outboxAntes = await contar('audit.outbox')
        const ping = await estado(webhookFirmado(client, { id: 'wh-ping', event: 'ping', data: {} }), 202)
        assert.containsSubset(ping.body(), { estado: 'procesado', evento_interno: null })
        await estado(webhookFirmado(client, { id: 'wh-test', event: 'test', data: {} }), 202)
        const raro = await estado(
            webhookFirmado(client, { id: 'wh-raro', event: 'algo.nuevo', data: { x: 1 } }),
            202,
        )
        assert.containsSubset(raro.body(), { estado: 'ignorado', evento_interno: null })
        assert.equal(await contar('audit.outbox'), outboxAntes)

        const servicioId = await crearServicio(await crearCliente())
        await estado(
            webhookFirmado(client, {
                id: `wh-seg-${servicioId}`,
                event: 'customer.security_state_changed',
                occurred_at: '2026-10-17T11:00:00Z',
                data: {
                    state: 'compromised',
                    previous_state: 'clean',
                    open_findings: 2,
                    external: { service_id: servicioId },
                },
            }),
            202,
        )
        const dato = await db
            .from('integraciones.horus_datos')
            .where('tipo', 'seguridad')
            .where('servicio_id', servicioId)
            .first()
        assert.containsSubset(dato.datos, { estado: 'compromised', hallazgos_abiertos: 2, fuente: 'webhook' })
        const estadoSeguridad = await db
            .from('audit.outbox')
            .where('evento', 'horus.estado_seguridad_cambiado')
            .orderBy('id', 'desc')
            .first()
        assert.containsSubset(estadoSeguridad.payload, {
            servicio_id: servicioId,
            empresa_id: 1,
            estado: 'compromised',
            estado_anterior: 'clean',
        })
    })

    test('router.status_changed: alerta al caer y aviso de recuperación', async ({ client, assert }) => {
        fijarChatEquipo('-100999')
        const cola = new ColaFalsa()
        const alertas = new ConsumidorAlertas(cola)
        const routerId = `r-${Date.now()}`
        for (const [n, status] of [
            [1, 'offline'],
            [2, 'offline'],
            [3, 'online'],
        ] as const) {
            await estado(
                webhookFirmado(client, {
                    id: `wh-${routerId}-${n}`,
                    event: 'router.status_changed',
                    data: {
                        router: {
                            id: routerId,
                            name: 'Torre Norte',
                            status,
                            reason: n === 1 ? 'sin flujos' : null,
                        },
                    },
                }),
                202,
            )
            const ev = await db
                .from('audit.outbox')
                .where('evento', 'horus.router_estado_cambiado')
                .orderBy('id', 'desc')
                .first()
            await alertas.procesar({ id: ev.id, evento: ev.evento, payload: ev.payload })
        }
        const envios = await db
            .from('notify.envios')
            .whereIn('evento', ['alerta.horus.router', 'alerta.horus.router_recuperado'])
            .whereLike('cuerpo', '%Torre Norte%')
        assert.sameMembers(
            envios.map((e: { evento: string }) => e.evento),
            ['alerta.horus.router', 'alerta.horus.router_recuperado'],
        )
    })
})
