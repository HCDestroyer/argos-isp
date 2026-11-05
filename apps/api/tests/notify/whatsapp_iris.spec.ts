import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar } from '#shared/cifrado'
import { contextoPrueba, estado, usuarioConRoles } from '#tests/ayudas'
import { contextoSistema } from '#shared/contexto'
import EnviarNotificacion from '#notify/actions/enviar_notificacion'
import ConciliarAvisosIris from '#notify/actions/conciliar_avisos_iris'
import RegistrarConsentimientoWhatsapp from '#notify/actions/registrar_consentimiento_whatsapp'
import { ConsumidorNotify } from '#notify/consumidor'
import { registrarCanal, reiniciarCanales } from '#notify/canales/registro'
import { recargarConfiguracion } from '#notify/configuracion'
import { entregarConsentimientosIris } from '#notify/consentimientos'
import { cabecerasFirmadas } from '#integraciones/horus/firma'
import { HorusSimulado as IrisSimulado } from '#tests/integraciones/horus_simulado'
import {
    CanalFalso,
    ColaFalsa,
    PAGO_SIN_COMPROBANTE,
    crearCliente,
    crearFactura,
    crearServicio,
    eventoOutbox,
} from '#tests/notify/ayudas_notify'

/**
 * Canal WhatsApp de notify por la mensajería de Iris (contrato Iris 0.6.0 §6, pedido A21), contra
 * Postgres real e Iris simulado con un servidor HTTP local: aviso con `Idempotency-Key` y sin número,
 * `202 en_cola | bloqueado`, interruptor por configuración, conector apagado o con contrato < 0.6.0,
 * webhooks Iris → Argos (`aviso.entregado`, `aviso.fallido`, `contacto.baja`) firmados y
 * deduplicados, consentimientos con su cola y lo que nace en Iris (no se avisa).
 */

const TOKEN = `iris_pat_${'Qw3Er4Ty'.repeat(5)}`
const SECRETO_ENTRADA = 'whsec_secreto-del-receptor-de-argos-para-iris'
const AVISOS = '/api/v1/mensajeria/avisos'
const CONSENTIMIENTOS = '/api/v1/mensajeria/consentimientos'

let iris: IrisSimulado
let correo: CanalFalso

async function fijarConector(datos: { activo?: boolean; contrato?: string | null } = {}) {
    await db.from('integraciones.iris_conector').delete()
    await db.table('integraciones.iris_conector').insert({
        id: 1,
        activo: datos.activo ?? true,
        url_base: iris.url,
        token_cifrado: cifrar(TOKEN),
        webhook_entrada_secreto_cifrado: cifrar(SECRETO_ENTRADA),
        contrato: datos.contrato === undefined ? '0.6.0' : datos.contrato,
    })
}

/** Configuración global con el interruptor de WhatsApp (correo con canal falso). */
async function fijarWhatsapp(activo: boolean) {
    await db.from('notify.configuracion_canales').delete()
    await db
        .table('notify.configuracion_canales')
        .insert({ empresa_id: null, hereda: false, whatsapp_activo: activo })
    await recargarConfiguracion()
}

async function programar(evento: string, payload: Record<string, unknown>) {
    const outboxId = await eventoOutbox(evento, payload)
    await new ConsumidorNotify(new ColaFalsa()).procesar({ id: outboxId, evento, payload })
    return db.from('notify.envios').where('origen', `outbox:${outboxId}`).orderBy('id')
}

async function waDe(evento: string, payload: Record<string, unknown>) {
    const envios = await programar(evento, payload)
    return envios.find((e) => e.canal === 'whatsapp')
}

async function canalesDe(evento: string, payload: Record<string, unknown>) {
    const envios = await programar(evento, payload)
    return envios.map((e) => e.canal)
}

async function estadoDe(envioId: number) {
    const r = await enviar(envioId)
    return r.estado
}

const enviar = (envioId: number) =>
    new EnviarNotificacion().execute({ envioId, intento: 1, maxIntentos: 3 }, contextoSistema('worker'))

/** Cliente con servicio y una factura vencida de Q 150.00 (vence 2026-10-15). */
async function clienteConVencida() {
    const clienteId = await crearCliente({ email: 'wa@prueba.local' })
    const servicioId = await crearServicio(clienteId)
    const facturaId = await crearFactura(clienteId, servicioId, { estado: 'vencida', vence: '2026-10-15' })
    return { clienteId, servicioId, facturaId }
}

function webhook(
    client: any,
    evento: string,
    payload: Record<string, unknown>,
    id: string,
    secreto = SECRETO_ENTRADA,
) {
    const cuerpo = JSON.stringify({ id, evento, ocurrido_en: new Date().toISOString(), payload })
    return client
        .post('/api/v1/integraciones/iris/webhook')
        .headers(cabecerasFirmadas(secreto, id, cuerpo))
        .header('content-type', 'application/json')
        .json(JSON.parse(cuerpo))
}

async function limpiar() {
    await db.from('integraciones.iris_recibidos').delete()
    await db.from('integraciones.iris_conector').delete()
    await db.from('notify.consentimientos_iris').delete()
    await db.from('notify.contacto_iris').delete()
    await db.from('notify.configuracion_canales').delete()
    await recargarConfiguracion()
}

test.group('notify · WhatsApp por Iris (contrato 0.6.0 §6)', (group) => {
    group.each.setup(async () => {
        iris = await new IrisSimulado().iniciar()
        correo = new CanalFalso('correo')
        registrarCanal('correo', correo)
        await limpiar()
        return async () => {
            reiniciarCanales()
            await limpiar()
            await iris.detener()
        }
    })

    test('factura.vencida: aviso a Iris sin número, con Idempotency-Key; 202 en_cola espera el webhook', async ({
        assert,
        client,
    }) => {
        iris.responder(AVISOS, () => ({ status: 202, cuerpo: { aviso_id: 'av-1', estado: 'en_cola' } }))
        await fijarConector()
        await fijarWhatsapp(true)
        const { clienteId, servicioId, facturaId } = await clienteConVencida()

        const envios = await programar('factura.vencida', {
            factura_id: facturaId,
            empresa_id: 1,
            servicio_id: servicioId,
            cliente_id: clienteId,
            total: '150.00',
            vence: '2026-10-15',
        })
        // correo sigue igual; WhatsApp es un envío más
        assert.sameMembers(
            envios.map((e) => e.canal),
            ['correo', 'whatsapp'],
        )
        const wa = envios.find((e) => e.canal === 'whatsapp')!
        assert.containsSubset(wa, {
            estado: 'encolado',
            cuerpo: 'factura_vencida',
            destino: `iris:cliente:${clienteId}`,
        })

        assert.deepEqual(await enviar(wa.id), { estado: 'en_cola' })
        const peticiones = iris.de(AVISOS)
        assert.lengthOf(peticiones, 1)
        const p = peticiones[0]!
        assert.equal(p.cabeceras['idempotency-key'], `argos:aviso:factura_vencida:${wa.id}`)
        assert.equal(p.cabeceras.authorization, `Bearer ${TOKEN}`)
        assert.equal(
            p.cuerpo,
            JSON.stringify({
                empresa_id: 1,
                cliente_id: clienteId,
                servicio_id: servicioId,
                plantilla: 'factura_vencida',
                variables: { monto: '150.00', moneda: 'GTQ', vence_en: '2026-10-15' },
                canal_preferido: 'whatsapp',
                prioridad: 'normal',
            }),
        )
        assert.notInclude(p.cuerpo, 'telefono')
        let fila = await db.from('notify.envios').where('id', wa.id).firstOrFail()
        assert.containsSubset(fila, { estado: 'encolado', proveedor_id: 'av-1', error: null })

        // un job repetido no vuelve a pedirlo
        assert.deepEqual(await enviar(wa.id), { estado: 'en_cola' })
        assert.lengthOf(iris.de(AVISOS), 1)

        // Iris confirma la entrega por webhook firmado; repetido, se deduplica
        const acuse = {
            aviso_id: 'av-1',
            empresa_id: 1,
            idempotency_key: `argos:aviso:factura_vencida:${wa.id}`,
            canal: 'whatsapp',
            entregado_en: '2026-11-05T15:00:00.000Z',
            leido_en: null,
        }
        const r1 = await estado(webhook(client, 'aviso.entregado', acuse, 'iris-wh-1'), 202)
        assert.containsSubset(r1.body(), { recibido: true, duplicado: false, resultado: 'acuse_aplicado' })
        const r2 = await estado(webhook(client, 'aviso.entregado', acuse, 'iris-wh-1'), 202)
        assert.containsSubset(r2.body(), { duplicado: true })

        fila = await db.from('notify.envios').where('id', wa.id).firstOrFail()
        assert.equal(fila.estado, 'enviado')
        assert.equal(new Date(fila.entregado_en).toISOString(), '2026-11-05T15:00:00.000Z')
        const eventos = await db
            .from('audit.outbox')
            .where('evento', 'notificacion.enviada')
            .whereRaw(`payload->>'canal' = 'whatsapp'`)
            .whereRaw(`(payload->>'cliente_id')::bigint = ?`, [clienteId])
        assert.lengthOf(eventos, 1)
        assert.equal(eventos[0].payload.estado, 'enviado')
        assert.lengthOf(await db.from('integraciones.iris_recibidos').where('webhook_id', 'iris-wh-1'), 1)
    })

    test('202 bloqueado → omitido con el motivo de Iris; aviso.fallido → fallido con el motivo', async ({
        assert,
        client,
    }) => {
        let respuesta: any = { aviso_id: 'av-b', estado: 'bloqueado', motivo: 'sin_permiso' }
        iris.responder(AVISOS, () => ({ status: 202, cuerpo: respuesta }))
        await fijarConector()
        await fijarWhatsapp(true)
        const clienteId = await crearCliente({ email: 'wa2@prueba.local' })
        const pago = {
            pago_id: PAGO_SIN_COMPROBANTE,
            cliente_id: clienteId,
            monto: '25.00',
            metodo: 'caja',
            facturas: [],
        }

        const primero = await waDe('pago.registrado', pago)
        assert.equal(primero!.cuerpo, 'pago_recibido')
        assert.equal(await estadoDe(primero!.id), 'omitido')
        const omitido = await db.from('notify.envios').where('id', primero!.id).firstOrFail()
        assert.containsSubset(omitido, { estado: 'omitido', motivo: 'Iris: sin_permiso' })
        const variables = JSON.parse(iris.de(AVISOS)[0]!.cuerpo).variables
        assert.deepEqual(Object.keys(variables), ['monto', 'moneda', 'fecha'])
        assert.match(variables.fecha, /^\d{4}-\d{2}-\d{2}$/)

        respuesta = { aviso_id: 'av-c', estado: 'en_cola' }
        // otro pago (un pago se avisa una sola vez por cliente, `avisos_pago.ts`)
        const segundo = await waDe('pago.registrado', { ...pago, pago_id: PAGO_SIN_COMPROBANTE - 1 })
        await enviar(segundo!.id)
        await estado(
            webhook(
                client,
                'aviso.fallido',
                {
                    aviso_id: 'av-c',
                    empresa_id: 1,
                    idempotency_key: `argos:aviso:pago_recibido:${segundo!.id}`,
                    canal: 'whatsapp',
                    motivo: 'numero_invalido',
                    detalle: 'Meta 131026',
                },
                'iris-wh-2',
            ),
            202,
        )
        const fallido = await db.from('notify.envios').where('id', segundo!.id).firstOrFail()
        assert.equal(fallido.estado, 'fallido')
        assert.equal(fallido.error, 'Iris: numero_invalido (Meta 131026)')
    })

    test('interruptor apagado: sin envío por WhatsApp; conector apagado o contrato < 0.6.0: omitido visible', async ({
        assert,
    }) => {
        iris.responder(AVISOS, () => ({ status: 202, cuerpo: { aviso_id: 'x', estado: 'en_cola' } }))
        const { clienteId, servicioId, facturaId } = await clienteConVencida()
        const payload = {
            factura_id: facturaId,
            empresa_id: 1,
            servicio_id: servicioId,
            cliente_id: clienteId,
        }

        await fijarConector()
        await fijarWhatsapp(false)
        assert.deepEqual(await canalesDe('factura.vencida', payload), ['correo'])

        await fijarWhatsapp(true)
        await fijarConector({ contrato: '0.5.0' })
        let wa = (await waDe('factura.vencida', payload))!
        assert.equal(wa.estado, 'omitido')
        assert.include(wa.motivo, 'contrato anterior a 0.6.0')

        await fijarConector({ activo: false })
        wa = (await waDe('factura.vencida', payload))!
        assert.equal(wa.estado, 'omitido')
        assert.include(wa.motivo, 'conector Iris está apagado')

        // encolado con el conector bien y apagado antes de enviarse: omitido sin llamar a Iris
        await fijarConector()
        wa = (await waDe('factura.vencida', payload))!
        assert.equal(wa.estado, 'encolado')
        await fijarConector({ activo: false })
        assert.equal(await estadoDe(wa.id), 'omitido')
        assert.lengthOf(iris.de(AVISOS), 0)
    })

    test('servicio.estado_cambiado: corte por facturas vencidas, reactivación y suspensión manual', async ({
        assert,
    }) => {
        await fijarConector()
        await fijarWhatsapp(true)
        const { clienteId, servicioId } = await clienteConVencida()
        const base = { servicio_id: servicioId, empresa_id: 1, cliente_id: clienteId }

        const corte = (await waDe('servicio.estado_cambiado', {
            ...base,
            de: 'activo',
            a: 'suspendido',
            motivo: '1 factura vencida (se corta con 1)',
        }))!
        assert.equal(corte.cuerpo, 'corte_por_falta_de_pago')
        assert.deepEqual(corte.variables.iris, {
            plantilla: 'corte_por_falta_de_pago',
            variables: { monto: '150.00', moneda: 'GTQ' },
        })

        const vuelta = (await waDe('servicio.estado_cambiado', {
            ...base,
            de: 'suspendido',
            a: 'activo',
            motivo: '0 facturas vencidas',
        }))!
        assert.equal(vuelta.cuerpo, 'servicio_reactivado')
        assert.deepEqual(vuelta.variables.iris.variables, {})

        const manual = await programar('servicio.estado_cambiado', {
            ...base,
            de: 'activo',
            a: 'suspendido',
            motivo: 'suspensión manual: pidió el cliente',
        })
        assert.notInclude(
            manual.map((e) => e.canal),
            'whatsapp',
        )
    })

    test('contacto.baja: deja de pedir WhatsApp a ese cliente (correo igual) y queda en su línea de tiempo', async ({
        assert,
        client,
    }) => {
        await fijarConector()
        await fijarWhatsapp(true)
        const { clienteId, servicioId, facturaId } = await clienteConVencida()
        const r = await estado(
            webhook(
                client,
                'contacto.baja',
                {
                    cliente_id: clienteId,
                    empresa_id: 1,
                    canal: 'whatsapp',
                    ocurrido_en: new Date().toISOString(),
                    origen: 'cliente',
                },
                'iris-wh-baja',
            ),
            202,
        )
        assert.containsSubset(r.body(), { resultado: 'baja_registrada' })
        const envios = await programar('factura.vencida', {
            factura_id: facturaId,
            empresa_id: 1,
            servicio_id: servicioId,
            cliente_id: clienteId,
        })
        assert.deepEqual(
            envios.map((e) => e.canal),
            ['correo'],
        )
        const auditoria = await db
            .from('audit.acciones')
            .where('accion', 'iris.recibir_webhook')
            .where('entidad_tipo', 'cliente')
            .where('entidad_id', clienteId)
        assert.lengthOf(auditoria, 1)

        // un alta posterior en Argos levanta la baja en Argos (Iris decide igual)
        await new RegistrarConsentimientoWhatsapp().execute(
            { cliente_id: clienteId, estado: 'acepta', origen: 'argos_panel' },
            contextoPrueba(),
        )
        const otra = await programar('factura.vencida', {
            factura_id: facturaId,
            empresa_id: 1,
            servicio_id: servicioId,
            cliente_id: clienteId,
        })
        assert.include(
            otra.map((e) => e.canal),
            'whatsapp',
        )
    })

    test('receptor: firma inválida 401, conector apagado 503, evento desconocido ignorado', async ({
        client,
    }) => {
        await fijarConector()
        await estado(webhook(client, 'aviso.entregado', {}, 'iris-wh-x', 'otro-secreto'), 401)
        const r = await estado(webhook(client, 'evento.nuevo', {}, 'iris-wh-y'), 202)
        r.assertBodyContains({ estado: 'ignorado', resultado: 'evento_desconocido' })
        await fijarConector({ activo: false })
        await estado(webhook(client, 'aviso.entregado', {}, 'iris-wh-z'), 503)
    })

    test('consentimiento: POST del panel → cola; espera al conector; sale con Idempotency-Key; 5xx reintenta', async ({
        assert,
        client,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const clienteId = await crearCliente()
        await fijarConector({ activo: false })
        const r = await estado(
            client
                .post('/api/v1/notificaciones/consentimientos')
                .bearerToken(token)
                .json({ cliente_id: clienteId, estado: 'acepta' }),
            201,
        )
        const creado = r.body()
        assert.containsSubset(creado, {
            cliente_id: clienteId,
            canal: 'whatsapp',
            origen: 'argos_panel',
            entrega: 'pendiente',
        })
        assert.equal(
            creado.idempotency_key,
            `argos:consentimiento:${clienteId}:whatsapp:${creado.ocurrido_en}`,
        )

        // conector apagado: sigue pendiente sin gastar intentos
        assert.containsSubset(await entregarConsentimientosIris(), { en_espera: 1 })

        let status = 503
        // Iris 0.6.1: 201 { consentimiento_id, estado_vigente }; aquí quedó vigente una baja del chat
        iris.responder(CONSENTIMIENTOS, () =>
            status < 300
                ? { status, cuerpo: { consentimiento_id: 'cons-1', estado_vigente: 'baja' } }
                : { status, cuerpo: { error: 'caido' } },
        )
        await fijarConector()
        assert.containsSubset(await entregarConsentimientosIris(), { reintentar: 1 })
        status = 201
        // el reintento toca en 1 min
        const despues = new Date(Date.now() + 61_000)
        assert.containsSubset(await entregarConsentimientosIris({ ahora: despues }), { enviados: 1 })

        const peticiones = iris.de(CONSENTIMIENTOS)
        assert.lengthOf(peticiones, 2)
        assert.equal(peticiones[0]!.cuerpo, peticiones[1]!.cuerpo)
        assert.equal(peticiones[1]!.cabeceras['idempotency-key'], creado.idempotency_key)
        assert.deepEqual(peticiones[1]!.json, {
            empresa_id: 1,
            cliente_id: clienteId,
            canal: 'whatsapp',
            estado: 'acepta',
            origen: 'argos_panel',
            ocurrido_en: creado.ocurrido_en,
        })
        const fila = await db.from('notify.consentimientos_iris').where('id', creado.id).firstOrFail()
        assert.containsSubset(fila, {
            entrega: 'enviado',
            intentos: 2,
            consentimiento_id: 'cons-1',
            estado_vigente: 'baja',
        })

        const ficha = await estado(
            client.get(`/api/v1/notificaciones/whatsapp/clientes/${clienteId}`).bearerToken(token),
            200,
        )
        assert.containsSubset(ficha.body(), {
            cliente_id: clienteId,
            canal: { activo: false, disponible: false },
            // Argos adopta el estado vigente de Iris: no pide avisos por WhatsApp
            contacto: { estado: 'baja', origen: 'iris_vigente' },
            ultimo_consentimiento: { id: creado.id, entrega: 'enviado', estado_vigente: 'baja' },
        })
    })

    test('lo que nace en Iris no se avisa por ningún canal (comprobante, promesa)', async ({ assert }) => {
        await fijarConector()
        await fijarWhatsapp(true)
        const clienteId = await crearCliente({ email: 'iris@prueba.local' })
        const servicioId = await crearServicio(clienteId)
        for (const [evento, payload] of [
            [
                'comprobante.rechazado',
                {
                    comprobante_id: 1_999_999_998,
                    empresa_id: 1,
                    cliente_id: clienteId,
                    canal: 'iris',
                    motivo: 'ilegible',
                },
            ],
            [
                'promesa.creada',
                {
                    promesa_id: 1_999_999_997,
                    empresa_id: 1,
                    servicio_id: servicioId,
                    cliente_id: clienteId,
                    vence: '2026-11-10T05:59:59Z',
                    monto: '150.00',
                    origen: 'iris',
                },
            ],
        ] as const) {
            assert.lengthOf(await programar(evento, payload), 0, evento)
        }
        // el mismo comprobante desde el portal sí se avisa
        const portal = await programar('comprobante.rechazado', {
            comprobante_id: 1_999_999_998,
            empresa_id: 1,
            cliente_id: clienteId,
            canal: 'portal',
            motivo: 'ilegible',
        })
        assert.isAbove(portal.length, 0)
    })

    test('conciliación: un aviso en cola hace más de 24 h se consulta en Iris y se cierra', async ({
        assert,
    }) => {
        iris.responder(AVISOS, () => ({ status: 202, cuerpo: { aviso_id: 'av-viejo', estado: 'en_cola' } }))
        iris.responder(`${AVISOS}/av-viejo`, () => ({
            status: 200,
            cuerpo: {
                aviso_id: 'av-viejo',
                estado: 'entregado',
                entregado_en: '2026-11-04T10:00:00Z',
                leido_en: null,
            },
        }))
        await fijarConector()
        await fijarWhatsapp(true)
        const { clienteId, servicioId, facturaId } = await clienteConVencida()
        const wa = (await waDe('factura.vencida', {
            factura_id: facturaId,
            empresa_id: 1,
            servicio_id: servicioId,
            cliente_id: clienteId,
        }))!
        await enviar(wa.id)
        const r = await new ConciliarAvisosIris().execute(
            { ahora: new Date(Date.now() + 25 * 3600 * 1000) },
            contextoSistema('worker'),
        )
        assert.containsSubset(r, { entregados: 1 })
        const fila = await db.from('notify.envios').where('id', wa.id).firstOrFail()
        assert.equal(fila.estado, 'enviado')
    })

    test('consentimiento: 422 de Iris no se reintenta; empresa obligatoria', async ({ assert }) => {
        iris.responder(CONSENTIMIENTOS, () => ({ status: 422, cuerpo: { type: 'validacion' } }))
        await fijarConector()
        const clienteId = await crearCliente()
        const r = await new RegistrarConsentimientoWhatsapp().execute(
            { cliente_id: clienteId, estado: 'baja', origen: 'argos_portal', empresa_id: 1 },
            contextoPrueba(),
        )
        assert.equal(r.empresa_id, 1)
        assert.containsSubset(await entregarConsentimientosIris(), { fallidos: 1 })
        const fila = await db.from('notify.consentimientos_iris').where('id', r.id).firstOrFail()
        assert.containsSubset(fila, { entrega: 'fallido', intentos: 1, ultimo_status: 422 })
        assert.lengthOf(iris.de(CONSENTIMIENTOS), 1)
    })

    test('conciliación: bloqueado en el GET → omitido con el motivo; X-Webhook-Id distinto del id → 400', async ({
        assert,
        client,
    }) => {
        iris.responder(AVISOS, () => ({ status: 202, cuerpo: { aviso_id: 'av-bloq', estado: 'en_cola' } }))
        iris.responder(`${AVISOS}/av-bloq`, () => ({
            status: 200,
            cuerpo: { aviso_id: 'av-bloq', estado: 'bloqueado', motivo: 'limite_diario', detalle: null },
        }))
        await fijarConector()
        await fijarWhatsapp(true)
        const { clienteId, servicioId, facturaId } = await clienteConVencida()
        const wa = (await waDe('factura.vencida', {
            factura_id: facturaId,
            empresa_id: 1,
            servicio_id: servicioId,
            cliente_id: clienteId,
        }))!
        await enviar(wa.id)
        const r = await new ConciliarAvisosIris().execute(
            { ahora: new Date(Date.now() + 25 * 3600 * 1000) },
            contextoSistema('worker'),
        )
        assert.isAtLeast(r.omitidos, 1)
        const fila = await db.from('notify.envios').where('id', wa.id).firstOrFail()
        assert.containsSubset(fila, { estado: 'omitido', motivo: 'Iris: limite_diario' })

        const cuerpo = JSON.stringify({
            id: 'otro-id',
            evento: 'aviso.entregado',
            ocurrido_en: null,
            payload: {},
        })
        await estado(
            client
                .post('/api/v1/integraciones/iris/webhook')
                .headers(cabecerasFirmadas(SECRETO_ENTRADA, 'iris-wh-dist', cuerpo))
                .json(JSON.parse(cuerpo)),
            400,
        )
    })
})
