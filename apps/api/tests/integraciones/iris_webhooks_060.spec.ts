import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar } from '#shared/cifrado'
import { contextoPrueba } from '#tests/ayudas'
import { crearCliente, crearServicio, eventoOutbox } from '#tests/notify/ayudas_notify'
import GenerarTokenIris from '#core/actions/generar_token_iris'
import { usuarioIris } from '#core/integraciones_iris'
import { ConsumidorIris } from '#integraciones/iris/consumidor'
import { EVENTOS_DESDE_060 } from '#integraciones/iris/envios'

/**
 * Webhooks Argos → Iris del contrato 0.6.0 (§2.3, §7.2, §7.4): `comprobante.aprobado` /
 * `.rechazado` y `promesa.*` solo a conectores con contrato ≥ 0.6.0, con la lista cerrada de campos
 * del contrato (lo que A3 no trae se completa con la fila o con el valor por defecto del contrato).
 */

const consumidor = new ConsumidorIris()

async function fijarConector(contrato: string | null) {
    await db.from('integraciones.iris_conector').delete()
    await db.table('integraciones.iris_conector').insert({
        id: 1,
        activo: true,
        url_base: 'http://127.0.0.1:9',
        token_cifrado: cifrar(`iris_pat_${'Zx9Yw8Vu'.repeat(5)}`),
        webhook_salida_url: 'http://127.0.0.1:9/api/v1/integraciones/argosisp/webhook/c-1',
        webhook_salida_secreto_cifrado: cifrar('secreto-del-receptor-de-iris-0123456789'),
        contrato,
    })
}

async function usuarioTecnicoGlobal() {
    let id = await usuarioIris()
    if (id === null) {
        await new GenerarTokenIris().execute({}, contextoPrueba())
        id = (await usuarioIris())!
    }
    await db.from('core.usuarios').where('id', id).update({ activo: true, alcance_global: true })
}

async function evento(nombre: string, payload: Record<string, unknown>) {
    const id = await eventoOutbox(nombre, payload)
    await consumidor.procesar({ id, evento: nombre, payload })
    const fila = await db.from('integraciones.iris_envios').where('evento_id', `argos-evt-${id}`).first()
    return fila ? JSON.parse(fila.cuerpo).payload : null
}

test.group('integraciones · iris · webhooks 0.6.0 (comprobantes y promesas)', (group) => {
    group.each.setup(async () => {
        await db.from('integraciones.iris_envios').delete()
        await usuarioTecnicoGlobal()
        return async () => {
            await db.from('integraciones.iris_envios').delete()
            await db.from('integraciones.iris_conector').delete()
        }
    })

    test('con contrato 0.5.0 (o sin contrato) no se envían; con 0.6.0 sí', async ({ assert }) => {
        assert.isTrue(EVENTOS_DESDE_060.every((e) => consumidor.acepta(e)))
        const payload = {
            promesa_id: 1_999_999_990,
            empresa_id: 1,
            servicio_id: 1,
            cliente_id: 1,
            vence: '2026-11-10T05:59:59Z',
            monto: '150',
        }
        await fijarConector('0.5.0')
        assert.isNull(await evento('promesa.creada', payload))
        await fijarConector(null)
        assert.isNull(await evento('promesa.creada', payload))
        await fijarConector('0.6.0')
        assert.isNotNull(await evento('promesa.creada', payload))
    })

    test('comprobante.aprobado / .rechazado: campos de §7.2', async ({ assert }) => {
        await fijarConector('0.6.0')
        const clienteId = await crearCliente()
        const servicioId = await crearServicio(clienteId)
        const aprobado = await evento('comprobante.aprobado', {
            comprobante_id: 1_999_999_991,
            empresa_id: 1,
            cliente_id: clienteId,
            servicio_id: servicioId,
            canal: 'iris',
            monto: '300',
            pago_id: 77,
            motivo: null,
            referencia: '123456',
        })
        // sin servicio_estado en el evento: el estado actual del servicio
        assert.deepEqual(aprobado, {
            comprobante_id: 1_999_999_991,
            empresa_id: 1,
            cliente_id: clienteId,
            servicio_id: servicioId,
            canal: 'iris',
            monto: '300.00',
            pago_id: 77,
            motivo: null,
            causa: null,
            servicio_estado: 'activo',
        })

        const rechazado = await evento('comprobante.rechazado', {
            comprobante_id: 1_999_999_992,
            empresa_id: 1,
            cliente_id: clienteId,
            servicio_id: null,
            canal: 'portal',
            monto: '120.50',
            pago_id: null,
            motivo: 'No aparece en el banco',
            causa: 'no_aparece',
        })
        assert.deepEqual(rechazado, {
            comprobante_id: 1_999_999_992,
            empresa_id: 1,
            cliente_id: clienteId,
            servicio_id: null,
            canal: 'portal',
            monto: '120.50',
            pago_id: null,
            motivo: 'No aparece en el banco',
            causa: 'no_aparece',
            servicio_estado: null,
        })

        // un rechazo sin causa (A3 anterior a 0.6.0) sale como `otro`
        const sinCausa = await evento('comprobante.rechazado', {
            comprobante_id: 1_999_999_993,
            empresa_id: 1,
            cliente_id: clienteId,
            motivo: 'x',
        })
        assert.equal(sinCausa.causa, 'otro')
    })

    test('promesa.*: campos de §7.4; cancelada lleva motivo', async ({ assert }) => {
        await fijarConector('0.6.0')
        const base = {
            promesa_id: 1_999_999_994,
            empresa_id: 1,
            cliente_id: 5,
            servicio_id: 9,
            vence: '2026-11-10T05:59:59Z',
            monto: '150',
        }
        const creada = await evento('promesa.creada', { ...base, canal: 'ia' })
        assert.deepEqual(creada, {
            promesa_id: 1_999_999_994,
            empresa_id: 1,
            cliente_id: 5,
            servicio_id: 9,
            tipo: 'promesa',
            canal: 'ia',
            comprobante_id: null,
            vence: '2026-11-10T05:59:59.000Z',
            monto: '150.00',
        })
        const cancelada = await evento('promesa.cancelada', {
            ...base,
            tipo: 'reconexion_temporal',
            canal: 'ia',
            comprobante_id: 44,
            motivo: 'comprobante_rechazado',
        })
        assert.containsSubset(cancelada, {
            tipo: 'reconexion_temporal',
            comprobante_id: 44,
            motivo: 'comprobante_rechazado',
        })
        assert.notProperty(creada, 'motivo')
    })
})
