import { test } from '@japa/runner'
import { contextoPrueba, estado, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado, saldoTexto } from '#tests/ledger/ayudas_libro'
import { morasDebidas } from '#billing/mora'
import VencerFacturas from '#billing/actions/vencer_facturas'
import { asientoDe, escenario, eventosDe, facturasDe, generar } from '#tests/billing/ayudas_billing'

const vencer = (servicioId: number, hasta: string) =>
    new VencerFacturas().execute({ servicio_id: servicioId, hasta }, contextoPrueba())

test.group('billing · vencerFacturas', () => {
    test('morasDebidas: una al vencer; recurrente, una más por cada mes cumplido', ({ assert }) => {
        const fija = { mora_tipo: 'fija', mora_valor: '25.00', mora_recurrente: false } as const
        assert.equal(morasDebidas(fija, '2026-07-06', '2026-07-06'), 0)
        assert.equal(morasDebidas(fija, '2026-07-06', '2026-07-07'), 1)
        assert.equal(morasDebidas(fija, '2026-07-06', '2026-12-07'), 1)
        const recurrente = { ...fija, mora_recurrente: true }
        assert.equal(morasDebidas(recurrente, '2026-07-06', '2026-08-06'), 1)
        assert.equal(morasDebidas(recurrente, '2026-07-06', '2026-08-07'), 2)
        assert.equal(morasDebidas(recurrente, '2026-07-06', '2026-09-10'), 3)
        assert.equal(morasDebidas({ ...fija, mora_tipo: 'ninguna' }, '2026-07-06', '2027-01-01'), 0)
    })

    test('vence pasada la gracia, mora fija con asiento CxC / Recargos y factura.vencida; repetir no duplica', async ({
        assert,
    }) => {
        const { servicioId, clienteId } = await escenario({
            fecha_instalacion: '2026-09-01',
            plantilla: { dias_gracia: 5, mora_tipo: 'fija', mora_valor: '25.00' },
        })
        await generar(servicioId, '2026-10-01')

        // el 6 de octubre todavía no vence la de octubre (vence_en = 6)
        assert.deepEqual(await vencer(servicioId, '2026-10-06'), { vencidas: 1, moras: 1, errores: 0 })
        await afirmarLibroCuadrado(assert)
        let facturas = await facturasDe(servicioId)
        assert.deepEqual(
            facturas.map((f) => [f.tipo, f.periodo, f.estado, f.total, f.iva]),
            [
                ['servicio', '2026-09-01', 'vencida', '150.00', '16.07'],
                ['servicio', '2026-10-01', 'emitida', '150.00', '16.07'],
                ['mora', '2026-09-01', 'vencida', '25.00', '0.00'],
            ],
        )
        const mora = facturas[2]!
        assert.equal(mora.factura_origen_id, facturas[0]!.id)
        const asiento = await asientoDe('mora', mora.id)
        assert.deepEqual(
            asiento.map((m) => [m.codigo, m.debe, m.haber]),
            [
                ['1.1.03', '25.00', '0.00'],
                ['4.1.02', '0.00', '25.00'],
            ],
        )
        const eventos = await eventosDe('factura.vencida', 'servicio_id', servicioId)
        assert.lengthOf(eventos, 1)
        assert.deepEqual(eventos[0].payload, {
            empresa_id: 1,
            factura_id: facturas[0]!.id,
            servicio_id: servicioId,
            cliente_id: clienteId,
            total: '150.00',
            vence: '2026-09-06',
        })

        assert.deepEqual(await vencer(servicioId, '2026-10-06'), { vencidas: 0, moras: 0, errores: 0 })
        assert.deepEqual(await vencer(servicioId, '2026-10-07'), { vencidas: 1, moras: 1, errores: 0 })
        facturas = await facturasDe(servicioId)
        assert.lengthOf(facturas, 4)
        assert.lengthOf(await eventosDe('factura.vencida', 'servicio_id', servicioId), 2)
        assert.equal(await saldoTexto(clienteId), '350.00')
        await afirmarLibroCuadrado(assert)
    })

    test('mora porcentual recurrente: un recargo por mes vencido, todo lo pendiente de una vez', async ({
        assert,
    }) => {
        const { servicioId, clienteId } = await escenario({
            fecha_instalacion: '2026-07-01',
            plantilla: {
                dias_gracia: 5,
                mora_tipo: 'porcentaje',
                mora_valor: '10.00',
                mora_recurrente: true,
            },
        })
        await generar(servicioId, '2026-07-01')
        assert.deepEqual(await vencer(servicioId, '2026-09-10'), { vencidas: 1, moras: 3, errores: 0 })
        const todas = await facturasDe(servicioId)
        const moras = todas.filter((f) => f.tipo === 'mora')
        assert.deepEqual(
            moras.map((m) => m.total),
            ['15.00', '15.00', '15.00'],
        )
        assert.deepEqual(await vencer(servicioId, '2026-09-10'), { vencidas: 0, moras: 0, errores: 0 })
        assert.deepEqual(await vencer(servicioId, '2026-10-07'), { vencidas: 0, moras: 1, errores: 0 })
        assert.equal(await saldoTexto(clienteId), '210.00')
        await afirmarLibroCuadrado(assert)
    })

    test('POST /facturas/vencer sin mora configurada solo vence', async ({ client, assert }) => {
        const { servicioId } = await escenario({ fecha_instalacion: '2026-09-01' })
        await generar(servicioId, '2026-09-01')
        const { token } = await usuarioConRoles(['contabilidad'])
        const respuesta = await estado(
            client
                .post('/api/v1/facturas/vencer')
                .bearerToken(token)
                .json({ servicio_id: servicioId, hasta: '2026-09-07' }),
            200,
        )
        assert.deepEqual(respuesta.body(), { vencidas: 1, moras: 0, errores: 0 })
        const [factura] = await facturasDe(servicioId)
        assert.equal(factura!.estado, 'vencida')
        await afirmarLibroCuadrado(assert)
    })
})
