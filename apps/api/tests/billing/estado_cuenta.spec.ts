import db from '@adonisjs/lucid/services/db'
import { test } from '@japa/runner'
import { contextoPrueba, estado, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado, saldoTexto } from '#tests/ledger/ayudas_libro'
import RegistrarPago from '#billing/actions/registrar_pago'
import VencerFacturas from '#billing/actions/vencer_facturas'
import { cuentaBancariaPrueba, escenario, generar, unicoBd } from '#tests/billing/ayudas_billing'
import { crearServicioFila } from '#tests/core/fabricas'
import AnularPago from '#billing/actions/anular_pago'

const ruta = (clienteId: number) => `/api/v1/clientes/${clienteId}/estado-cuenta`

test.group('billing · estado de cuenta', () => {
    test('por servicio: solo sus facturas y la parte de cada pago que le toca (Iris 0.10.0 §2.1)', async ({
        client,
        assert,
    }) => {
        const e = await escenario({ precio: '150.00' })
        const otro = await crearServicioFila({
            cliente_id: e.clienteId,
            plan_id: e.planId,
            plantilla_facturacion_id: e.plantillaId,
            fecha_instalacion: '2026-09-01',
        })
        await generar(e.servicioId, '2026-09-01')
        await generar(otro, '2026-09-01')
        // un pago que cubre la factura de los dos servicios y parte de una segunda
        const pago = await new RegistrarPago().execute(
            { cliente_id: e.clienteId, metodo: 'caja', monto: '200.00' },
            contextoPrueba(),
        )
        const { token } = await usuarioConRoles(['cajero'])
        const completo = await estado(client.get(ruta(e.clienteId)).bearerToken(token), 200)
        assert.equal(completo.body().servicio_id, null)
        assert.equal(completo.body().saldo, '100.00')

        const facturaDe = async (servicioId: number) => {
            const fila = await db
                .from('billing.facturas')
                .where('servicio_id', servicioId)
                .select('id')
                .firstOrFail()
            return Number(fila.id)
        }
        const fa = await facturaDe(e.servicioId)
        const fb = await facturaDe(otro)
        const aplicado = async (facturaId: number) => {
            const fila = await db
                .from('billing.facturas')
                .where('id', facturaId)
                .select('pagado')
                .firstOrFail()
            return String(fila.pagado)
        }
        const pagadoA = await aplicado(fa)
        const pagadoB = await aplicado(fb)

        for (const [servicioId, facturaId, pagado, otraFactura] of [
            [e.servicioId, fa, pagadoA, fb],
            [otro, fb, pagadoB, fa],
        ] as const) {
            const cuenta = await estado(
                client.get(`${ruta(e.clienteId)}?servicio_id=${servicioId}`).bearerToken(token),
                200,
            )
            const body = cuenta.body()
            assert.equal(body.servicio_id, servicioId)
            const saldo = (150 * 100 - Math.round(Number(pagado) * 100)) / 100
            assert.equal(body.saldo, saldo.toFixed(2))
            assert.equal(body.saldo_a_favor, '0.00')
            assert.deepEqual(
                body.facturas_pendientes.map((f: { id: number }) => f.id),
                saldo > 0 ? [facturaId] : [],
            )
            assert.deepEqual(
                body.movimientos.map((m: Record<string, string>) => [m.tipo, m.cargo, m.abono]),
                [
                    ['factura', '150.00', '0.00'],
                    ['pago', '0.00', pagado],
                ],
            )
            const delPago = body.movimientos[1]
            assert.equal(delPago.referencia_id, pago.id)
            // solo nombra la factura del servicio, nunca la del otro
            assert.equal(/facturas? ([\d, ]+)/.exec(delPago.descripcion)?.[1], String(facturaId))
            assert.notEqual(facturaId, otraFactura)
            assert.equal(body.movimientos.at(-1).saldo, body.saldo)
        }

        // anular el pago: el reverso devuelve a cada servicio lo suyo
        await new AnularPago().execute({ pago_id: pago.id, motivo: 'cheque rechazado' }, contextoPrueba())
        const tras = await estado(
            client.get(`${ruta(e.clienteId)}?servicio_id=${e.servicioId}`).bearerToken(token),
            200,
        )
        assert.equal(tras.body().saldo, '150.00')
        assert.deepEqual(
            tras.body().movimientos.map((m: Record<string, string>) => [m.tipo, m.cargo, m.abono]),
            [
                ['factura', '150.00', '0.00'],
                ['pago', '0.00', pagadoA],
                ['pago', pagadoA, '0.00'],
            ],
        )
        // un servicio de otro cliente: 404
        const ajeno = await escenario()
        await estado(
            client.get(`${ruta(e.clienteId)}?servicio_id=${ajeno.servicioId}`).bearerToken(token),
            404,
        )
        await afirmarLibroCuadrado(assert)
    })

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
