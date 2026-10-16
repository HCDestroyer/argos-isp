import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado, saldoTexto } from '#tests/ledger/ayudas_libro'
import AnularFactura from '#billing/actions/anular_factura'
import RegistrarPago from '#billing/actions/registrar_pago'
import {
    estadoServicio,
    eventosDe,
    facturasDe,
    generar,
    lineasAsiento,
    servicioCortado,
} from '#tests/billing/ayudas_billing'

test.group('billing · anular factura', () => {
    test('revierte el asiento (y su mora), emite factura.anulada y re-evalúa el servicio', async ({
        client,
        assert,
    }) => {
        const { servicioId, clienteId } = await servicioCortado({
            plantilla: { mora_tipo: 'fija', mora_valor: '10.00' },
        })
        assert.equal(await estadoServicio(servicioId), 'suspendido')
        assert.equal(await saldoTexto(clienteId), '320.00')
        const facturas = await facturasDe(servicioId)
        const octubre = facturas.find((f) => f.tipo === 'servicio' && f.periodo === '2026-10-01')!
        const moraOctubre = facturas.find((f) => f.tipo === 'mora' && f.factura_origen_id === octubre.id)!

        const { token: cajero } = await usuarioConRoles(['cajero'])
        const { token: contador } = await usuarioConRoles(['contabilidad'])
        const ruta = `/api/v1/facturas/${octubre.id}/anular`
        await estado(client.post(ruta).bearerToken(cajero).json({ motivo: 'emitida por error' }), 403)
        await estado(client.post(ruta).bearerToken(contador).json({}), 422)

        const respuesta = await estado(
            client.post(ruta).bearerToken(contador).json({ motivo: 'emitida por error' }),
            200,
        )
        assert.containSubset(respuesta.body(), {
            id: octubre.id,
            estado: 'anulada',
            motivo_anulacion: 'emitida por error',
            pagado: '0.00',
        })
        assert.isNotNull(respuesta.body().anulada_en)

        // reverso del asiento de la factura y de su mora
        const asientoFactura = await lineasAsiento('factura', octubre.id)
        assert.lengthOf(asientoFactura, 6)
        assert.deepEqual(asientoFactura.slice(3), [
            ['1.1.03', '0.00', '150.00', clienteId],
            ['4.1.01', '133.93', '0.00', null],
            ['2.1.02', '16.07', '0.00', null],
        ])
        const asientoMora = await lineasAsiento('mora', moraOctubre.id)
        assert.deepEqual(asientoMora.slice(2), [
            ['1.1.03', '0.00', '10.00', clienteId],
            ['4.1.02', '10.00', '0.00', null],
        ])
        const mora = await db.from('billing.facturas').where('id', moraOctubre.id).firstOrFail()
        assert.equal(mora.estado, 'anulada')
        assert.equal(await saldoTexto(clienteId), '160.00')
        await afirmarLibroCuadrado(assert)

        const [evento] = await eventosDe('factura.anulada', 'factura_id', octubre.id)
        assert.deepEqual(evento.payload, {
            factura_id: octubre.id,
            servicio_id: servicioId,
            cliente_id: clienteId,
            total: '150.00',
            vence: '2026-10-06',
        })
        assert.lengthOf(await eventosDe('factura.anulada', 'factura_id', moraOctubre.id), 1)
        // queda una vencida → limitado (subir es inmediato)
        assert.equal(await estadoServicio(servicioId), 'limitado')

        await estado(client.post(ruta).bearerToken(contador).json({ motivo: 'otra vez' }), 409)
        // el periodo no se vuelve a emitir
        const otra = await generar(servicioId, '2026-10-01')
        assert.equal(otra.generadas, 0)
    })

    test('con pagos aplicados → 409; tras anular el pago se puede anular', async ({ client, assert }) => {
        const { servicioId, clienteId } = await servicioCortado()
        const [septiembre] = await facturasDe(servicioId)
        const pago = await new RegistrarPago().execute(
            { cliente_id: clienteId, metodo: 'caja', monto: '50.00' },
            contextoPrueba(),
        )
        const { token } = await usuarioConRoles(['contabilidad'])
        const ruta = `/api/v1/facturas/${septiembre!.id}/anular`
        const conflicto = await estado(client.post(ruta).bearerToken(token).json({ motivo: 'error' }), 409)
        assert.equal(conflicto.body().type, 'urn:argosisp:problema:factura_con_pagos')
        assert.match(conflicto.body().detail, /anula primero el pago/)

        await estado(
            client
                .post(`/api/v1/pagos/${pago.id}/anular`)
                .bearerToken(token)
                .json({ motivo: 'error de caja' }),
            200,
        )
        await new AnularFactura().execute(
            { factura_id: septiembre!.id, motivo: 'servicio no instalado' },
            contextoPrueba(),
        )
        assert.equal(await saldoTexto(clienteId), '150.00')
        assert.equal(await estadoServicio(servicioId), 'limitado')
        await afirmarLibroCuadrado(assert)
    })
})
