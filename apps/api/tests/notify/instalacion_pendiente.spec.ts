import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoSistema } from '#shared/contexto'
import ProgramarRecordatorios from '#notify/actions/programar_recordatorios'
import { ConsumidorNotify } from '#notify/consumidor'
import { registrarCanal, reiniciarCanales } from '#notify/canales/registro'
import {
    CanalFalso,
    ColaFalsa,
    crearCliente,
    crearFactura,
    crearServicio,
    eventoOutbox,
} from '#tests/notify/ayudas_notify'

/**
 * Servicio `pendiente_instalacion` (`contratos/instalacion.md` §3, pedido de A3): ni recordatorios
 * ni aviso de factura vencida para su cargo único, y sin «servicio reactivado» al activar la
 * instalación. El aviso de la factura emitida sí sale. Fechas en 2028 (lejos de otras pruebas).
 */

async function pendiente(servicioId: number) {
    await db
        .from('core.servicios')
        .where('id', servicioId)
        .update({ estado: 'pendiente_instalacion', instalado_en: null })
}

async function activar(servicioId: number) {
    await db
        .from('core.servicios')
        .where('id', servicioId)
        .update({ estado: 'activo', instalado_en: new Date() })
}

async function cargoUnico(vence: string) {
    const clienteId = await crearCliente({ email: 'pendiente@prueba.local' })
    const servicioId = await crearServicio(clienteId)
    await pendiente(servicioId)
    const facturaId = await crearFactura(clienteId, servicioId, {
        vence,
        periodo: `${vence.slice(0, 7)}-01`,
        total: '300.00',
    })
    await db.from('billing.facturas').where('id', facturaId).update({ emitida_en: '2028-01-01T00:00:00Z' })
    return { clienteId, servicioId, facturaId }
}

const recordatoriosDe = (facturaId: number) =>
    db.from('notify.envios').where('origen', 'like', `recordatorio:%:factura:${facturaId}`)

async function consumir(evento: string, payload: Record<string, unknown>) {
    const id = await eventoOutbox(evento, payload)
    await new ConsumidorNotify(new ColaFalsa()).procesar({ id, evento, payload })
    return db.from('notify.envios').where('origen', `outbox:${id}`)
}

test.group('notify · servicio pendiente de instalación', (group) => {
    group.each.setup(() => {
        registrarCanal('correo', new CanalFalso('correo'))
        registrarCanal('telegram', new CanalFalso('telegram'))
        return () => reiniciarCanales()
    })

    test('sin recordatorios para el cargo único de un pendiente; al activarse, sí', async ({ assert }) => {
        const { servicioId, facturaId } = await cargoUnico('2028-02-10')
        const programar = () =>
            new ProgramarRecordatorios().execute({ ahora: '2028-02-07T15:00:00Z' }, contextoSistema('cron'))

        await programar()
        assert.lengthOf(await recordatoriosDe(facturaId), 0)

        await activar(servicioId)
        await programar()
        const envios = await recordatoriosDe(facturaId)
        assert.lengthOf(envios, 1)
        assert.equal(envios[0].origen, `recordatorio:1:factura:${facturaId}`)
    })

    test('factura.vencida de un pendiente no avisa; factura.emitida sí', async ({ assert }) => {
        const { clienteId, servicioId, facturaId } = await cargoUnico('2028-03-10')
        const payload = {
            factura_id: facturaId,
            empresa_id: 1,
            servicio_id: servicioId,
            cliente_id: clienteId,
            total: '300.00',
            vence: '2028-03-10',
        }
        assert.lengthOf(await consumir('factura.vencida', payload), 0)
        // sin servicio_id en el payload se toma el de la factura
        const sinServicio: Record<string, unknown> = { ...payload }
        delete sinServicio.servicio_id
        assert.lengthOf(await consumir('factura.vencida', sinServicio), 0)

        const emitida = await consumir('factura.emitida', payload)
        assert.lengthOf(emitida, 1)
        assert.equal(emitida[0].estado, 'encolado')

        // ya instalado, el vencimiento sí se avisa
        await activar(servicioId)
        assert.lengthOf(await consumir('factura.vencida', payload), 1)
    })

    test('activar la instalación no manda «servicio reactivado»; una reactivación sí', async ({ assert }) => {
        const clienteId = await crearCliente({ email: 'instalado@prueba.local' })
        const servicioId = await crearServicio(clienteId)
        const base = { servicio_id: servicioId, empresa_id: 1 }

        const instalacion = await consumir('servicio.estado_cambiado', {
            ...base,
            de: 'pendiente_instalacion',
            a: 'activo',
            motivo: 'instalacion',
            origen_tipo: 'iris_orden',
            origen_id: 'ord-1',
        })
        assert.lengthOf(instalacion, 0)

        const reactivado = await consumir('servicio.estado_cambiado', {
            ...base,
            de: 'suspendido',
            a: 'activo',
            motivo: 'pago',
        })
        assert.lengthOf(reactivado, 1)
        assert.include(reactivado[0].asunto, 'Servicio reactivado')
    })
})
