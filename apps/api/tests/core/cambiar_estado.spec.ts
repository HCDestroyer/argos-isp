import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import CambiarEstadoServicio from '#core/actions/cambiar_estado_servicio'
import { contextoPrueba } from '#tests/ayudas'
import { crearClienteFila, crearServicioFila } from '#tests/core/fabricas'

const cambiar = (servicioId: number, nuevo: 'activo' | 'limitado' | 'suspendido', motivo = 'prueba') =>
    new CambiarEstadoServicio().execute({ servicioId, nuevo, motivo }, contextoPrueba())

async function filaServicio(id: number) {
    return db.from('core.servicios').where('id', id).firstOrFail()
}

async function servicio(estadoInicial = 'activo') {
    const id = await crearServicioFila({ cliente_id: await crearClienteFila() })
    if (estadoInicial !== 'activo') {
        await db.from('core.servicios').where('id', id).update({ estado: estadoInicial })
    }
    return id
}

const eventos = (servicioId: number) =>
    db
        .from('audit.outbox')
        .where('evento', 'servicio.estado_cambiado')
        .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [servicioId])
        .orderBy('id')

test.group('core · cambiarEstadoServicio', () => {
    test('activo → limitado → suspendido → activo: cada paso cambia, sube version y emite evento', async ({
        assert,
    }) => {
        const id = await servicio()
        const { version: v0 } = await filaServicio(id)

        assert.containsSubset(await cambiar(id, 'limitado', '1 vencida'), {
            de: 'activo',
            a: 'limitado',
            cambiado: true,
        })
        assert.containsSubset(await cambiar(id, 'suspendido'), {
            de: 'limitado',
            a: 'suspendido',
            cambiado: true,
        })
        assert.containsSubset(await cambiar(id, 'activo', 'pago'), {
            de: 'suspendido',
            a: 'activo',
            cambiado: true,
        })

        const fila = await filaServicio(id)
        assert.equal(fila.estado, 'activo')
        assert.equal(fila.version, v0 + 3)
        const emitidos = await eventos(id)
        assert.deepEqual(
            emitidos.map((e) => [e.payload.de, e.payload.a]),
            [
                ['activo', 'limitado'],
                ['limitado', 'suspendido'],
                ['suspendido', 'activo'],
            ],
        )
        assert.equal(emitidos[0].payload.motivo, '1 vencida')
    })

    test('activo → suspendido directo (plantilla que no limita)', async ({ assert }) => {
        const id = await servicio()
        assert.containsSubset(await cambiar(id, 'suspendido'), {
            de: 'activo',
            a: 'suspendido',
            cambiado: true,
        })
    })

    test('mismo estado: no escribe, no emite y no sube version', async ({ assert }) => {
        const id = await servicio('suspendido')
        const { version: v0 } = await filaServicio(id)
        assert.deepEqual(await cambiar(id, 'suspendido'), {
            servicioId: id,
            de: 'suspendido',
            a: 'suspendido',
            cambiado: false,
        })
        const { version } = await filaServicio(id)
        assert.equal(version, v0)
        assert.lengthOf(await eventos(id), 0)
    })

    test('retirado no cambia; servicio inexistente da 404', async ({ assert }) => {
        const id = await servicio('retirado')
        await assert.rejects(() => cambiar(id, 'activo'), /retirado/)
        await assert.rejects(() => cambiar(999_999_999, 'activo'), /no existe/)
        assert.lengthOf(await eventos(id), 0)
    })

    test('anidada con { trx }: si la transacción externa se revierte, no queda ni el cambio ni el evento', async ({
        assert,
    }) => {
        const id = await servicio()
        await assert.rejects(() =>
            db.transaction(async (trx) => {
                await new CambiarEstadoServicio().execute(
                    { servicioId: id, nuevo: 'suspendido', motivo: 'anidada' },
                    contextoPrueba(),
                    { trx },
                )
                throw new Error('falla externa')
            }),
        )
        const { estado } = await filaServicio(id)
        assert.equal(estado, 'activo')
        assert.lengthOf(await eventos(id), 0)
    })

    test('registra la acción y el diff de estado en la auditoría', async ({ assert }) => {
        const id = await servicio()
        await cambiar(id, 'limitado')
        const accion = await db
            .from('audit.acciones')
            .where({ accion: 'servicios.cambiar_estado', entidad_tipo: 'servicio', entidad_id: id })
            .firstOrFail()
        assert.equal(accion.resultado, 'ok')
        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'servicio', entidad_id: id, campo: 'estado' })
            .firstOrFail()
        assert.equal(cambio.despues, 'limitado')
    })
})
