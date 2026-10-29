import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, unico } from '#tests/ayudas'
import { crearClienteFila, crearRouterFila, crearServicioFila, ipUnica } from '#tests/core/fabricas'
import EliminarServicio from '#core/actions/eliminar_servicio'
import IniciarSesion from '#network/sesiones/actions/iniciar_sesion'
import TerminarSesion from '#network/sesiones/actions/terminar_sesion'
import { ConsumidorSesiones } from '#network/sesiones/consumidor'
import { MOTIVO_ELIMINADO } from '#network/sesiones/actions/desconectar_servicio_eliminado'
import type { RegistroAccounting } from '#network/sesiones/registro'

/**
 * `servicio.eliminado` en el grupo `sesiones` (`contratos/eliminar.md`): si quedó una sesión viva
 * del `user_ppp` que tenía el servicio, se pide el Disconnect por el flujo normal
 * (`sesion.desconexion_solicitada`, lo ejecuta `coa`). Sin sesión viva no pasa nada.
 */

interface Eliminado {
    servicioId: number
    routerId: number
    nasIp: string
    userPpp: string
    payload: Record<string, unknown>
}

/** Servicio sin historial creado y eliminado con la acción de A1 (deja su `audit.cambios`). */
async function eliminado(): Promise<Eliminado> {
    const nasIp = ipUnica()
    const routerId = await crearRouterFila({ nas_ip: nasIp })
    const clienteId = await crearClienteFila()
    const userPpp = unico('ppp-elim')
    const servicioId = await crearServicioFila({
        cliente_id: clienteId,
        router_id: routerId,
        user_ppp: userPpp,
        ipv6_modo: 'ninguno',
    })
    const { version } = (await db
        .from('core.servicios')
        .where('id', servicioId)
        .select('version')
        .first()) as {
        version: number
    }
    await new EliminarServicio().execute({ id: servicioId, version: Number(version) }, contextoPrueba())
    const evento = (await db
        .from('audit.outbox')
        .where('evento', 'servicio.eliminado')
        .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [servicioId])
        .select('payload')
        .first()) as { payload: Record<string, unknown> }
    return { servicioId, routerId, nasIp, userPpp, payload: evento.payload }
}

function registro(e: Eliminado, parcial: Partial<RegistroAccounting> = {}): RegistroAccounting {
    return {
        tipo: 'Start',
        nas_ip: e.nasIp,
        acct_session_id: unico('ses'),
        user_ppp: e.userPpp,
        ipv4: '10.10.1.21',
        prefijo_enlace_v6: null,
        prefijo_delegado_v6: null,
        bytes_in: '0',
        bytes_out: '0',
        duracion_s: null,
        causa_fin: null,
        evento_en: new Date().toISOString(),
        ...parcial,
    }
}

async function desconexiones(userPpp: string) {
    return (await db
        .from('audit.outbox')
        .where('evento', 'sesion.desconexion_solicitada')
        .whereRaw(`payload->>'user_ppp' = ?`, [userPpp])
        .orderBy('id')
        .select('payload')) as Array<{ payload: Record<string, unknown> }>
}

async function auditorias(servicioId: number) {
    return db
        .from('audit.acciones')
        .where({ accion: 'sesiones.desconectar_eliminado', entidad_tipo: 'servicio', entidad_id: servicioId })
        .select('resultado', 'entrada')
}

const entregar = (e: Eliminado, id: number, payload = e.payload) =>
    new ConsumidorSesiones().procesar({ id, evento: 'servicio.eliminado', payload, requestId: null })

test.group('network · sesiones · servicio.eliminado (grupo sesiones)', () => {
    test('sin sesión viva (lo normal: nunca conectó) no pide Disconnect ni deja auditoría', async ({
        assert,
    }) => {
        const e = await eliminado()
        const consumidor = new ConsumidorSesiones()
        assert.isTrue(consumidor.acepta('servicio.eliminado'))
        assert.isFalse(consumidor.acepta('servicio.retirado'))
        await entregar(e, 1)
        await entregar(e, 1)
        assert.lengthOf(await desconexiones(e.userPpp), 0)
        assert.lengthOf(await auditorias(e.servicioId), 0)
    })

    test('una sesión abierta después del borrado recibe el Disconnect; repetido solo mientras siga abierta', async ({
        assert,
    }) => {
        const e = await eliminado()
        // Accounting que llegó después del borrado: sin servicio (la fila ya no existe).
        const r = registro(e)
        const { sesionId } = await new IniciarSesion().execute(r, contextoPrueba())
        const sesion = (await db.from('network.sesiones').where('id', sesionId!).first()) as {
            servicio_id: number | null
        }
        assert.isNull(sesion.servicio_id)

        await entregar(e, 10)
        const [primera] = await desconexiones(e.userPpp)
        assert.deepEqual(primera!.payload, {
            sesion_id: sesionId,
            servicio_id: e.servicioId,
            nas_ip: e.nasIp,
            acct_session_id: r.acct_session_id,
            user_ppp: e.userPpp,
            motivo: MOTIVO_ELIMINADO,
        })
        const [fila] = await auditorias(e.servicioId)
        assert.equal(fila.resultado, 'ok')

        // Segunda entrega con la sesión todavía abierta: se vuelve a pedir (el NAS no la cortó aún).
        await entregar(e, 10)
        assert.lengthOf(await desconexiones(e.userPpp), 2)

        // El NAS cortó (Stop): una entrega más ya no hace nada.
        await new TerminarSesion().execute(
            registro(e, { tipo: 'Stop', acct_session_id: r.acct_session_id, causa_fin: 'Admin-Reset' }),
            contextoPrueba(),
        )
        await entregar(e, 10)
        assert.lengthOf(await desconexiones(e.userPpp), 2)
        assert.lengthOf(await auditorias(e.servicioId), 2)
    })

    test('usa el user_ppp del payload si viene; un payload sin servicio_id se ignora', async ({ assert }) => {
        const e = await eliminado()
        const otroUsuario = unico('ppp-payload')
        await new IniciarSesion().execute(registro(e, { user_ppp: otroUsuario }), contextoPrueba())
        await entregar(e, 20, { ...e.payload, user_ppp: otroUsuario })
        assert.lengthOf(await desconexiones(otroUsuario), 1)
        await entregar(e, 21, { empresa_id: 1 })
        assert.lengthOf(await desconexiones(otroUsuario), 1)
    })
})
