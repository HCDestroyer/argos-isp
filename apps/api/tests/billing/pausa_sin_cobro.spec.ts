import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado } from '#tests/ledger/ayudas_libro'
import { escenario, estadoServicio, eventosDe, facturasDe, generar } from '#tests/billing/ayudas_billing'
import PausarSinCobro from '#billing/actions/pausar_sin_cobro'
import TerminarPausas from '#billing/actions/terminar_pausas'
import EditarAjustesCobro from '#billing/actions/editar_ajustes_cobro'
import { leerAjustesCobro } from '#billing/ajustes_cobro'

/**
 * Pausa sin cobro (decisión del PM 16): suspende con la marca manual de A1, no factura los periodos
 * que empiezan en la pausa (ni después, cuando el cron procesa lo pendiente), el tope de días es un
 * ajuste de la empresa y el cron `pausas` reactiva solo al llegar el fin.
 */

test.group('billing · pausa sin cobro (decisión 16)', () => {
    test('pausa, no factura sus periodos, el cron la termina y reactiva; generar dos veces no los emite', async ({
        assert,
    }) => {
        const e = await escenario({ fecha_instalacion: '2026-09-01' })
        await generar(e.servicioId, '2026-09-15')
        const pausa = await new PausarSinCobro().execute(
            { servicio_id: e.servicioId, motivo: 'Viaje del titular', dias: 60, hoy: '2026-09-20' },
            contextoPrueba(),
        )
        assert.equal(pausa.desde, '2026-09-20')
        assert.equal(pausa.hasta, '2026-11-19')
        assert.equal(pausa.estado, 'activa')
        assert.equal(await estadoServicio(e.servicioId), 'suspendido')
        const servicio = await db.from('core.servicios').where('id', e.servicioId).first()
        assert.isTrue(servicio.suspension_manual)
        assert.lengthOf(await eventosDe('servicio.pausa_iniciada', 'pausa_id', pausa.id), 1)

        // octubre y noviembre empiezan dentro de la pausa: no se facturan
        await generar(e.servicioId, '2026-11-18')
        const enPausa = await facturasDe(e.servicioId)
        assert.deepEqual(
            enPausa.map((f) => f.periodo),
            ['2026-09-01'],
        )

        // el cron no la termina antes de tiempo
        const antes = await new TerminarPausas().execute({ hoy: '2026-11-18' }, contextoPrueba())
        assert.notInclude(antes.terminadas, pausa.id)
        const fin = await new TerminarPausas().execute({ hoy: '2026-11-19' }, contextoPrueba())
        assert.include(fin.terminadas, pausa.id)
        const terminada = await db.from('billing.pausas_servicio').where('id', pausa.id).first()
        assert.equal(terminada.estado, 'terminada')
        assert.equal(terminada.fin_motivo, 'vencida')
        const reactivado = await db.from('core.servicios').where('id', e.servicioId).first()
        assert.isFalse(reactivado.suspension_manual)
        assert.equal(reactivado.estado, 'activo')
        assert.lengthOf(await eventosDe('servicio.pausa_terminada', 'pausa_id', pausa.id), 1)

        // procesar lo pendiente después de la pausa: los periodos pausados nunca se emiten
        await generar(e.servicioId, '2026-12-05')
        await generar(e.servicioId, '2026-12-05')
        const despues = await facturasDe(e.servicioId)
        assert.deepEqual(
            despues.map((f) => f.periodo),
            ['2026-09-01', '2026-12-01'],
        )
        await afirmarLibroCuadrado(assert)
    })

    test('reglas: tope de días por empresa, pausa activa, suspensión manual previa y permiso', async ({
        client,
        assert,
    }) => {
        const e = await escenario({ fecha_instalacion: '2026-09-01' })
        const { token: soporte } = await usuarioConRoles(['soporte'])
        const { token: cajero } = await usuarioConRoles(['cajero'])
        const pausar = (token: string, dias: number) =>
            client
                .post(`/api/v1/servicios/${e.servicioId}/pausar-sin-cobro`)
                .bearerToken(token)
                .json({ motivo: 'Temporada fuera', dias })
        await estado(pausar(cajero, 10), 403)
        const ajustes = await leerAjustesCobro(1)
        await new EditarAjustesCobro().execute(
            { empresa_id: 1, version: ajustes.version, pausa_tope_dias: 30 },
            contextoPrueba(),
        )
        try {
            const largo = await estado(pausar(soporte, 31), 422)
            assert.equal(largo.body().errors[0].rule, 'tope_pausa')
            const r = await estado(pausar(soporte, 30), 201)
            assert.equal(r.body().dias, 30)
            const doble = await estado(pausar(soporte, 5), 422)
            assert.match(doble.body().type, /pausa_activa$/)
            const lista = await estado(
                client.get(`/api/v1/servicios/${e.servicioId}/pausas`).bearerToken(soporte),
                200,
            )
            assert.lengthOf(lista.body(), 1)

            // terminar antes de tiempo
            const t = await estado(
                client
                    .post(`/api/v1/servicios/${e.servicioId}/terminar-pausa`)
                    .bearerToken(soporte)
                    .json({ motivo: 'Regresó antes' }),
                200,
            )
            assert.equal(t.body().fin_motivo, 'manual')
            assert.equal(await estadoServicio(e.servicioId), 'activo')
            const sin = await estado(
                client.post(`/api/v1/servicios/${e.servicioId}/terminar-pausa`).bearerToken(soporte).json({}),
                422,
            )
            assert.match(sin.body().type, /sin_pausa$/)

            // la suspensión manual de siempre no se convierte en pausa
            await estado(
                client
                    .post(`/api/v1/servicios/${e.servicioId}/suspender`)
                    .bearerToken(soporte)
                    .json({ motivo: 'Lo pidió el titular' }),
                200,
            )
            const manual = await estado(pausar(soporte, 5), 422)
            assert.match(manual.body().type, /suspension_manual$/)
        } finally {
            const actual = await leerAjustesCobro(1)
            await new EditarAjustesCobro().execute(
                { empresa_id: 1, version: actual.version, pausa_tope_dias: 90 },
                contextoPrueba(),
            )
        }
    })

    test('si alguien reactiva por otro camino, el cron cierra la pausa sin tocar el servicio', async ({
        client,
        assert,
    }) => {
        const e = await escenario({ fecha_instalacion: '2026-09-01' })
        const pausa = await new PausarSinCobro().execute(
            { servicio_id: e.servicioId, motivo: 'Viaje', dias: 20 },
            contextoPrueba(),
        )
        const { token } = await usuarioConRoles(['soporte'])
        await estado(
            client
                .post(`/api/v1/servicios/${e.servicioId}/reactivar`)
                .bearerToken(token)
                .json({ motivo: 'Volvió' }),
            200,
        )
        const r = await new TerminarPausas().execute({}, contextoPrueba())
        assert.include(r.terminadas, pausa.id)
        const fila = await db.from('billing.pausas_servicio').where('id', pausa.id).first()
        assert.equal(fila.fin_motivo, 'reactivado')
        assert.equal(await estadoServicio(e.servicioId), 'activo')
    })
})
