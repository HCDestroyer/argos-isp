import { randomInt } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba } from '#tests/ayudas'
import EliminarServicio from '#core/actions/eliminar_servicio'
import EliminarRouter from '#network/actions/eliminar_router'
import { ConsumidorNotify } from '#notify/consumidor'
import { ConsumidorAlertas } from '#notify/consumidor_alertas'
import { fijarChatEquipo } from '#notify/alertas'
import { registrarCanal, reiniciarCanales } from '#notify/canales/registro'
import { CanalFalso, ColaFalsa, crearCliente, crearServicio, eventoOutbox } from '#tests/notify/ayudas_notify'

/**
 * Servicios y routers eliminados (`contratos/eliminar.md`, A1): los consumidores de notify no
 * fallan con un servicio o un router que ya no existe. Un `servicio.*` atrasado no avisa al
 * cliente; las alertas internas de la limpieza del router salen con el id.
 */

const CHAT = '-1009990077'
let siguienteId = 9_700_000_000 + randomInt(0, 1_000_000) * 1000

/** Crea un servicio (sin historial) y lo elimina con la acción de A1. */
async function servicioEliminado(email: string) {
    const clienteId = await crearCliente({ email })
    const servicioId = await crearServicio(clienteId)
    const fila = await db.from('core.servicios').where('id', servicioId).firstOrFail()
    await new EliminarServicio().execute({ id: servicioId, version: Number(fila.version) }, contextoPrueba())
    exigir(!(await db.from('core.servicios').where('id', servicioId).first()))
    return { clienteId, servicioId, routerId: Number(fila.router_id) }
}

function exigir(condicion: boolean): asserts condicion {
    if (!condicion) throw new Error('el servicio no se eliminó')
}

async function consumir(evento: string, payload: Record<string, unknown>) {
    const id = await eventoOutbox(evento, payload)
    await new ConsumidorNotify(new ColaFalsa()).procesar({ id, evento, payload })
    return db.from('notify.envios').where('origen', `outbox:${id}`)
}

test.group('notify · servicio y router eliminados', (group) => {
    group.each.setup(() => {
        registrarCanal('correo', new CanalFalso('correo'))
        registrarCanal('telegram', new CanalFalso('telegram'))
        fijarChatEquipo(CHAT)
        return () => {
            reiniciarCanales()
            fijarChatEquipo(undefined)
        }
    })

    test('servicio.estado_cambiado atrasado de un servicio eliminado: ni error ni envío', async ({
        assert,
    }) => {
        const { clienteId, servicioId } = await servicioEliminado('eliminado@prueba.local')
        const cambio = {
            servicio_id: servicioId,
            empresa_id: 1,
            de: 'activo',
            a: 'suspendido',
            motivo: 'corte',
        }
        // sin cliente_id (catálogo) y con cliente_id (un emisor que lo agregue): nada sale
        assert.lengthOf(await consumir('servicio.estado_cambiado', cambio), 0)
        assert.lengthOf(await consumir('servicio.estado_cambiado', { ...cambio, cliente_id: clienteId }), 0)
        // la activación de la instalación (bienvenida) tampoco
        assert.lengthOf(
            await consumir('servicio.estado_cambiado', {
                ...cambio,
                cliente_id: clienteId,
                de: 'pendiente_instalacion',
                a: 'activo',
                motivo: 'instalacion',
            }),
            0,
        )
        // `servicio.eliminado` no es un aviso al cliente
        assert.isFalse(new ConsumidorNotify(new ColaFalsa()).acepta('servicio.eliminado'))

        // control: el mismo aviso con un servicio que existe sí sale
        const vivo = await crearServicio(await crearCliente({ email: 'vivo@prueba.local' }))
        const envios = await consumir('servicio.estado_cambiado', { ...cambio, servicio_id: vivo })
        assert.lengthOf(envios, 1)
        assert.equal(envios[0].destino, 'vivo@prueba.local')
    })

    test('routeros.fallido y coa.fallido de la limpieza: la alerta sale con los ids, sin fallar', async ({
        assert,
    }) => {
        const { servicioId, routerId } = await servicioEliminado('limpieza@prueba.local')
        const router = await db.from('network.routers').where('id', routerId).firstOrFail()
        await new EliminarRouter().execute(
            { id: routerId, version: Number(router.version) },
            contextoPrueba(),
        )
        assert.isNull(await db.from('network.routers').where('id', routerId).first())

        const consumidor = new ConsumidorAlertas(new ColaFalsa())
        const fallo = {
            id: ++siguienteId,
            evento: 'routeros.fallido',
            payload: {
                servicio_id: servicioId,
                router_id: routerId,
                operacion: 'queue/simple remove',
                error: 'ETIMEDOUT',
            },
            requestId: `prueba-${siguienteId}`,
        }
        await consumidor.procesar(fallo)
        await consumidor.procesar(fallo) // el bus lo entrega dos veces
        const incidente = await db
            .from('notify.incidentes')
            .where('clave', `routeros:${routerId}`)
            .orderBy('id', 'desc')
            .firstOrFail()
        const envios = await db.from('notify.envios').whereLike('origen', `alerta:${incidente.id}:%`)
        assert.lengthOf(envios, 1)
        assert.include(envios[0].cuerpo, `#${routerId}`)
        assert.include(envios[0].cuerpo, String(servicioId))

        // `coa:<nas_ip>`: la nas_ip del router eliminado es única (no choca con otro incidente)
        const nasIp = String(router.nas_ip)
        await consumidor.procesar({
            id: ++siguienteId,
            evento: 'coa.fallido',
            payload: { servicio_id: servicioId, nas_ip: nasIp, tipo: 'disconnect', error: 'timeout' },
            requestId: `prueba-${siguienteId}`,
        })
        const coa = await db
            .from('notify.incidentes')
            .where('clave', `coa:${nasIp}`)
            .orderBy('id', 'desc')
            .firstOrFail()
        const avisos = await db.from('notify.envios').whereLike('origen', `alerta:${coa.id}:%`)
        assert.lengthOf(avisos, 1)
        assert.include(avisos[0].cuerpo, String(servicioId))
    })
})
