import { test } from '@japa/runner'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado, saldoTexto } from '#tests/ledger/ayudas_libro'
import EjecutarCorte from '#billing/actions/ejecutar_corte'
import {
    cuentaBancariaPrueba,
    escenario,
    estadoServicio,
    eventosDe,
    facturasDe,
    generar,
} from '#tests/billing/ayudas_billing'

/**
 * Tarea 12 (parcial): ciclo completo emitir → vencer → limitar → cortar → pagar → reactivar, con
 * el SELECT de control del libro (Debe = Haber, ningún asiento descuadrado) después de cada paso.
 * Criterio del brief: `facturas_para_cortar = 2`: primera vencida → limitado; segunda →
 * suspendido; pagar una → sigue limitado; pagar las dos → activo.
 */

/** Corte del servicio a la hora local de Guatemala indicada (UTC−6). */
const corteA = (servicioId: number, fechaHora: string) =>
    new EjecutarCorte().execute(
        { servicio_id: servicioId, ahora: new Date(`${fechaHora}:00-06:00`) },
        contextoPrueba(),
    )

test.group('billing · ciclo completo', () => {
    test('emitir → vencer → limitar → cortar → pagar una (limitado) → pagar todo (activo), libro cuadrado en cada paso', async ({
        client,
        assert,
    }) => {
        const { servicioId, clienteId } = await escenario({
            fecha_instalacion: '2026-09-01',
            plantilla: {
                dias_gracia: 5,
                facturas_para_limitar: 1,
                facturas_para_cortar: 2,
                hora_corte: '08:00',
            },
        })
        const paso = async (estadoEsperado: string, saldo: string) => {
            await afirmarLibroCuadrado(assert)
            assert.equal(await estadoServicio(servicioId), estadoEsperado)
            assert.equal(await saldoTexto(clienteId), saldo)
        }

        // 1. emitir septiembre (dos veces: no duplica)
        const emitida = await generar(servicioId, '2026-09-01')
        const repetida = await generar(servicioId, '2026-09-01')
        assert.equal(emitida.generadas, 1)
        assert.equal(repetida.generadas, 0)
        await paso('activo', '150.00')

        // 2. vence el 6; el corte del 7 antes de las 08:00 todavía no baja
        const temprano = await corteA(servicioId, '2026-09-07T07:59')
        assert.equal(temprano.vencimiento!.vencidas, 1)
        await paso('activo', '150.00')

        // 3. primera vencida → limitado a la hora de corte
        const limitar = await corteA(servicioId, '2026-09-07T08:00')
        assert.equal(limitar.cambiados, 1)
        await paso('limitado', '150.00')

        // 4. emitir octubre y vencerla → segunda vencida → suspendido
        const octubre = await generar(servicioId, '2026-10-01')
        assert.equal(octubre.generadas, 1)
        await paso('limitado', '300.00')
        const cortar = await corteA(servicioId, '2026-10-07T08:30')
        assert.equal(cortar.vencimiento!.vencidas, 1)
        await paso('suspendido', '300.00')

        // 5. pagar una (cobro rápido del panel) → sigue limitado, de inmediato
        const { token } = await usuarioConRoles(['cajero'])
        const primera = await estado(
            client
                .post('/api/v1/pagos')
                .bearerToken(token)
                .header('Idempotency-Key', unico('cobro'))
                .json({ cliente_id: clienteId, metodo: 'caja', monto: '150.00', referencia: unico('rec') }),
            201,
        )
        assert.deepEqual(primera.body().servicios[0], {
            servicio_id: servicioId,
            de: 'suspendido',
            estado: 'limitado',
            cambiado: true,
            motivo: '1 factura vencida (se limita con 1)',
        })
        await paso('limitado', '150.00')

        const cuenta = await cuentaBancariaPrueba()
        // 6. pagar la otra → activo
        const segunda = await estado(
            client
                .post('/api/v1/pagos')
                .bearerToken(token)
                .json({
                    cliente_id: clienteId,
                    metodo: 'deposito',
                    monto: '150.00',
                    referencia: unico('boleta'),
                    cuenta_bancaria_id: cuenta.id,
                }),
            201,
        )
        assert.equal(segunda.body().servicios[0].estado, 'activo')
        await paso('activo', '0.00')

        const facturas = await facturasDe(servicioId)
        assert.deepEqual(
            facturas.map((f) => [f.periodo, f.estado, f.pagado]),
            [
                ['2026-09-01', 'pagada', '150.00'],
                ['2026-10-01', 'pagada', '150.00'],
            ],
        )
        const cambios = await eventosDe('servicio.estado_cambiado', 'servicio_id', servicioId)
        assert.deepEqual(
            cambios.map((e) => [e.payload.de, e.payload.a]),
            [
                ['activo', 'limitado'],
                ['limitado', 'suspendido'],
                ['suspendido', 'limitado'],
                ['limitado', 'activo'],
            ],
        )
        assert.lengthOf(await eventosDe('factura.emitida', 'servicio_id', servicioId), 2)
        assert.lengthOf(await eventosDe('factura.vencida', 'servicio_id', servicioId), 2)
        assert.lengthOf(await eventosDe('pago.registrado', 'cliente_id', clienteId), 2)
    })
})
