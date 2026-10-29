import { test } from '@japa/runner'
import { contextoPrueba, estado, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado, saldoTexto } from '#tests/ledger/ayudas_libro'
import RegistrarPago from '#billing/actions/registrar_pago'
import VencerFacturas from '#billing/actions/vencer_facturas'
import { cuentaBancariaPrueba, escenario, generar, unicoBd } from '#tests/billing/ayudas_billing'

const ruta = (clienteId: number) => `/api/v1/clientes/${clienteId}/estado-cuenta`

test.group('billing · estado de cuenta', () => {
    test('auxiliar CxC con facturas, mora y pagos; saldo acumulado igual al saldo del libro', async ({
        client,
        assert,
    }) => {
        const { servicioId, clienteId } = await escenario({
            fecha_instalacion: '2026-09-01',
            plantilla: { mora_tipo: 'fija', mora_valor: '10.00' },
        })
        await generar(servicioId, '2026-10-01')
        await new VencerFacturas().execute({ servicio_id: servicioId, hasta: '2026-10-07' }, contextoPrueba())
        const pago = await new RegistrarPago().execute(
            { cliente_id: clienteId, metodo: 'caja', monto: '100.00' },
            contextoPrueba(),
        )
        await afirmarLibroCuadrado(assert)

        const { token } = await usuarioConRoles(['cajero'])
        const respuesta = await estado(client.get(ruta(clienteId)).bearerToken(token), 200)
        const cuenta = respuesta.body()
        assert.equal(cuenta.cliente_id, clienteId)
        assert.equal(cuenta.saldo, '220.00')
        assert.equal(cuenta.saldo, await saldoTexto(clienteId))
        assert.equal(cuenta.saldo_a_favor, '0.00')
        assert.deepEqual(
            cuenta.facturas_pendientes.map((f: Record<string, string>) => [
                f.tipo,
                f.estado,
                f.total,
                f.pagado,
            ]),
            [
                ['servicio', 'vencida', '150.00', '100.00'],
                ['servicio', 'vencida', '150.00', '0.00'],
                ['mora', 'vencida', '10.00', '0.00'],
                ['mora', 'vencida', '10.00', '0.00'],
            ],
        )
        assert.deepEqual(
            cuenta.movimientos.map((m: Record<string, string>) => [m.tipo, m.cargo, m.abono, m.saldo]),
            [
                ['factura', '150.00', '0.00', '150.00'],
                ['factura', '150.00', '0.00', '300.00'],
                ['mora', '10.00', '0.00', '310.00'],
                ['mora', '10.00', '0.00', '320.00'],
                ['pago', '0.00', '100.00', '220.00'],
            ],
        )
        assert.equal(cuenta.movimientos.at(-1).referencia_id, pago.id)
        assert.equal(cuenta.movimientos.at(-1).saldo, cuenta.saldo)
    })

    test('pago adelantado: saldo 0 y saldo a favor; cliente inexistente 404', async ({ client, assert }) => {
        const { servicioId, clienteId } = await escenario({ fecha_instalacion: '2026-10-01' })
        await generar(servicioId, '2026-10-01')
        const bancaria = await cuentaBancariaPrueba()
        await new RegistrarPago().execute(
            {
                cliente_id: clienteId,
                metodo: 'deposito',
                monto: '200.00',
                cuenta_bancaria_id: bancaria.id,
                referencia: await unicoBd('boleta'),
            },
            contextoPrueba(),
        )
        const { token } = await usuarioConRoles(['cajero'])
        const respuesta = await estado(client.get(ruta(clienteId)).bearerToken(token), 200)
        const cuenta = respuesta.body()
        assert.containSubset(cuenta, { saldo: '0.00', saldo_a_favor: '50.00', facturas_pendientes: [] })
        await estado(client.get(ruta(999_999_999)).bearerToken(token), 404)
    })
})
