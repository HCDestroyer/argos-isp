import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { horasDeCorte } from '#billing/cortes'
import { escenario } from '#tests/billing/ayudas_billing'

/** `horasDeCorte(hasta)`: fuente única de las horas de corte (EjecutarCorte y VigilarCrons de A6). */
test.group('billing · horasDeCorte', () => {
    test('hora de la plantilla o de la excepción del servicio; solo vigentes y hasta la hora dada', async ({
        assert,
    }) => {
        await escenario({ plantilla: { hora_corte: '06:17' } })
        const conExcepcion = await escenario({ plantilla: { hora_corte: '06:17' } })
        await db.table('core.servicios_excepciones').insert({
            servicio_id: conExcepcion.servicioId,
            campo: 'hora_corte',
            valor: JSON.stringify('05:43'),
        })
        const retirado = await escenario({ plantilla: { hora_corte: '04:11' } })
        await db.from('core.servicios').where('id', retirado.servicioId).update({ estado: 'retirado' })

        const todas = await horasDeCorte('23:59')
        assert.includeMembers(todas, ['05:43', '06:17'])
        assert.notInclude(todas, '04:11')
        assert.deepEqual(todas, [...todas].sort())
        assert.equal(new Set(todas).size, todas.length)

        const temprano = await horasDeCorte('06:00')
        assert.include(temprano, '05:43')
        assert.notInclude(temprano, '06:17')
    })
})
