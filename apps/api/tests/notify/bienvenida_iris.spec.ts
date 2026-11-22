import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar } from '#shared/cifrado'
import { contextoPrueba } from '#tests/ayudas'
import { contextoSistema } from '#shared/contexto'
import EnviarNotificacion from '#notify/actions/enviar_notificacion'
import ReenviarBienvenida from '#notify/actions/reenviar_bienvenida'
import { ConsumidorNotify } from '#notify/consumidor'
import { registrarCanal, reiniciarCanales } from '#notify/canales/registro'
import { recargarConfiguracion } from '#notify/configuracion'
import { HorusSimulado as IrisSimulado } from '#tests/integraciones/horus_simulado'
import { CanalFalso, ColaFalsa, crearCliente, crearServicio, eventoOutbox } from '#tests/notify/ayudas_notify'

/**
 * Bienvenida con seguimiento (contrato Iris 0.9.0 §12.5, A37): `bienvenida_servicio` con sus
 * variables y `origen` a un Iris ≥ 0.9.0 (`bienvenida` a uno anterior), `servicio.bienvenida_cambiada`
 * con el estado de los tres canales (uno por cambio) y su webhook a Iris, y el reenvío con sus límites.
 */

const TOKEN = `iris_pat_${'Qw3Er4Ty'.repeat(5)}`
const AVISOS = '/api/v1/mensajeria/avisos'
let iris: IrisSimulado

async function fijarConector(contrato: string) {
    await db.from('integraciones.iris_conector').delete()
    await db.table('integraciones.iris_conector').insert({
        id: 1,
        activo: true,
        url_base: iris.url,
        token_cifrado: cifrar(TOKEN),
        webhook_entrada_secreto_cifrado: cifrar('whsec_bienvenida'),
        contrato,
    })
}

async function fijarWhatsapp(activo: boolean) {
    await db.from('notify.configuracion_canales').delete()
    await db
        .table('notify.configuracion_canales')
        .insert({ empresa_id: null, hereda: false, whatsapp_activo: activo })
    await recargarConfiguracion()
}

async function servicioActivo(email = 'bienvenida@prueba.local') {
    const clienteId = await crearCliente({ email })
    const servicioId = await crearServicio(clienteId)
    return { clienteId, servicioId }
}

function activacion(servicioId: number, origen = true) {
    return {
        servicio_id: servicioId,
        empresa_id: 1,
        de: 'pendiente_instalacion',
        a: 'activo',
        motivo: 'instalacion',
        ...(origen ? { origen_tipo: 'iris_orden', origen_id: 'ord-9123' } : {}),
    }
}

async function consumir(evento: string, payload: Record<string, unknown>) {
    const id = await eventoOutbox(evento, payload)
    await new ConsumidorNotify(new ColaFalsa()).procesar({ id, evento, payload })
    return id
}

function cambios(servicioId: number) {
    return db
        .from('audit.outbox')
        .where('evento', 'servicio.bienvenida_cambiada')
        .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [servicioId])
        .orderBy('id')
}

const enviar = (envioId: number) =>
    new EnviarNotificacion().execute({ envioId, intento: 1, maxIntentos: 3 }, contextoSistema('worker'))

async function limpiar() {
    await db.from('integraciones.iris_conector').delete()
    await db.from('notify.configuracion_canales').delete()
    await recargarConfiguracion()
}

test.group('notify · bienvenida con seguimiento (Iris 0.9.0 §12.5)', (group) => {
    group.each.setup(async () => {
        iris = await new IrisSimulado().iniciar()
        registrarCanal('correo', new CanalFalso('correo'))
        registrarCanal('telegram', new CanalFalso('telegram'))
        await limpiar()
        return async () => {
            reiniciarCanales()
            await limpiar()
            await iris.detener()
        }
    })

    test('Iris 0.9.0: bienvenida_servicio con sus variables y origen; un cambio por estado', async ({
        assert,
    }) => {
        iris.responder(AVISOS, () => ({ status: 202, cuerpo: { aviso_id: 'av-bv', estado: 'en_cola' } }))
        await fijarConector('0.9.0')
        await fijarWhatsapp(true)
        const { clienteId, servicioId } = await servicioActivo()
        const cliente = await db.from('core.clientes').where('id', clienteId).firstOrFail()

        const outboxId = await consumir('servicio.estado_cambiado', activacion(servicioId))
        const envios = await db.from('notify.envios').where('origen', `outbox:${outboxId}`).orderBy('id')
        assert.sameMembers(
            envios.map((e) => e.canal),
            ['correo', 'whatsapp'],
        )
        const wa = envios.find((e) => e.canal === 'whatsapp')!
        assert.equal(wa.cuerpo, 'bienvenida_servicio')

        // la bienvenida quedó registrada con la orden de Iris y avisó su primer estado
        const fila = await db.from('notify.bienvenidas').where('origen', `outbox:${outboxId}`).firstOrFail()
        assert.containsSubset(fila, { origen_tipo: 'iris_orden', origen_id: 'ord-9123', reenvio: false })
        let evs = await cambios(servicioId)
        assert.lengthOf(evs, 1)
        assert.deepEqual(evs[0].payload.canales, [
            { canal: 'whatsapp', estado: 'pendiente', motivo: null, aviso_id: null },
            { canal: 'correo', estado: 'pendiente', motivo: null, aviso_id: null },
            { canal: 'telegram', estado: 'omitida', motivo: 'sin_canal', aviso_id: null },
        ])
        assert.containsSubset(evs[0].payload, {
            origen_tipo: 'iris_orden',
            origen_id: 'ord-9123',
            reenvio: false,
        })

        // WhatsApp: el aviso pide bienvenida_servicio con las variables de Argos y el origen (§6.2)
        await enviar(wa.id)
        const p = iris.de(AVISOS)[0]!
        const plan = await db
            .from('network.planes as p')
            .join('core.servicios as s', 's.plan_id', 'p.id')
            .where('s.id', servicioId)
            .select('p.nombre')
            .firstOrFail()
        assert.deepEqual(JSON.parse(p.cuerpo), {
            empresa_id: 1,
            cliente_id: clienteId,
            servicio_id: servicioId,
            plantilla: 'bienvenida_servicio',
            variables: {
                nombre: cliente.nombre,
                plan: plan.nombre,
                precio_mensual: '150.00',
                moneda: 'GTQ',
                codigo_cliente: cliente.codigo,
            },
            canal_preferido: 'whatsapp',
            prioridad: 'normal',
            origen: { tipo: 'iris_orden', id: 'ord-9123' },
        })
        assert.equal(p.cabeceras['idempotency-key'], `argos:aviso:bienvenida_servicio:${wa.id}`)
        evs = await cambios(servicioId)
        // aceptado por Iris: sigue pendiente, ahora con el aviso de Iris
        assert.lengthOf(evs, 2)
        assert.deepEqual(evs[1].payload.canales[0], {
            canal: 'whatsapp',
            estado: 'pendiente',
            motivo: null,
            aviso_id: 'av-bv',
        })

        // correo enviado: otro cambio; repetir el envío no cambia nada
        const correo = envios.find((e) => e.canal === 'correo')!
        await enviar(correo.id)
        await enviar(correo.id)
        evs = await cambios(servicioId)
        assert.lengthOf(evs, 3)
        assert.equal(evs[2].payload.canales[1].estado, 'enviada')
    })

    test('Iris anterior a 0.9.0: sigue con bienvenida y sin origen; sin orden de Iris no hay origen', async ({
        assert,
    }) => {
        iris.responder(AVISOS, () => ({ status: 202, cuerpo: { aviso_id: 'av-bv2', estado: 'en_cola' } }))
        await fijarConector('0.8.1')
        await fijarWhatsapp(true)
        const { servicioId } = await servicioActivo()
        const outboxId = await consumir('servicio.estado_cambiado', activacion(servicioId))
        const wa = await db
            .from('notify.envios')
            .where('origen', `outbox:${outboxId}`)
            .where('canal', 'whatsapp')
            .firstOrFail()
        assert.equal(wa.cuerpo, 'bienvenida')
        await enviar(wa.id)
        const cuerpo = JSON.parse(iris.de(AVISOS)[0]!.cuerpo)
        assert.equal(cuerpo.plantilla, 'bienvenida')
        assert.notProperty(cuerpo, 'origen')

        const panel = await servicioActivo('panel@prueba.local')
        const id2 = await consumir('servicio.estado_cambiado', activacion(panel.servicioId, false))
        const fila = await db.from('notify.bienvenidas').where('origen', `outbox:${id2}`).firstOrFail()
        assert.isNull(fila.origen_tipo)
        assert.isNull(fila.origen_id)
    })

    test('reenviar: 409 si no está activo, 429 antes de 10 min y después de 3 al día', async ({ assert }) => {
        await fijarConector('0.9.0')
        const { servicioId } = await servicioActivo()
        const ctx = contextoPrueba()
        const reenviar = () =>
            new ReenviarBienvenida().execute(
                {
                    servicio_id: servicioId,
                    origen_tipo: 'iris_orden',
                    origen_id: 'ord-5',
                    canales: ['correo'],
                },
                ctx,
            )

        await db.from('core.servicios').where('id', servicioId).update({ estado: 'suspendido' })
        await assert.rejects(reenviar, /no está activo/)
        await db.from('core.servicios').where('id', servicioId).update({ estado: 'activo' })

        const r = await reenviar()
        assert.equal(r.estado, 'en_cola')
        const fila = await db.from('notify.bienvenidas').where('id', r.bienvenida_id).firstOrFail()
        assert.containsSubset(fila, { reenvio: true, origen_tipo: 'iris_orden', origen_id: 'ord-5' })
        assert.deepEqual(fila.canales, ['correo'])

        // el evento interno lo programa el worker de notify por los canales pedidos
        const ev = await db
            .from('audit.outbox')
            .where('evento', 'servicio.bienvenida_solicitada')
            .whereRaw(`(payload->>'bienvenida_id')::bigint = ?`, [r.bienvenida_id])
            .firstOrFail()
        await new ConsumidorNotify(new ColaFalsa()).procesar({
            id: ev.id,
            evento: ev.evento,
            payload: ev.payload,
        })
        const envios = await db.from('notify.envios').where('origen', fila.origen)
        assert.lengthOf(envios, 1)
        assert.containsSubset(envios[0], { canal: 'correo', evento: 'servicio.instalacion_activada' })
        const evs = await cambios(servicioId)
        assert.lengthOf(evs, 1)
        assert.containsSubset(evs[0].payload, { reenvio: true, origen_id: 'ord-5' })

        // antes de 10 min: 429 bienvenida_reciente con los segundos que faltan
        const reciente = await reenviar().catch((e) => e)
        assert.equal(reciente.status, 429)
        assert.equal(reciente.tipo, 'urn:argosisp:problema:bienvenida_reciente')
        assert.isAbove(reciente.reintentarEnS, 500)

        // tres reenvíos en el día: el cuarto es 429 demasiados_reenvios
        // solo la última se corre 11 min atrás (ninguna sale del día de Guatemala salvo justo a medianoche)
        const atras = () =>
            db.rawQuery(
                `UPDATE notify.bienvenidas SET created_at = created_at - interval '11 minutes'
                  WHERE servicio_id = ? AND created_at > now() - interval '10 minutes'`,
                [servicioId],
            )
        await atras()
        await reenviar()
        await atras()
        await reenviar()
        await atras()
        const muchos = await reenviar().catch((e) => e)
        assert.equal(muchos.status, 429)
        assert.equal(muchos.tipo, 'urn:argosisp:problema:demasiados_reenvios')
        assert.isAbove(muchos.reintentarEnS, 0)
    })
})
