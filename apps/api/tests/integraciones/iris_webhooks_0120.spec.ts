import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar } from '#shared/cifrado'
import { contextoPrueba, soloEmpresaPrincipal } from '#tests/ayudas'
import { prepararEmpresas } from '#tests/contabilidad/ayudas_contabilidad'
import { crearClienteFila } from '#tests/core/fabricas'
import { eventoOutbox } from '#tests/notify/ayudas_notify'
import GenerarTokenIris from '#core/actions/generar_token_iris'
import { usuarioIris } from '#core/integraciones_iris'
import EmitirCargoUnico from '#billing/actions/emitir_cargo_unico'
import RegistrarPago from '#billing/actions/registrar_pago'
import AnularPago from '#billing/actions/anular_pago'
import { ConsumidorIris } from '#integraciones/iris/consumidor'
import {
    EVENTOS_A_IRIS,
    EVENTOS_DESDE_090,
    EVENTOS_DESDE_0100,
    EVENTOS_DESDE_0120,
} from '#integraciones/iris/envios'

/**
 * Webhooks Argos → Iris nuevos (contrato 0.12.0 §2.3): el cobro de las órdenes de Iris (A36, 0.9.0),
 * contactos y cambio de titular (A42 y A39, 0.10.0) y equipos del cliente (A48, 0.12.0). Cada grupo
 * solo a conectores con contrato que lo soporte; listas cerradas de campos. Los eventos de A1 y A3
 * que todavía no están en main se prueban con un evento de muestra en el outbox.
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

async function reenviar(outboxId: number) {
    const fila = await db.from('audit.outbox').where('id', outboxId).first()
    const payload = typeof fila.payload === 'string' ? JSON.parse(fila.payload) : fila.payload
    await consumidor.procesar({ id: outboxId, evento: fila.evento, payload })
    const envio = await db
        .from('integraciones.iris_envios')
        .where('evento_id', `argos-evt-${outboxId}`)
        .first()
    return envio ? (JSON.parse(envio.cuerpo).payload as Record<string, unknown>) : null
}

async function outboxDe(evento: string, clave: string, id: number): Promise<number> {
    const fila = await db
        .from('audit.outbox')
        .where('evento', evento)
        .whereRaw(`(payload->>'${clave}')::bigint = ?`, [id])
        .orderBy('id', 'desc')
        .firstOrFail()
    return Number(fila.id)
}

async function visita(empresaId: number): Promise<number> {
    const fila = await db
        .from('billing.conceptos_cargo')
        .where({ empresa_id: empresaId, nombre: 'Visita técnica' })
        .firstOrFail()
    return Number(fila.id)
}

test.group('integraciones · iris · webhooks 0.9.0 a 0.12.0', (group) => {
    group.each.setup(async () => {
        await db.from('integraciones.iris_envios').delete()
        await usuarioTecnicoGlobal()
        return async () => {
            await db.from('integraciones.iris_envios').delete()
            await db.from('integraciones.iris_conector').delete()
            await soloEmpresaPrincipal()
        }
    })

    test('listas por versión: todos en EVENTOS_A_IRIS y el consumidor los acepta', ({ assert }) => {
        for (const e of [...EVENTOS_DESDE_090, ...EVENTOS_DESDE_0100, ...EVENTOS_DESDE_0120]) {
            assert.include(EVENTOS_A_IRIS as readonly string[], e)
            assert.isTrue(consumidor.acepta(e))
        }
    })

    test('A36: factura y pago de una orden de Iris salen con 0.9.0; la factura sin origen no sale', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const clienteId = await crearClienteFila()
        const orden = randomUUID()
        const ctx = { ...e.ctx, empresaId: e.B }
        const concepto = await visita(e.B)
        const conOrden = (await new EmitirCargoUnico().execute(
            {
                cliente_id: clienteId,
                empresa_id: e.B,
                lineas: [{ concepto_id: concepto, precio_unitario: '112.00' }],
                origen_tipo: 'iris_orden',
                origen_id: orden,
            },
            ctx,
        )) as { id: number; documento: string }
        const sinOrden = (await new EmitirCargoUnico().execute(
            {
                cliente_id: clienteId,
                empresa_id: e.B,
                lineas: [{ concepto_id: concepto, precio_unitario: '50.00' }],
            },
            ctx,
        )) as { id: number }

        const emitida = await outboxDe('factura.emitida', 'factura_id', conOrden.id)
        await fijarConector('0.8.1')
        assert.isNull(await reenviar(emitida))
        await fijarConector('0.9.0')
        assert.deepEqual(await reenviar(emitida), {
            factura_id: conOrden.id,
            numero: String(conOrden.id),
            empresa_id: e.B,
            cliente_id: clienteId,
            servicio_id: null,
            origen_tipo: 'iris_orden',
            origen_id: orden,
            estado: 'emitida',
            total: '112.00',
            saldo: '112.00',
            moneda: 'GTQ',
        })
        assert.isNull(await reenviar(await outboxDe('factura.emitida', 'factura_id', sinOrden.id)))

        const pago = await new RegistrarPago().execute(
            {
                cliente_id: clienteId,
                metodo: 'caja',
                monto: '40.00',
                facturas: [conOrden.id],
                empresa_id: e.B,
            },
            e.ctx,
        )
        const registrado = await reenviar(await outboxDe('pago.registrado', 'pago_id', pago.id))
        assert.include(registrado!, {
            pago_id: pago.id,
            factura_id: conOrden.id,
            origen_tipo: 'iris_orden',
            origen_id: orden,
            empresa_id: e.B,
            monto: '40.00',
        })
        assert.match(String(registrado!.fecha), /^\d{4}-\d{2}-\d{2}T/)
        assert.sameMembers(Object.keys(registrado!), [
            'pago_id',
            'factura_id',
            'origen_tipo',
            'origen_id',
            'empresa_id',
            'monto',
            'fecha',
        ])

        await new AnularPago().execute({ pago_id: pago.id, motivo: 'boleta rechazada' }, e.ctx)
        const anulado = await reenviar(await outboxDe('pago.anulado', 'pago_id', pago.id))
        assert.include(anulado!, { pago_id: pago.id, factura_id: conOrden.id, monto: '40.00' })

        // Un pago sin facturas de Iris no sale
        const otro = await new RegistrarPago().execute(
            {
                cliente_id: clienteId,
                metodo: 'caja',
                monto: '50.00',
                facturas: [sinOrden.id],
                empresa_id: e.B,
            },
            e.ctx,
        )
        assert.isNull(await reenviar(await outboxDe('pago.registrado', 'pago_id', otro.id)))
    })

    test('A42: cliente.contactos_cambiados con 0.10.0, sin números; persona_cliente_id con valor solo con 0.10.1', async ({
        assert,
    }) => {
        const muestra = {
            cliente_id: 1201,
            empresa_id: 1,
            contacto_id: 77,
            accion: 'editado',
            campos: ['telefonos', 'permisos', 'telefonos', 'numero'],
            persona_cliente_id: 1300,
            telefonos: [{ numero: '+50255123344' }],
        }
        await fijarConector('0.9.0')
        assert.isNull(await reenviar(await eventoOutbox('cliente.contactos_cambiados', muestra)))
        await fijarConector('0.10.0')
        const p = await reenviar(await eventoOutbox('cliente.contactos_cambiados', muestra))
        assert.deepEqual(p, {
            cliente_id: 1201,
            empresa_id: 1,
            contacto_id: 77,
            accion: 'editado',
            campos: ['telefonos', 'permisos'],
            persona_cliente_id: null,
        })
        await fijarConector('0.10.1')
        const p2 = await reenviar(await eventoOutbox('cliente.contactos_cambiados', muestra))
        assert.equal(p2!.persona_cliente_id, 1300)
        assert.notInclude(JSON.stringify(p2), '+502')
    })

    test('A39: servicio.titular_cambiado con 0.10.0; nunca el texto del motivo ni el documento', async ({
        assert,
    }) => {
        await fijarConector('0.10.0')
        const p = await reenviar(
            await eventoOutbox('servicio.titular_cambiado', {
                servicio_id: 4410,
                empresa_id: 1,
                de_cliente_id: 10,
                a_cliente_id: 11,
                existente: true,
                posible_duplicado: false,
                de_cliente_eliminado: true,
                motivo_codigo: 'menor_de_edad',
                motivo: 'El titular es su hijo de 16 años',
                documento_numero: '1234567890101',
                origen_tipo: 'iris_orden',
                origen_id: '9130',
            }),
        )
        assert.deepEqual(p, {
            servicio_id: 4410,
            empresa_id: 1,
            de_cliente_id: 10,
            a_cliente_id: 11,
            existente: true,
            posible_duplicado: false,
            de_cliente_eliminado: true,
            motivo_codigo: 'menor_de_edad',
            origen_tipo: 'iris_orden',
            origen_id: '9130',
            // A45 (0.10.0): código y nombre del servicio (null: el servicio de muestra no existe)
            servicio_codigo: null,
            servicio_nombre: null,
        })
    })

    test('A48: equipo cambiado y estado de la unidad solo con 0.12.0, sin nota, cobro, costos ni RMA', async ({
        assert,
    }) => {
        const cambio = {
            servicio_id: 4410,
            cliente_id: 1201,
            empresa_id: 1,
            sale_unidad_id: 812,
            entra_unidad_id: 813,
            motivo: 'danado',
            destino_sale: 'revision',
            nota: 'Carcasa rota',
            cobro_propuesto: { motivo: 'golpe', nota: 'x' },
            origen: 'iris_orden',
            origen_id: '9130',
        }
        const estadoUnidad = {
            unidad_id: 812,
            empresa_id: 1,
            servicio_id: null,
            de: 'revision',
            a: 'garantia',
            motivo: 'rma',
            costo: '350.00',
            proveedor_id: 5,
            rma: 'RMA-1',
        }
        await fijarConector('0.11.0')
        assert.isNull(await reenviar(await eventoOutbox('inventario.equipo_cambiado', cambio)))
        assert.isNull(await reenviar(await eventoOutbox('inventario.unidad_estado_cambiado', estadoUnidad)))
        await fijarConector('0.12.0')
        assert.deepEqual(await reenviar(await eventoOutbox('inventario.equipo_cambiado', cambio)), {
            servicio_id: 4410,
            empresa_id: 1,
            cliente_id: 1201,
            sale_unidad_id: 812,
            entra_unidad_id: 813,
            motivo: 'danado',
            destino_sale: 'revision',
            origen: 'iris_orden',
            origen_id: '9130',
            servicio_codigo: null,
            servicio_nombre: null,
        })
        assert.deepEqual(
            await reenviar(await eventoOutbox('inventario.unidad_estado_cambiado', estadoUnidad)),
            {
                unidad_id: 812,
                empresa_id: 1,
                servicio_id: null,
                de: 'revision',
                a: 'garantia',
                motivo: 'rma',
            },
        )
    })
})
