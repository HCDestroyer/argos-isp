import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoSistema } from '#shared/contexto'
import { estado, usuarioConRoles } from '#tests/ayudas'
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
 * ni aviso de factura vencida para su cargo único, y al activar la instalación la bienvenida
 * (`servicio.instalacion_activada`) en vez de «servicio reactivado». El aviso de la factura emitida sí sale. Fechas en 2028 (lejos de otras pruebas).
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

    test('activar la instalación manda la bienvenida una sola vez; una reactivación sigue con «reactivado»', async ({
        assert,
    }) => {
        const clienteId = await crearCliente({ email: 'instalado@prueba.local' })
        const { codigo } = await db.from('core.clientes').where('id', clienteId).select('codigo').first()
        assert.isString(codigo)
        const servicioId = await crearServicio(clienteId)
        await db.from('core.servicios').where('id', servicioId).update({ pass_ppp: 'secreto-pppoe-xyz' })
        const servicio = await db.from('core.servicios').where('id', servicioId).first()
        const base = { servicio_id: servicioId, empresa_id: 1 }
        const activacion = {
            ...base,
            de: 'pendiente_instalacion',
            a: 'activo',
            motivo: 'instalacion',
            origen_tipo: 'iris_orden',
            origen_id: 'ord-1',
        }

        // el bus entrega el mismo evento dos veces: un solo aviso por canal
        const id = await eventoOutbox('servicio.estado_cambiado', activacion)
        const consumidor = new ConsumidorNotify(new ColaFalsa())
        await consumidor.procesar({ id, evento: 'servicio.estado_cambiado', payload: activacion })
        await consumidor.procesar({ id, evento: 'servicio.estado_cambiado', payload: activacion })
        const bienvenida = await db.from('notify.envios').where('origen', `outbox:${id}`)
        assert.lengthOf(bienvenida, 1)
        assert.containsSubset(bienvenida[0], {
            evento: 'servicio.instalacion_activada',
            canal: 'correo',
            destino: 'instalado@prueba.local',
            estado: 'encolado',
        })
        assert.equal(bienvenida[0].asunto, '¡Bienvenido! Tu servicio de internet ya está activo')
        assert.include(bienvenida[0].cuerpo, 'ya está instalado y funcionando')
        assert.include(bienvenida[0].cuerpo, '10 Mbps de bajada / 5 Mbps de subida')
        assert.include(bienvenida[0].cuerpo, `Tu código de cliente es ${codigo}`)
        assert.notInclude(bienvenida[0].cuerpo, 'reactivado')
        // nunca credenciales PPPoE
        assert.notInclude(bienvenida[0].cuerpo, servicio.user_ppp)
        assert.notInclude(bienvenida[0].cuerpo, 'secreto-pppoe-xyz')

        const reactivado = await consumir('servicio.estado_cambiado', {
            ...base,
            de: 'suspendido',
            a: 'activo',
            motivo: 'pago',
        })
        assert.lengthOf(reactivado, 1)
        assert.equal(reactivado[0].evento, 'servicio.estado_cambiado')
        assert.include(reactivado[0].asunto, 'Servicio reactivado')
    })

    test('la bienvenida está en el catálogo, se edita y desactivada no sale', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const eventos = await estado(client.get('/api/v1/notificaciones/eventos').bearerToken(token), 200)
        const lista = (eventos.body().data ?? eventos.body()) as Array<{
            evento: string
            nombre: string
            tipo_aviso: string
        }>
        const bienvenida = lista.find((e) => e.evento === 'servicio.instalacion_activada')
        assert.exists(bienvenida)
        assert.equal(bienvenida!.nombre, 'Bienvenida al activar la instalación')
        assert.equal(bienvenida!.tipo_aviso, 'corte')

        const filas = await db
            .from('notify.plantillas')
            .where('evento', 'servicio.instalacion_activada')
            .orderBy('canal')
        assert.deepEqual(
            filas.map((f) => f.canal),
            ['correo', 'telegram'],
        )
        const correo = filas[0]
        try {
            const editada = await estado(
                client
                    .put(`/api/v1/notificaciones/plantillas/${correo.id}`)
                    .bearerToken(token)
                    .json({ version: correo.version, activa: false }),
                200,
            )
            assert.isFalse(editada.body().activa)
            await db
                .from('notify.plantillas')
                .where('evento', 'servicio.instalacion_activada')
                .where('canal', 'telegram')
                .update({ activa: false })

            const servicioId = await crearServicio(
                await crearCliente({ email: 'sin-bienvenida@prueba.local' }),
            )
            const envios = await consumir('servicio.estado_cambiado', {
                servicio_id: servicioId,
                empresa_id: 1,
                de: 'pendiente_instalacion',
                a: 'activo',
                motivo: 'instalacion',
            })
            assert.lengthOf(envios, 0)
        } finally {
            await db
                .from('notify.plantillas')
                .where('evento', 'servicio.instalacion_activada')
                .update({ activa: true })
        }
    })
})
