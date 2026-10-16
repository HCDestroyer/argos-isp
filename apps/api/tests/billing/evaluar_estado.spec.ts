import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba } from '#tests/ayudas'
import EvaluarEstadoServicio, { decidir, llegoHoraCorte } from '#billing/actions/evaluar_estado_servicio'
import VencerFacturas from '#billing/actions/vencer_facturas'
import { escenario, estadoServicio, eventosDe, generar } from '#tests/billing/ayudas_billing'

/** 08:00 en Guatemala (UTC−6) = 14:00 UTC. */
const ANTES_DEL_CORTE = new Date('2026-10-07T13:59:00Z')
const HORA_DEL_CORTE = new Date('2026-10-07T14:00:00Z')

const evaluar = (servicioId: number, ahora: Date = HORA_DEL_CORTE) =>
    new EvaluarEstadoServicio().execute({ servicio_id: servicioId, ahora }, contextoPrueba())

const vencer = (servicioId: number, hasta: string) =>
    new VencerFacturas().execute({ servicio_id: servicioId, hasta }, contextoPrueba())

/** Servicio con dos facturas (septiembre y octubre) y `hasta` vencidas. */
async function conVencidas(cantidad: 0 | 1 | 2, opciones: Parameters<typeof escenario>[0] = {}) {
    const datos = await escenario({ fecha_instalacion: '2026-09-01', ...opciones })
    await generar(datos.servicioId, '2026-10-01')
    if (cantidad > 0) await vencer(datos.servicioId, cantidad === 1 ? '2026-10-06' : '2026-10-07')
    return datos
}

test.group('billing · evaluarEstadoServicio (reglas)', () => {
    test('decidir: promesa, cortar, limitar y plan sin velocidad limitada', ({ assert }) => {
        const base = { promesaId: null, limitar: 1, cortar: 2, limitable: true }
        assert.equal(decidir({ ...base, vencidas: 0 }).deseado, 'activo')
        assert.equal(decidir({ ...base, vencidas: 1 }).deseado, 'limitado')
        assert.equal(decidir({ ...base, vencidas: 2 }).deseado, 'suspendido')
        assert.equal(decidir({ ...base, vencidas: 5, promesaId: 9 }).deseado, 'activo')
        assert.include(decidir({ ...base, vencidas: 5, promesaId: 9 }).motivo, 'promesa de pago 9')
        assert.equal(decidir({ ...base, vencidas: 1, limitable: false }).deseado, 'activo')
        assert.equal(decidir({ ...base, vencidas: 1, limitar: 0 }).deseado, 'activo')
        assert.equal(decidir({ ...base, vencidas: 1, limitar: 0, cortar: 1 }).deseado, 'suspendido')
    })

    test('llegoHoraCorte compara en hora de Guatemala', ({ assert }) => {
        assert.isFalse(llegoHoraCorte('08:00', ANTES_DEL_CORTE))
        assert.isTrue(llegoHoraCorte('08:00', HORA_DEL_CORTE))
        assert.isTrue(llegoHoraCorte('00:00', ANTES_DEL_CORTE))
    })
})

test.group('billing · evaluarEstadoServicio', () => {
    test('una vencida limita, dos cortan; bajar espera la hora de corte y emite servicio.estado_cambiado', async ({
        assert,
    }) => {
        const { servicioId } = await conVencidas(1)

        const antes = await evaluar(servicioId, ANTES_DEL_CORTE)
        assert.containSubset(antes, { estado: 'activo', deseado: 'limitado', cambiado: false, vencidas: 1 })
        assert.include(antes.motivo, 'espera la hora de corte 08:00')
        assert.equal(await estadoServicio(servicioId), 'activo')

        const limitado = await evaluar(servicioId)
        assert.containSubset(limitado, { de: 'activo', estado: 'limitado', cambiado: true })
        assert.equal(await estadoServicio(servicioId), 'limitado')

        await vencer(servicioId, '2026-10-07')
        const cortado = await evaluar(servicioId)
        assert.containSubset(cortado, { de: 'limitado', estado: 'suspendido', cambiado: true, vencidas: 2 })

        const repetido = await evaluar(servicioId)
        assert.containSubset(repetido, { estado: 'suspendido', cambiado: false })

        const eventos = await eventosDe('servicio.estado_cambiado', 'servicio_id', servicioId)
        assert.deepEqual(
            eventos.map((e) => [e.payload.de, e.payload.a]),
            [
                ['activo', 'limitado'],
                ['limitado', 'suspendido'],
            ],
        )
        assert.include(eventos[1].payload.motivo, '2 facturas vencidas')
        const accion = await db
            .from('audit.acciones')
            .where('accion', 'servicios.evaluar_estado')
            .where('entidad_id', servicioId)
            .count('* as total')
            .firstOrFail()
        // solo las dos evaluaciones que cambiaron el estado quedan en audit.acciones
        assert.equal(Number(accion.total), 2)
    })

    test('auditoría: una evaluación sin cambio no deja fila; un error sí', async ({ assert }) => {
        const { servicioId } = await conVencidas(0)
        const sinCambio = await evaluar(servicioId)
        assert.containSubset(sinCambio, { estado: 'activo', cambiado: false })
        const filas = await db
            .from('audit.acciones')
            .where('accion', 'servicios.evaluar_estado')
            .where('entidad_id', servicioId)
        assert.lengthOf(filas, 0)

        const inexistente = 999_999_999
        await assert.rejects(() => evaluar(inexistente), /no existe/)
        const error = await db
            .from('audit.acciones')
            .where('accion', 'servicios.evaluar_estado')
            .where('entidad_id', inexistente)
            .orderBy('id', 'desc')
            .firstOrFail()
        assert.equal(error.resultado, 'error')
        assert.include(error.error, 'no existe')
    })

    test('promesa activa reactiva de inmediato, aunque no sea la hora de corte', async ({ assert }) => {
        const { servicioId, clienteId } = await conVencidas(2)
        await evaluar(servicioId)
        assert.equal(await estadoServicio(servicioId), 'suspendido')

        const [promesa] = (await db
            .table('billing.promesas')
            .insert({
                servicio_id: servicioId,
                cliente_id: clienteId,
                vence_en: '2026-10-10T00:00:00Z',
                monto: '300.00',
                canal: 'operador',
            })
            .returning('id')) as Array<{ id: number }>
        const reactivado = await evaluar(servicioId, ANTES_DEL_CORTE)
        assert.containSubset(reactivado, {
            de: 'suspendido',
            estado: 'activo',
            cambiado: true,
            promesa_activa: true,
        })
        assert.include(reactivado.motivo, `promesa de pago ${promesa!.id}`)
    })

    test('plan sin velocidad limitada no se limita; excepción del servicio cambia el umbral de corte', async ({
        assert,
    }) => {
        const sinLimite = await conVencidas(1, { limitada: 0 })
        const r = await evaluar(sinLimite.servicioId)
        assert.containSubset(r, { estado: 'activo', deseado: 'activo', cambiado: false })
        assert.include(r.motivo, 'no tiene velocidad limitada')

        const conExcepcion = await conVencidas(1)
        await db.table('core.servicios_excepciones').insert({
            servicio_id: conExcepcion.servicioId,
            campo: 'facturas_para_cortar',
            valor: JSON.stringify(1),
        })
        assert.containSubset(await evaluar(conExcepcion.servicioId), { estado: 'suspendido', cambiado: true })
    })

    test('retirado o sin plantilla: no se toca', async ({ assert }) => {
        const retirado = await escenario({ servicio: { estado: 'retirado' } })
        assert.containSubset(await evaluar(retirado.servicioId), { estado: 'retirado', cambiado: false })
        const sinPlantilla = await escenario({
            servicio: { plantilla_facturacion_id: null, estado: 'suspendido' },
        })
        assert.containSubset(await evaluar(sinPlantilla.servicioId), {
            estado: 'suspendido',
            cambiado: false,
        })
        assert.equal(await estadoServicio(sinPlantilla.servicioId), 'suspendido')
    })
})
