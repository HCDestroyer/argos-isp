import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar } from '#shared/cifrado'
import { contextoPrueba, estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { crearCliente, crearServicio, eventoOutbox } from '#tests/notify/ayudas_notify'
import { crearEmpresaFila } from '#tests/core/fabricas'
import { HorusSimulado, urlSinServidor } from '#tests/integraciones/horus_simulado'
import EditarCliente from '#core/actions/editar_cliente'
import GenerarTokenIris from '#core/actions/generar_token_iris'
import { usuarioIris } from '#core/integraciones_iris'
import { firmar, verificarFirma } from '#integraciones/horus/firma'
import { ConsumidorIris } from '#integraciones/iris/consumidor'
import {
    EVENTOS_A_IRIS,
    entregarPendientesIris,
    fijarFetchEnviosIris,
    registrarEnvioIris,
} from '#integraciones/iris/envios'
import { INTENTOS_MAXIMOS, idWebhook } from '#integraciones/webhooks_salientes'

/**
 * Webhooks Argos → Iris (`contratos/iris.md` §1.3 y §2.3): los siete eventos, firma HMAC `v1=`,
 * id estable y deduplicación, reintentos a 1 min, 5 min, 30 min, 2 h y 12 h, fallos visibles en
 * el panel, conector apagado, alcance de empresas del usuario técnico y nada de secretos. Iris es
 * un servidor HTTP local.
 */

const SECRETO = 'secreto-del-receptor-de-iris-0123456789'
const RECEPTOR = '/api/v1/integraciones/argosisp/webhook/c-1'
const consumidor = new ConsumidorIris()

async function limpiar() {
    await db.from('integraciones.iris_envios').delete()
    await db.from('integraciones.iris_enlaces').delete()
    await db.from('integraciones.iris_conector').delete()
    fijarFetchEnviosIris()
}

async function fijarConector(url: string, datos: { activo?: boolean; receptor?: boolean } = {}) {
    await db.from('integraciones.iris_conector').delete()
    await db.table('integraciones.iris_conector').insert({
        id: 1,
        activo: datos.activo ?? true,
        url_base: url,
        token_cifrado: cifrar(`iris_pat_${'Zx9Yw8Vu'.repeat(5)}`),
        webhook_salida_url: datos.receptor === false ? null : `${url}${RECEPTOR}`,
        webhook_salida_secreto_cifrado: datos.receptor === false ? null : cifrar(SECRETO),
    })
}

/** Usuario técnico «Iris» con alcance global (o solo `empresas`). */
async function usuarioTecnico(empresas: number[] | null = null): Promise<number> {
    let id = await usuarioIris()
    if (id === null) {
        await new GenerarTokenIris().execute({}, contextoPrueba())
        id = (await usuarioIris())!
    }
    await db
        .from('core.usuarios')
        .where('id', id)
        .update({ activo: true, alcance_global: empresas === null })
    await db.from('core.usuarios_empresas').where('usuario_id', id).delete()
    for (const empresaId of empresas ?? []) {
        await db.table('core.usuarios_empresas').insert({ usuario_id: id, empresa_id: empresaId })
    }
    return id
}

async function evento(nombre: string, payload: Record<string, unknown>) {
    const id = await eventoOutbox(nombre, payload)
    await consumidor.procesar({ id, evento: nombre, payload })
    return id
}

async function servicioDe(servicioId: number) {
    return db.from('core.servicios').where('id', servicioId).first()
}

test.group('integraciones · iris · webhooks Argos → Iris', (group) => {
    group.each.setup(async () => {
        await limpiar()
        await usuarioTecnico()
        return async () => {
            await limpiar()
            await usuarioTecnico()
            await soloEmpresaPrincipal()
        }
    })

    test('los siete eventos de §2.3: cuerpo { id, evento, ocurrido_en, payload } firmado, con empresa_id y sin secretos', async ({
        assert,
    }) => {
        const iris = await new HorusSimulado().iniciar()
        try {
            iris.responder(RECEPTOR, () => ({ status: 202 }))
            await fijarConector(iris.url)
            const clienteId = await crearCliente()
            const servicioId = await crearServicio(clienteId)
            const s = await servicioDe(servicioId)
            await db.from('core.servicios').where('id', servicioId).update({ pass_ppp: 'secreto-pppoe-123' })

            // los payloads llevan campos de más (el user_ppp, una contraseña): no deben salir
            const extra = { user_ppp: s.user_ppp, pass_ppp: 'secreto-pppoe-123', password: 'x' }
            const ids: Record<string, number> = {}
            ids['cliente.actualizado'] = await evento('cliente.actualizado', {
                cliente_id: clienteId,
                campos: ['nombre'],
                ...extra,
            })
            ids['servicio.creado'] = await evento('servicio.creado', {
                servicio_id: servicioId,
                empresa_id: 1,
                cliente_id: clienteId,
                router_id: s.router_id,
                plan_id: s.plan_id,
                ...extra,
            })
            ids['servicio.config_cambiada'] = await evento('servicio.config_cambiada', {
                servicio_id: servicioId,
                empresa_id: 1,
                campos: ['plan', 'ips'],
                ...extra,
            })
            ids['asignacion.cambiada'] = await evento('asignacion.cambiada', {
                servicio_id: servicioId,
                empresa_id: 1,
                ipv4: ['100.70.0.9'],
                prefijo_enlace_v6: '2001:db8:1:1::/64',
                prefijo_delegado_v6: '2001:db8:2:100::/56',
                inicio: '2026-10-28T00:00:00Z',
                fin: null,
                ...extra,
            })
            ids['servicio.estado_cambiado'] = await evento('servicio.estado_cambiado', {
                servicio_id: servicioId,
                empresa_id: 1,
                de: 'pendiente_instalacion',
                a: 'activo',
                motivo: 'instalacion',
                origen_tipo: 'iris_orden',
                origen_id: 'ord-77',
                ...extra,
            })
            ids['inventario.equipo_por_recuperar'] = await evento('inventario.equipo_por_recuperar', {
                unidad_id: 41,
                empresa_id: 1,
                servicio_id: servicioId,
                cliente_id: clienteId,
                producto_id: 7,
                serie: 'ZTE-123',
                mac: 'AA:BB:CC:00:11:22',
                ...extra,
            })
            ids['servicio.caidas_repetidas'] = await evento('servicio.caidas_repetidas', {
                servicio_id: servicioId,
                empresa_id: 1,
                cliente_id: clienteId,
                router_id: s.router_id,
                sesion_id: 900,
                sesiones: 5,
                desde: '2026-10-28T10:00:00.000Z',
                hasta: '2026-10-28T11:30:00.000Z',
                umbral: 5,
                ventana_minutos: 120,
                causas: { 'Lost-Carrier': 4, 'User-Request': 1 },
                ...extra,
            })
            // un evento que no es de §2.3 no va a Iris
            await evento('sesion.terminada', {
                servicio_id: servicioId,
                nas_ip: '10.0.0.1',
                acct_session_id: 'x',
            })
            assert.lengthOf(await db.from('integraciones.iris_envios'), EVENTOS_A_IRIS.length)

            const r = await entregarPendientesIris()
            assert.equal(r.enviados, EVENTOS_A_IRIS.length)
            const recibidas = iris.de(RECEPTOR)
            assert.lengthOf(recibidas, EVENTOS_A_IRIS.length)
            const porEvento = new Map(recibidas.map((p) => [p.json.evento as string, p]))

            for (const [nombre, outboxId] of Object.entries(ids)) {
                const p = porEvento.get(nombre)!
                assert.exists(p, nombre)
                assert.deepEqual(Object.keys(p.json).sort(), ['evento', 'id', 'ocurrido_en', 'payload'])
                assert.equal(p.json.id, idWebhook(outboxId))
                assert.equal(p.cabeceras['x-webhook-id'], idWebhook(outboxId))
                assert.equal(p.json.payload.empresa_id, 1, nombre)
                const ts = String(p.cabeceras['x-webhook-timestamp'])
                assert.equal(p.cabeceras['x-webhook-signature'], firmar(SECRETO, ts, p.cuerpo))
                assert.deepEqual(
                    verificarFirma({
                        secreto: SECRETO,
                        cuerpo: p.cuerpo,
                        timestamp: ts,
                        firma: String(p.cabeceras['x-webhook-signature']),
                    }),
                    { ok: true },
                )
                // nunca credenciales PPPoE ni secretos
                assert.notInclude(p.cuerpo, 'secreto-pppoe-123', nombre)
                assert.notInclude(p.cuerpo, s.user_ppp, nombre)
                assert.notInclude(p.cuerpo, 'password', nombre)
                assert.notInclude(p.cuerpo, 'pass_ppp', nombre)
            }

            assert.deepEqual(porEvento.get('cliente.actualizado')!.json.payload, {
                cliente_id: clienteId,
                empresa_id: 1,
                empresas: [1],
                campos: ['nombre'],
            })
            assert.deepEqual(porEvento.get('servicio.estado_cambiado')!.json.payload, {
                servicio_id: servicioId,
                empresa_id: 1,
                cliente_id: clienteId,
                de: 'pendiente_instalacion',
                a: 'activo',
                motivo: 'instalacion',
                origen_tipo: 'iris_orden',
                origen_id: 'ord-77',
            })
            assert.deepEqual(porEvento.get('servicio.config_cambiada')!.json.payload, {
                servicio_id: servicioId,
                empresa_id: 1,
                cliente_id: clienteId,
                campos: ['plan', 'ips'],
            })
            assert.deepEqual(porEvento.get('inventario.equipo_por_recuperar')!.json.payload, {
                unidad_id: 41,
                empresa_id: 1,
                servicio_id: servicioId,
                cliente_id: clienteId,
                producto_id: 7,
                serie: 'ZTE-123',
                mac: 'AA:BB:CC:00:11:22',
            })
            assert.deepEqual(porEvento.get('servicio.caidas_repetidas')!.json.payload, {
                servicio_id: servicioId,
                empresa_id: 1,
                cliente_id: clienteId,
                router_id: Number(s.router_id),
                sesion_id: 900,
                sesiones: 5,
                desde: '2026-10-28T10:00:00.000Z',
                hasta: '2026-10-28T11:30:00.000Z',
                umbral: 5,
                ventana_minutos: 120,
                causas: { 'Lost-Carrier': 4, 'User-Request': 1 },
            })
            assert.containsSubset(porEvento.get('asignacion.cambiada')!.json.payload, {
                ipv4: ['100.70.0.9'],
                prefijo_delegado_v6: '2001:db8:2:100::/56',
            })
            assert.containsSubset(porEvento.get('servicio.creado')!.json.payload, {
                cliente_id: clienteId,
                router_id: Number(s.router_id),
                plan_id: Number(s.plan_id),
            })
        } finally {
            await iris.detener()
        }
    })

    test('el bus entrega dos veces: un solo envío con el mismo id; empresa_id del servicio si el evento no lo trae', async ({
        assert,
    }) => {
        const iris = await new HorusSimulado().iniciar()
        try {
            iris.responder(RECEPTOR, () => ({ status: 200 }))
            await fijarConector(iris.url)
            const servicioId = await crearServicio(await crearCliente())
            const payload = { servicio_id: servicioId, de: 'activo', a: 'suspendido', motivo: 'corte' }
            const id = await evento('servicio.estado_cambiado', payload)
            await consumidor.procesar({ id, evento: 'servicio.estado_cambiado', payload })
            assert.isNull(await registrarEnvioIris({ id, evento: 'servicio.estado_cambiado', payload }))
            assert.lengthOf(await db.from('integraciones.iris_envios'), 1)
            await entregarPendientesIris()
            await entregarPendientesIris()
            assert.lengthOf(iris.de(RECEPTOR), 1)
            assert.equal(iris.de(RECEPTOR)[0]!.json.payload.empresa_id, 1)
            const envio = await db.from('integraciones.iris_envios').first()
            assert.containsSubset(envio, {
                evento_id: idWebhook(id),
                estado: 'enviado',
                intentos: 1,
                empresa_id: 1,
            })
        } finally {
            await iris.detener()
        }
    })

    test('reintentos a 1 min, 5 min, 30 min, 2 h y 12 h; después fallido y visible en el panel', async ({
        client,
        assert,
    }) => {
        const iris = await new HorusSimulado().iniciar()
        try {
            iris.responder(RECEPTOR, () => ({ status: 503, cuerpo: { error: 'mantenimiento' } }))
            await fijarConector(iris.url)
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
                if (intento > 1) {
                    const antes = await entregarPendientesIris({ ahora: new Date(ahora.getTime() - 1000) })
                    assert.equal(antes.reintentar + antes.fallidos, 0)
                }
                await entregarPendientesIris({ ahora })
                const envio = await db.from('integraciones.iris_envios').first()
                assert.equal(envio.intentos, intento)
                assert.include(envio.ultimo_error, 'HTTP 503')
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
            assert.lengthOf(new Set(iris.de(RECEPTOR).map((p) => p.cabeceras['x-webhook-id'])), 1)

            const { token: admin } = await usuarioConRoles(['admin'])
            const lista = await estado(
                client.get('/api/v1/integraciones/iris/envios?estado=fallido').bearerToken(admin),
                200,
            )
            assert.lengthOf(lista.body().data, 1)
            assert.containsSubset(lista.body().data[0], {
                evento: 'servicio.estado_cambiado',
                estado: 'fallido',
                intentos: INTENTOS_MAXIMOS,
                ultimo_status: 503,
            })
            const resumen = await estado(
                client.get('/api/v1/integraciones/iris/envios/resumen').bearerToken(admin),
                200,
            )
            assert.containsSubset(resumen.body(), {
                destino_configurado: true,
                alcance: { global: true },
                pendientes: 0,
                fallidos: 1,
                ultimo_enviado_en: null,
                ultimo_fallo: {
                    evento: 'servicio.estado_cambiado',
                    estado: 'fallido',
                    intentos: INTENTOS_MAXIMOS,
                },
            })
            assert.include(resumen.body().ultimo_fallo.ultimo_error, 'HTTP 503')
            // sin `iris.ver`, 403
            const { token: cajero } = await usuarioConRoles(['cajero'])
            await estado(client.get('/api/v1/integraciones/iris/envios/resumen').bearerToken(cajero), 403)
        } finally {
            await iris.detener()
        }
    })

    test('Iris caído (sin conexión): queda pendiente con el error y reintenta', async ({ assert }) => {
        const url = await urlSinServidor()
        await fijarConector(url)
        const servicioId = await crearServicio(await crearCliente())
        await evento('servicio.creado', { servicio_id: servicioId, empresa_id: 1 })
        const r = await entregarPendientesIris()
        assert.equal(r.reintentar, 1)
        const envio = await db.from('integraciones.iris_envios').first()
        assert.equal(envio.estado, 'pendiente')
        assert.include(envio.ultimo_error, 'Sin conexión')
    })

    test('conector apagado o sin receptor: no registra; apagado después de registrar → descartado sin llamada', async ({
        assert,
    }) => {
        const iris = await new HorusSimulado().iniciar()
        try {
            iris.responder(RECEPTOR, () => ({ status: 200 }))
            const servicioId = await crearServicio(await crearCliente())
            const payload = {
                servicio_id: servicioId,
                empresa_id: 1,
                de: 'activo',
                a: 'limitado',
                motivo: 'x',
            }

            await evento('servicio.estado_cambiado', payload) // sin conector
            await fijarConector(iris.url, { activo: false })
            await evento('servicio.estado_cambiado', payload)
            await fijarConector(iris.url, { receptor: false })
            await evento('servicio.estado_cambiado', payload)
            assert.lengthOf(await db.from('integraciones.iris_envios'), 0)

            await fijarConector(iris.url)
            await evento('servicio.estado_cambiado', payload)
            assert.lengthOf(await db.from('integraciones.iris_envios'), 1)
            await db.from('integraciones.iris_conector').update({ activo: false })
            const r = await entregarPendientesIris()
            assert.equal(r.descartados, 1)
            assert.lengthOf(iris.peticiones, 0)
            const envio = await db.from('integraciones.iris_envios').first()
            assert.containsSubset(envio, {
                estado: 'descartado',
                ultimo_error: 'Conector Iris apagado o sin receptor configurado',
            })
        } finally {
            await iris.detener()
        }
    })

    test('alcance: solo eventos de las empresas del usuario técnico; sin usuario técnico activo, nada', async ({
        assert,
    }) => {
        const iris = await new HorusSimulado().iniciar()
        try {
            iris.responder(RECEPTOR, () => ({ status: 200 }))
            await fijarConector(iris.url)
            const empresa2 = await crearEmpresaFila()
            const empresa3 = await crearEmpresaFila()
            const tecnico = await usuarioTecnico([empresa2])

            const clienteId = await crearCliente()
            const enLa1 = await crearServicio(clienteId, undefined, 1)
            const enLa2 = await crearServicio(clienteId, undefined, empresa2)
            const enLa3 = await crearServicio(await crearCliente(), undefined, empresa3)

            const estadoDe = (servicioId: number, empresaId: number) => ({
                servicio_id: servicioId,
                empresa_id: empresaId,
                de: 'activo',
                a: 'suspendido',
                motivo: 'corte',
            })
            await evento('servicio.estado_cambiado', estadoDe(enLa1, 1))
            const id2 = await evento('servicio.estado_cambiado', estadoDe(enLa2, empresa2))
            // cambio de empresa 3 → 2: le interesa a quien lo recibe
            const idCambio = await evento('servicio.config_cambiada', {
                servicio_id: enLa3,
                empresa_id: empresa2,
                empresa_anterior_id: empresa3,
                campos: ['empresa'],
            })
            // el cliente tiene servicios en la 1 y la 2: Iris solo ve la 2
            const idCliente = await evento('cliente.actualizado', {
                cliente_id: clienteId,
                campos: ['nombre'],
            })
            // cliente sin servicios en el alcance: no sale
            await evento('cliente.actualizado', { cliente_id: await crearCliente(), campos: ['nombre'] })

            const filas = await db.from('integraciones.iris_envios').orderBy('id')
            assert.deepEqual(
                filas.map((f) => f.evento_id),
                [idWebhook(id2), idWebhook(idCambio), idWebhook(idCliente)],
            )
            await entregarPendientesIris()
            const cliente = iris.de(RECEPTOR).find((p) => p.json.evento === 'cliente.actualizado')!
            assert.deepEqual(cliente.json.payload, {
                cliente_id: clienteId,
                empresa_id: empresa2,
                empresas: [empresa2],
                campos: ['nombre'],
            })
            const cambio = iris.de(RECEPTOR).find((p) => p.json.evento === 'servicio.config_cambiada')!
            assert.containsSubset(cambio.json.payload, {
                empresa_id: empresa2,
                empresa_anterior_id: empresa3,
            })

            // usuario técnico desactivado: no se envía nada
            await db.from('core.usuarios').where('id', tecnico).update({ activo: false })
            await evento('servicio.estado_cambiado', estadoDe(enLa2, empresa2))
            assert.lengthOf(await db.from('integraciones.iris_envios'), 3)
        } finally {
            await iris.detener()
        }
    })

    test('cliente.actualizado real de A1 (EditarCliente) llega a Iris', async ({ assert }) => {
        const iris = await new HorusSimulado().iniciar()
        try {
            iris.responder(RECEPTOR, () => ({ status: 200 }))
            await fijarConector(iris.url)
            const clienteId = await crearCliente()
            await crearServicio(clienteId)
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
            await entregarPendientesIris()
            assert.containsSubset(iris.de(RECEPTOR)[0]!.json, {
                id: idWebhook(ev.id),
                evento: 'cliente.actualizado',
                payload: { cliente_id: clienteId, empresa_id: 1, campos: ['nombre'] },
            })
        } finally {
            await iris.detener()
        }
    })
})
