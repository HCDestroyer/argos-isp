import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar } from '#shared/cifrado'
import { estado } from '#tests/ayudas'
import { crearClienteFila } from '#tests/core/fabricas'
import { cabecerasFirmadas } from '#integraciones/horus/firma'

/**
 * Webhooks Iris → Argos de soporte (contrato Iris 0.9.0 §6.6, A30 y A31): `ticket.estado_cambiado`,
 * `ticket.respondido` y `solicitud_servicio.estado_cambiado`. Deduplicados por `X-Webhook-Id`; se
 * reemiten al bus como `soporte.*` para que notify avise al cliente.
 */

const SECRETO = 'whsec_secreto-del-receptor-de-argos-para-iris-090'

async function fijarConector() {
    await db.from('integraciones.iris_conector').delete()
    await db.table('integraciones.iris_conector').insert({
        id: 1,
        activo: true,
        url_base: 'https://iris.isp.example',
        token_cifrado: cifrar(`iris_pat_${'Qw3Er4Ty'.repeat(5)}`),
        webhook_entrada_secreto_cifrado: cifrar(SECRETO),
        contrato: '0.9.0',
    })
}

function webhook(
    client: any,
    evento: string,
    payload: Record<string, unknown>,
    id = `iris-evt-${randomUUID()}`,
) {
    const cuerpo = JSON.stringify({ id, evento, ocurrido_en: new Date().toISOString(), payload })
    return client
        .post('/api/v1/integraciones/iris/webhook')
        .headers(cabecerasFirmadas(SECRETO, id, cuerpo))
        .header('content-type', 'application/json')
        .json(JSON.parse(cuerpo))
}

async function eventos(nombre: string, clienteId: number) {
    return db
        .from('audit.outbox')
        .where('evento', nombre)
        .whereRaw(`(payload->>'cliente_id')::bigint = ?`, [clienteId])
        .orderBy('id')
}

test.group('Iris 0.9.0 · webhooks de tickets y solicitudes', (group) => {
    group.each.setup(async () => {
        await db.from('integraciones.iris_recibidos').delete()
        await fijarConector()
        return async () => {
            await db.from('integraciones.iris_recibidos').delete()
            await db.from('integraciones.iris_conector').delete()
        }
    })

    test('ticket.estado_cambiado: emite soporte.ticket_estado_cambiado una sola vez por X-Webhook-Id', async ({
        client,
        assert,
    }) => {
        const clienteId = await crearClienteFila()
        const id = `iris-evt-${randomUUID()}`
        const payload = {
            ticket_id: 'tk-77',
            numero: 'TK-000077',
            empresa_id: 1,
            cliente_id: clienteId,
            servicio_id: null,
            origen: 'portal_argos',
            de: 'en_proceso',
            a: 'resuelto',
            puede_confirmar: true,
        }
        await estado(webhook(client, 'ticket.estado_cambiado', payload, id), 202)
        await estado(webhook(client, 'ticket.estado_cambiado', payload, id), 202)
        const evs = await eventos('soporte.ticket_estado_cambiado', clienteId)
        assert.lengthOf(evs, 1)
        assert.containsSubset(evs[0].payload, {
            ticket_id: 'tk-77',
            numero: 'TK-000077',
            empresa_id: 1,
            a: 'resuelto',
            puede_confirmar: true,
            webhook_id: id,
        })
        const recibido = await db.from('integraciones.iris_recibidos').where('webhook_id', id).first()
        assert.equal(recibido.estado, 'procesado')
        assert.equal(recibido.resultado, 'aviso_emitido')
        assert.equal(Number(recibido.cliente_id), clienteId)
    })

    test('ticket.respondido lleva masivo y aviso_por_correo; solicitud_servicio.estado_cambiado', async ({
        client,
        assert,
    }) => {
        const clienteId = await crearClienteFila()
        await estado(
            webhook(client, 'ticket.respondido', {
                ticket_id: 'tk-8',
                numero: 'TK-000008',
                empresa_id: 1,
                cliente_id: clienteId,
                mensaje_id: 'm-1',
                autor_tipo: 'agente',
                masivo: true,
                aviso_por_correo: true,
            }),
            202,
        )
        const [respondido] = await eventos('soporte.ticket_respondido', clienteId)
        assert.containsSubset(respondido!.payload, {
            masivo: true,
            aviso_por_correo: true,
            autor_tipo: 'agente',
        })

        await estado(
            webhook(client, 'solicitud_servicio.estado_cambiado', {
                solicitud_id: 's-3',
                numero: 'SOL-000003',
                empresa_id: 1,
                cliente_id: clienteId,
                tipo: 'traslado',
                servicio_id: null,
                de: 'recibida',
                a: 'en_revision',
            }),
            202,
        )
        const [solicitud] = await eventos('soporte.solicitud_estado_cambiado', clienteId)
        assert.containsSubset(solicitud!.payload, { solicitud_id: 's-3', tipo: 'traslado', a: 'en_revision' })
    })

    test('cliente inexistente o payload inválido: se registra ignorado y no emite nada', async ({
        client,
        assert,
    }) => {
        const id = `iris-evt-${randomUUID()}`
        await estado(
            webhook(
                client,
                'ticket.estado_cambiado',
                { ticket_id: 'x', cliente_id: 999_999_999, a: 'cerrado' },
                id,
            ),
            202,
        )
        const fila = await db.from('integraciones.iris_recibidos').where('webhook_id', id).first()
        assert.equal(fila.estado, 'ignorado')
        assert.equal(fila.resultado, 'cliente_no_encontrado')
        const clienteId = await crearClienteFila()
        const otro = `iris-evt-${randomUUID()}`
        await estado(
            webhook(client, 'ticket.respondido', { ticket_id: 'x', cliente_id: clienteId }, otro),
            202,
        )
        const invalido = await db.from('integraciones.iris_recibidos').where('webhook_id', otro).first()
        assert.equal(invalido.resultado, 'payload_invalido')
        assert.lengthOf(await eventos('soporte.ticket_respondido', clienteId), 0)
    })
})
