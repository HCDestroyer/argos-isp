import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado, saldoTexto } from '#tests/ledger/ayudas_libro'
import { sumar } from '#ledger/dinero'
import RegistrarPago from '#billing/actions/registrar_pago'
import AnularPago from '#billing/actions/anular_pago'
import VencerFacturas from '#billing/actions/vencer_facturas'
import EvaluarEstadoServicio from '#billing/actions/evaluar_estado_servicio'
import {
    asientoDe,
    escenario,
    estadoServicio,
    eventosDe,
    facturasDe,
    generar,
    lineasAsiento,
    cuentaBancariaPrueba,
} from '#tests/billing/ayudas_billing'

const RUTA = '/api/v1/pagos'

const pagar = (clienteId: number, monto: string, extra: Record<string, unknown> = {}) =>
    new RegistrarPago().execute({ cliente_id: clienteId, metodo: 'caja', monto, ...extra }, contextoPrueba())

/** Servicio con septiembre y octubre vencidas y cortado (hora de corte 00:00: baja sin esperar). */
async function cortado() {
    const datos = await escenario({ fecha_instalacion: '2026-09-01', plantilla: { hora_corte: '00:00' } })
    await generar(datos.servicioId, '2026-10-01')
    await new VencerFacturas().execute(
        { servicio_id: datos.servicioId, hasta: '2026-10-07' },
        contextoPrueba(),
    )
    await new EvaluarEstadoServicio().execute({ servicio_id: datos.servicioId }, contextoPrueba())
    return datos
}

async function anticipo(clienteId: number) {
    const fila = await db
        .from('ledger.movimientos as m')
        .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
        .where('c.codigo', '2.1.01')
        .where('m.cliente_id', clienteId)
        .select(db.raw('(coalesce(sum(haber), 0) - coalesce(sum(debe), 0))::text as saldo'))
        .firstOrFail()
    return fila.saldo as string
}

test.group('billing · registrarPago', () => {
    test('pago parcial a la más antigua: queda vencida y el servicio sigue cortado', async ({ assert }) => {
        const { servicioId, clienteId } = await cortado()
        assert.equal(await estadoServicio(servicioId), 'suspendido')

        const pago = await pagar(clienteId, '100')
        await afirmarLibroCuadrado(assert)
        const [septiembre] = await facturasDe(servicioId)
        assert.containSubset(pago.aplicaciones, [{ factura_id: septiembre!.id, monto: '100.00' }])
        assert.containSubset(pago, { monto: '100.00', metodo: 'caja', estado: 'registrado' })
        assert.isNotNull(pago.caja_id)
        assert.deepEqual(
            pago.servicios.map((s) => [s.servicio_id, s.estado, s.cambiado]),
            [[servicioId, 'suspendido', false]],
        )
        const facturas = await facturasDe(servicioId)
        assert.deepEqual(
            facturas.map((f) => [f.estado, f.pagado]),
            [
                ['vencida', '100.00'],
                ['vencida', '0.00'],
            ],
        )
        assert.deepEqual(await lineasAsiento('pago', pago.id), [
            ['1.1.01.01', '100.00', '0.00', null],
            ['1.1.03', '0.00', '100.00', clienteId],
        ])
        const [evento] = await eventosDe('pago.registrado', 'pago_id', pago.id)
        assert.deepEqual(evento.payload, {
            pago_id: pago.id,
            cliente_id: clienteId,
            monto: '100.00',
            metodo: 'caja',
            facturas: [septiembre!.id],
            clientes: [clienteId],
        })
        assert.equal(await saldoTexto(clienteId), '200.00')
    })

    test('pagar todo reactiva en la misma transacción; el excedente va a Anticipos y cubre la siguiente factura', async ({
        assert,
    }) => {
        const { servicioId, clienteId } = await cortado()
        const pago = await pagar(clienteId, '350.00', { referencia: unico('boleta') })
        await afirmarLibroCuadrado(assert)

        assert.deepEqual(
            pago.servicios.map((s) => [s.de, s.estado, s.cambiado]),
            [['suspendido', 'activo', true]],
        )
        assert.equal(await estadoServicio(servicioId), 'activo')
        const cambio = await eventosDe('servicio.estado_cambiado', 'servicio_id', servicioId)
        assert.deepEqual(cambio.at(-1)!.payload.a, 'activo')
        const accion = await db
            .from('audit.acciones')
            .where('accion', 'pagos.registrar')
            .where('entidad_id', pago.id)
            .firstOrFail()
        assert.equal(cambio.at(-1)!.request_id, accion.request_id)
        assert.deepEqual(await lineasAsiento('pago', pago.id), [
            ['1.1.01.01', '350.00', '0.00', null],
            ['1.1.03', '0.00', '300.00', clienteId],
            ['2.1.01', '0.00', '50.00', clienteId],
        ])
        assert.equal(await saldoTexto(clienteId), '0.00')
        assert.equal(await anticipo(clienteId), '50.00')

        await generar(servicioId, '2026-11-01')
        const todas = await facturasDe(servicioId)
        const noviembre = todas.at(-1)!
        assert.deepEqual(
            [noviembre.periodo, noviembre.estado, noviembre.pagado],
            ['2026-11-01', 'parcial', '50.00'],
        )
        assert.equal(await anticipo(clienteId), '0.00')
        assert.equal(await saldoTexto(clienteId), '100.00')
        await afirmarLibroCuadrado(assert)
    })

    test('facturas preferidas primero; depósito va a Bancos; validaciones', async ({ assert }) => {
        const { servicioId, clienteId } = await cortado()
        const [septiembre, octubre] = await facturasDe(servicioId)
        const cuenta = await cuentaBancariaPrueba()
        const pago = await pagar(clienteId, '150', {
            metodo: 'deposito',
            facturas: [octubre!.id],
            cuenta_bancaria_id: cuenta.id,
            referencia: unico('boleta'),
        })
        assert.containSubset(pago.aplicaciones, [{ factura_id: octubre!.id, monto: '150.00' }])
        assert.isNull(pago.caja_id)
        const [banco] = await asientoDe('pago', pago.id)
        assert.equal(banco!.codigo, cuenta.cuenta_codigo)
        // una vencida: con cortar = 2 y limitar = 1 queda limitado
        assert.deepEqual(
            pago.servicios.map((s) => s.estado),
            ['limitado'],
        )
        const despues = await facturasDe(servicioId)
        assert.deepEqual(
            despues.map((f) => [f.id, f.estado]),
            [
                [septiembre!.id, 'vencida'],
                [octubre!.id, 'pagada'],
            ],
        )

        const otro = await escenario()
        await assert.rejects(
            () => pagar(clienteId, '10', { facturas: [otro.servicioId * 1000] }),
            /no son válidos/,
        )
        await assert.rejects(() => pagar(clienteId, '0'), /no son válidos/)
        await assert.rejects(() => pagar(999_999_999, '10'), /no son válidos/)
        await afirmarLibroCuadrado(assert)
    })
})

test.group('billing · registrarPago (concurrencia)', () => {
    test('dos cobros simultáneos del mismo cliente se aplican uno tras otro', async ({ assert }) => {
        const { servicioId, clienteId } = await cortado()
        const [a, b] = await Promise.all([pagar(clienteId, '150'), pagar(clienteId, '200')])
        const aplicado = sumar([...a.aplicaciones, ...b.aplicaciones].map((x) => x.monto))
        assert.equal(aplicado.toFixed(2), '300.00')
        const facturas = await facturasDe(servicioId)
        assert.deepEqual(
            facturas.map((f) => [f.estado, f.pagado]),
            [
                ['pagada', '150.00'],
                ['pagada', '150.00'],
            ],
        )
        assert.equal(await anticipo(clienteId), '50.00')
        assert.equal(await estadoServicio(servicioId), 'activo')
        await afirmarLibroCuadrado(assert)
    })
})

test.group('billing · anularPago', () => {
    test('revierte asientos (cobro y anticipo aplicado), devuelve las facturas a vencida y vuelve a cortar', async ({
        assert,
    }) => {
        const { servicioId, clienteId } = await cortado()
        const primero = await pagar(clienteId, '100')
        const segundo = await pagar(clienteId, '250')
        assert.equal(await estadoServicio(servicioId), 'activo')
        await generar(servicioId, '2026-11-01') // el anticipo de 50 cubre parte de noviembre
        assert.equal(await anticipo(clienteId), '0.00')

        const anulado = await new AnularPago().execute(
            { pago_id: segundo.id, motivo: 'boleta rechazada por el banco' },
            contextoPrueba(),
        )
        await afirmarLibroCuadrado(assert)
        assert.containSubset(anulado, {
            estado: 'anulado',
            motivo_anulacion: 'boleta rechazada por el banco',
        })
        assert.isNotNull(anulado.anulado_en)

        const facturas = await facturasDe(servicioId)
        assert.deepEqual(
            facturas.map((f) => [f.periodo, f.estado, f.pagado]),
            [
                ['2026-09-01', 'vencida', '100.00'],
                ['2026-10-01', 'vencida', '0.00'],
                ['2026-11-01', 'emitida', '0.00'],
            ],
        )
        const asientos = await db
            .from('ledger.asientos')
            .where('origen_tipo', 'pago')
            .where('origen_id', segundo.id)
            .orderBy('id')
        assert.lengthOf(asientos, 4)
        assert.lengthOf(
            asientos.filter((a) => a.reversa_de !== null),
            2,
        )
        assert.equal(await saldoTexto(clienteId), '350.00')
        assert.equal(await anticipo(clienteId), '0.00')
        assert.equal(await estadoServicio(servicioId), 'suspendido')
        assert.lengthOf(await eventosDe('pago.anulado', 'pago_id', segundo.id), 1)

        await assert.rejects(
            () => new AnularPago().execute({ pago_id: segundo.id, motivo: 'otra vez' }, contextoPrueba()),
            /ya está anulado/,
        )
        const intacto = await db.from('billing.pagos').where('id', primero.id).firstOrFail()
        assert.equal(intacto.estado, 'registrado')
    })
})

test.group('billing · pagos (API)', () => {
    test('POST /pagos (cajero): Idempotency-Key repite la respuesta; referencia repetida 409; GET lista y recibo', async ({
        client,
        assert,
    }) => {
        const { clienteId } = await cortado()
        const { token } = await usuarioConRoles(['cajero'])
        const referencia = unico('rec')
        const cuerpo = { cliente_id: clienteId, metodo: 'caja', monto: '300.00', referencia }
        const clave = unico('idem')

        const primera = await estado(
            client.post(RUTA).bearerToken(token).header('Idempotency-Key', clave).json(cuerpo),
            201,
        )
        const repetida = await estado(
            client.post(RUTA).bearerToken(token).header('Idempotency-Key', clave).json(cuerpo),
            201,
        )
        assert.equal(repetida.header('idempotent-replayed'), 'true')
        assert.equal(repetida.body().id, primera.body().id)
        assert.equal(primera.body().servicios[0].estado, 'activo')

        const duplicada = await estado(client.post(RUTA).bearerToken(token).json(cuerpo), 409)
        assert.equal(duplicada.body().type, 'urn:argosisp:problema:referencia_duplicada')
        const pagos = await db.from('billing.pagos').where('referencia', referencia)
        assert.lengthOf(pagos, 1)

        const lista = await estado(client.get(RUTA).qs({ cliente_id: clienteId }).bearerToken(token), 200)
        assert.lengthOf(lista.body().data, 1)
        assert.lengthOf(lista.body().data[0].aplicaciones, 2)
        const recibo = await estado(client.get(`${RUTA}/${primera.body().id}`).bearerToken(token), 200)
        assert.containSubset(recibo.body(), {
            id: primera.body().id,
            monto: '300.00',
            referencia,
            estado: 'registrado',
        })

        await estado(
            client
                .post(`${RUTA}/${primera.body().id}/anular`)
                .bearerToken(token)
                .json({ motivo: 'error de dedo' }),
            403,
        )
        const { token: admin } = await usuarioConRoles(['admin'])
        await estado(
            client
                .post(`${RUTA}/${primera.body().id}/anular`)
                .bearerToken(admin)
                .json({ motivo: 'error de dedo' }),
            200,
        )
        await estado(
            client
                .post(RUTA)
                .bearerToken(token)
                .json({ ...cuerpo, cliente_id: 999_999_999, referencia: null }),
            422,
        )
        await afirmarLibroCuadrado(assert)
    })
})
