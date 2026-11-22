import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba } from '#tests/ayudas'
import { escenario, estadoServicio } from '#tests/billing/ayudas_billing'
import EmitirFacturasPeriodo from '#billing/actions/emitir_facturas_periodo'
import VencerFacturas from '#billing/actions/vencer_facturas'
import EvaluarEstadoServicio from '#billing/actions/evaluar_estado_servicio'

/**
 * Facturas de meses pasados (decisión del PM 21): quien emite escribe los días de gracia antes del
 * corte; quedan en la factura y `evaluarEstadoServicio` no la cuenta antes de `corte_desde`.
 */

test.group('billing · gracia antes del corte en meses pasados (decisión 21)', () => {
    test('se guarda en la factura y el corte la respeta; el vencimiento no cambia', async ({ assert }) => {
        const e = await escenario({ fecha_instalacion: '2026-09-01', plantilla: { hora_corte: '00:00' } })
        const r = await new EmitirFacturasPeriodo().execute(
            {
                servicio_id: e.servicioId,
                periodos: ['2026-09-01'],
                dias_gracia_corte: 15,
                hoy: '2026-11-21',
            },
            contextoPrueba(),
        )
        assert.lengthOf(r.creadas, 1)
        const factura = await db
            .from('billing.facturas')
            .where('id', r.creadas[0]!.factura_id)
            .select(
                'dias_gracia_corte',
                db.raw(`to_char(corte_desde, 'YYYY-MM-DD') as corte_desde`),
                db.raw(`to_char(vence_en, 'YYYY-MM-DD') as vence_en`),
                'reglas_snapshot',
            )
            .first()
        assert.equal(factura.dias_gracia_corte, 15)
        assert.equal(factura.corte_desde, '2026-12-06')
        assert.equal(factura.vence_en, '2026-11-26', 'el vencimiento sigue la plantilla (hoy + 5)')
        assert.deepEqual(factura.reglas_snapshot.emision_manual.gracia_corte, {
            dias: 15,
            desde: '2026-12-06',
        })

        await new VencerFacturas().execute(
            { servicio_id: e.servicioId, hasta: '2026-11-30' },
            contextoPrueba(),
        )
        const antes = await new EvaluarEstadoServicio().execute(
            { servicio_id: e.servicioId, ahora: new Date('2026-12-01T12:00:00-06:00') },
            contextoPrueba(),
        )
        assert.equal(antes.vencidas, 0, 'vencida, pero aún no cuenta para el corte')
        assert.equal(await estadoServicio(e.servicioId), 'activo')
        const despues = await new EvaluarEstadoServicio().execute(
            { servicio_id: e.servicioId, ahora: new Date('2026-12-06T12:00:00-06:00') },
            contextoPrueba(),
        )
        assert.equal(despues.vencidas, 1)
        assert.equal(await estadoServicio(e.servicioId), 'limitado')
    })

    test('sin el dato, como siempre; fuera de rango, 422', async ({ assert }) => {
        const e = await escenario({ fecha_instalacion: '2026-09-01' })
        const r = await new EmitirFacturasPeriodo().execute(
            { servicio_id: e.servicioId, periodos: ['2026-09-01'], hoy: '2026-11-21' },
            contextoPrueba(),
        )
        const fila = await db.from('billing.facturas').where('id', r.creadas[0]!.factura_id).first()
        assert.isNull(fila.dias_gracia_corte)
        assert.isNull(fila.corte_desde)
        await assert.rejects(
            () =>
                new EmitirFacturasPeriodo().execute(
                    {
                        servicio_id: e.servicioId,
                        periodos: ['2026-10-01'],
                        dias_gracia_corte: 91,
                        hoy: '2026-11-21',
                    },
                    contextoPrueba(),
                ),
            /no son válidos/,
        )
    })
})
