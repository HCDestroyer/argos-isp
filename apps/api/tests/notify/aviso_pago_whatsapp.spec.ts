import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar } from '#shared/cifrado'
import { estado, usuarioConRoles } from '#tests/ayudas'
import { recargarConfiguracion } from '#notify/configuracion'
import { crearCliente } from '#tests/notify/ayudas_notify'

/**
 * `GET /notificaciones/pagos/:id/whatsapp`: lo que lee la pantalla de éxito del cobro para saber si el
 * comprobante sale por WhatsApp (Iris) y en qué estado va. Permiso `pagos.ver` (el cajero lo tiene).
 */

async function fijarCanal(activo: boolean, conector: boolean) {
    await db.from('integraciones.iris_conector').delete()
    if (conector) {
        await db.table('integraciones.iris_conector').insert({
            id: 1,
            activo: true,
            url_base: 'http://iris.local',
            token_cifrado: cifrar('iris_pat_prueba'),
            webhook_entrada_secreto_cifrado: cifrar('whsec_prueba'),
            contrato: '0.6.0',
        })
    }
    await db.from('notify.configuracion_canales').delete()
    await db
        .table('notify.configuracion_canales')
        .insert({ empresa_id: null, hereda: false, whatsapp_activo: activo })
    await recargarConfiguracion()
}

async function crearPagoDe(clienteId: number): Promise<number> {
    const [fila] = (await db
        .table('billing.pagos')
        .insert({ cliente_id: clienteId, metodo: 'agente', monto: '150.00' })
        .returning('id')) as Array<{ id: number }>
    return fila!.id
}

test.group('notify · aviso de un pago por WhatsApp', (group) => {
    group.each.teardown(async () => {
        await db.from('integraciones.iris_conector').delete()
        await db.from('notify.configuracion_canales').delete()
        await recargarConfiguracion()
    })

    test('canal apagado: no disponible, con su motivo y sin envío', async ({ client, assert }) => {
        await fijarCanal(false, false)
        const pagoId = await crearPagoDe(await crearCliente())
        const { token } = await usuarioConRoles(['cajero'])
        const r = await estado(client.get(`/api/v1/notificaciones/pagos/${pagoId}/whatsapp`).bearerToken(token), 200)
        assert.isFalse(r.body().canal.disponible)
        assert.isString(r.body().canal.motivo)
        assert.isNull(r.body().envio)
    })

    test('canal activo: devuelve el último envío del pago y no el de otro pago', async ({ client, assert }) => {
        await fijarCanal(true, true)
        const clienteId = await crearCliente()
        const pagoId = await crearPagoDe(clienteId)
        const otroId = await crearPagoDe(clienteId)
        const fila = (pago: number, estadoEnvio: string, n: number) => ({
            origen: `prueba:${pago}:${n}`,
            evento: 'pago.registrado',
            cliente_id: clienteId,
            canal: 'whatsapp',
            destino: `iris:cliente:${clienteId}`,
            estado: estadoEnvio,
            variables: JSON.stringify({ pago: { id: pago } }),
        })
        await db.table('notify.envios').multiInsert([fila(otroId, 'fallido', 1), fila(pagoId, 'encolado', 2)])
        const { token } = await usuarioConRoles(['cajero'])
        const r = await estado(client.get(`/api/v1/notificaciones/pagos/${pagoId}/whatsapp`).bearerToken(token), 200)
        assert.isTrue(r.body().canal.disponible)
        assert.equal(r.body().envio.estado, 'encolado')
        assert.equal(r.body().pago_id, pagoId)
    })

    test('pago inexistente: 404; sin permiso de pagos: 403', async ({ client }) => {
        const { token } = await usuarioConRoles(['cajero'])
        await estado(client.get('/api/v1/notificaciones/pagos/2000000000/whatsapp').bearerToken(token), 404)
        const sin = await usuarioConRoles(['tecnico'])
        const pagoId = await crearPagoDe(await crearCliente())
        await estado(client.get(`/api/v1/notificaciones/pagos/${pagoId}/whatsapp`).bearerToken(sin.token), 403)
    })
})
