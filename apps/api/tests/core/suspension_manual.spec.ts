import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, usuarioConRoles } from '#tests/ayudas'
import EvaluarEstadoServicio from '#billing/actions/evaluar_estado_servicio'
import VencerFacturas from '#billing/actions/vencer_facturas'
import { escenario, estadoServicio, generar } from '#tests/billing/ayudas_billing'

/**
 * Suspensión manual (decisión del PM, 2026-10-15): lo que un operador suspende a mano queda
 * suspendido hasta que un operador lo reactive a mano; ni el corte ni los pagos lo tocan.
 */

const HORA_DEL_CORTE = new Date('2026-10-07T14:00:00Z')

const evaluar = (servicioId: number) =>
    new EvaluarEstadoServicio().execute({ servicio_id: servicioId, ahora: HORA_DEL_CORTE }, contextoPrueba())

async function conVencidas(cantidad: 0 | 2) {
    const datos = await escenario({ fecha_instalacion: '2026-09-01' })
    await generar(datos.servicioId, '2026-10-01')
    if (cantidad > 0) {
        await new VencerFacturas().execute(
            { servicio_id: datos.servicioId, hasta: '2026-10-07' },
            contextoPrueba(),
        )
    }
    return datos
}

const marca = (servicioId: number) =>
    db
        .from('core.servicios')
        .where('id', servicioId)
        .select('suspension_manual', 'suspension_manual_motivo', 'suspension_manual_por')
        .firstOrFail()

async function suspendidoAMano(servicioId: number): Promise<boolean> {
    const { suspension_manual: valor } = await marca(servicioId)
    return valor
}

async function eventosEstado(servicioId: number) {
    const filas = await db
        .from('audit.outbox')
        .where('evento', 'servicio.estado_cambiado')
        .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [servicioId])
    return filas.length
}

test.group('core · suspensión manual', () => {
    test('suspender a mano pone la marca y la evaluación automática no reactiva aunque no haya deuda', async ({
        client,
        assert,
    }) => {
        const { token, usuario } = await usuarioConRoles(['soporte'])
        const { servicioId } = await conVencidas(0)

        const r = await estado(
            client
                .post(`/api/v1/servicios/${servicioId}/suspender`)
                .bearerToken(token)
                .json({ motivo: 'abuso de la red' }),
            200,
        )
        assert.containSubset(r.body(), {
            estado: 'suspendido',
            suspension_manual: true,
            suspension_manual_motivo: 'abuso de la red',
        })
        const { suspension_manual_por: por } = await marca(servicioId)
        assert.equal(por, usuario.id)

        const antes = await eventosEstado(servicioId)
        const resultado = await evaluar(servicioId)
        assert.containSubset(resultado, {
            estado: 'suspendido',
            cambiado: false,
            motivo: 'suspensión manual',
        })
        assert.equal(await estadoServicio(servicioId), 'suspendido')
        assert.equal(await eventosEstado(servicioId), antes)
    })

    test('limitar o quitar límite sobre una suspensión manual: 422 y no cambia nada', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const { servicioId } = await conVencidas(0)
        await estado(
            client
                .post(`/api/v1/servicios/${servicioId}/suspender`)
                .bearerToken(token)
                .json({ motivo: 'pausa' }),
            200,
        )
        const r = await estado(
            client
                .post(`/api/v1/servicios/${servicioId}/limitar`)
                .bearerToken(token)
                .json({ motivo: 'bajar velocidad' }),
            422,
        )
        assert.include(String(r.body().type), 'suspension_manual')
        assert.equal(await estadoServicio(servicioId), 'suspendido')
        assert.isTrue(await suspendidoAMano(servicioId))
    })

    test('reactivar a mano quita la marca y desde ahí manda la deuda: con 2 vencidas vuelve a cortar', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const { servicioId } = await conVencidas(2)
        const { estado: inicial } = await evaluar(servicioId)
        assert.equal(inicial, 'suspendido')

        // el operador marca como manual un servicio que ya estaba cortado por deuda
        await estado(
            client
                .post(`/api/v1/servicios/${servicioId}/suspender`)
                .bearerToken(token)
                .json({ motivo: 'revisión de fraude' }),
            200,
        )
        assert.isTrue(await suspendidoAMano(servicioId))

        const r = await estado(
            client
                .post(`/api/v1/servicios/${servicioId}/reactivar`)
                .bearerToken(token)
                .json({ motivo: 'revisado' }),
            200,
        )
        assert.containSubset(r.body(), {
            estado: 'activo',
            suspension_manual: false,
            suspension_manual_motivo: null,
        })
        assert.containSubset(await evaluar(servicioId), { estado: 'suspendido', cambiado: true })
    })
})
