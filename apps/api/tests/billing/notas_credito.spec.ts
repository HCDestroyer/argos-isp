import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado, saldoTexto } from '#tests/ledger/ayudas_libro'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import { repartirProporcional } from '#billing/notas_credito'
import { ConsumidorBilling } from '#billing/consumidor'
import { dec } from '#ledger/dinero'
import {
    estadoServicio,
    eventosDe,
    facturasDe,
    lineasAsiento,
    servicioCortado,
} from '#tests/billing/ayudas_billing'

/**
 * Nota de crédito interna (`facturas.nota_credito`): reduce el saldo de la factura y la CxC con un
 * asiento proporcional a la factura (Ingresos + IVA), nunca más que el saldo, re-evalúa el
 * servicio (reactiva) y aparece en el estado de cuenta.
 */

function nota(client: ApiClient, token: string, facturaId: number, cuerpo: Record<string, unknown>) {
    return client
        .post(`/api/v1/facturas/${facturaId}/notas-credito`)
        .bearerToken(token)
        .header('Idempotency-Key', unico('nc'))
        .json(cuerpo)
}

test.group('billing · notas de crédito', () => {
    test('parcial y total: asiento proporcional, saldo, evento, reactivación y estado de cuenta', async ({
        client,
        assert,
    }) => {
        const { servicioId, clienteId } = await servicioCortado()
        assert.equal(await estadoServicio(servicioId), 'suspendido')
        assert.equal(await saldoTexto(clienteId), '300.00')
        const facturas = await facturasDe(servicioId)
        const [septiembre, octubre] = facturas.filter((f) => f.tipo === 'servicio')
        const { token } = await usuarioConRoles(['contabilidad'])

        // parcial: Q50 de septiembre (sigue vencida, el servicio sigue cortado)
        const parcial = await estado(
            nota(client, token, septiembre!.id, { monto: '50.00', motivo: 'días sin servicio' }),
            201,
        )
        assert.containSubset(parcial.body(), {
            factura_id: septiembre!.id,
            cliente_id: clienteId,
            servicio_id: servicioId,
            monto: '50.00',
            iva: '5.36',
            subtotal: '44.64',
            motivo: 'días sin servicio',
        })
        assert.isNumber(parcial.body().asiento_id)
        assert.containSubset(parcial.body().factura, {
            id: septiembre!.id,
            estado: 'vencida',
            pagado: '50.00',
            acreditado: '50.00',
        })
        assert.deepEqual(parcial.body().servicios, [
            {
                servicio_id: servicioId,
                de: 'suspendido',
                estado: 'suspendido',
                cambiado: false,
                motivo: parcial.body().servicios[0].motivo,
            },
        ])
        assert.deepEqual(await lineasAsiento('nota_credito', parcial.body().id), [
            ['4.1.01', '44.64', '0.00', null],
            ['2.1.02', '5.36', '0.00', null],
            ['1.1.03', '0.00', '50.00', clienteId],
        ])
        assert.equal(await saldoTexto(clienteId), '250.00')
        await afirmarLibroCuadrado(assert)

        // no más que el saldo (Q100 restantes)
        const excede = await estado(
            nota(client, token, septiembre!.id, { monto: '100.01', motivo: 'de más' }),
            422,
        )
        assert.equal(excede.body().errors[0].field, 'monto')
        assert.match(excede.body().errors[0].message, /excede el saldo de la factura \(Q100\.00\)/)

        // total del resto: septiembre queda cubierta → una vencida → limitado (subir es inmediato)
        const resto = await estado(
            nota(client, token, septiembre!.id, { monto: '100.00', motivo: 'compensación' }),
            201,
        )
        assert.equal(resto.body().factura.estado, 'pagada')
        assert.equal(resto.body().factura.acreditado, '150.00')
        assert.lengthOf(resto.body().factura.notas_credito, 2)
        assert.containSubset(resto.body().servicios[0], {
            de: 'suspendido',
            estado: 'limitado',
            cambiado: true,
        })
        assert.equal(await estadoServicio(servicioId), 'limitado')

        // factura sin saldo → 409
        const sinSaldo = await estado(
            nota(client, token, septiembre!.id, { monto: '1.00', motivo: 'otra' }),
            409,
        )
        assert.equal(sinSaldo.body().type, 'urn:argosisp:problema:factura_sin_saldo')

        // octubre completa → activo
        const octubreNota = await estado(
            nota(client, token, octubre!.id, { monto: '150.00', motivo: 'cortesía' }),
            201,
        )
        assert.containSubset(octubreNota.body().servicios[0], { estado: 'activo', cambiado: true })
        assert.equal(await estadoServicio(servicioId), 'activo')
        assert.equal(await saldoTexto(clienteId), '0.00')

        // evento por nota
        const [evento] = await eventosDe('nota_credito.emitida', 'nota_credito_id', parcial.body().id)
        assert.deepEqual(evento.payload, {
            empresa_id: 1,
            nota_credito_id: parcial.body().id,
            factura_id: septiembre!.id,
            servicio_id: servicioId,
            cliente_id: clienteId,
            monto: '50.00',
            motivo: 'días sin servicio',
        })

        // estado de cuenta: tres abonos nota_credito y saldo cero
        const cuenta = await estado(
            client.get(`/api/v1/clientes/${clienteId}/estado-cuenta`).bearerToken(token),
            200,
        )
        const notas = cuenta.body().movimientos.filter((m: { tipo: string }) => m.tipo === 'nota_credito')
        assert.deepEqual(
            notas.map((m: { referencia_id: number; abono: string }) => [m.referencia_id, m.abono]),
            [
                [parcial.body().id, '50.00'],
                [resto.body().id, '100.00'],
                [octubreNota.body().id, '150.00'],
            ],
        )
        assert.match(notas[0].descripcion, new RegExp(`factura ${septiembre!.id}: días sin servicio`))
        assert.equal(cuenta.body().saldo, '0.00')
        assert.lengthOf(cuenta.body().facturas_pendientes, 0)

        // lectura: detalle de la factura y lista
        const detalle = await estado(client.get(`/api/v1/facturas/${octubre!.id}`).bearerToken(token), 200)
        assert.equal(detalle.body().acreditado, '150.00')
        assert.lengthOf(detalle.body().notas_credito, 1)
        const lista = await estado(
            client.get('/api/v1/notas-credito').qs({ factura_id: septiembre!.id }).bearerToken(token),
            200,
        )
        assert.deepEqual(
            lista.body().data.map((n: { id: number }) => n.id),
            [resto.body().id, parcial.body().id],
        )
        await estado(client.get(`/api/v1/notas-credito/${parcial.body().id}`).bearerToken(token), 200)

        // auditoría
        const auditoria = await db
            .from('audit.acciones')
            .where('accion', 'facturas.nota_credito')
            .where('entidad_tipo', 'factura')
            .where('entidad_id', septiembre!.id)
            .where('resultado', 'ok')
        assert.lengthOf(auditoria, 2)
        await afirmarLibroCuadrado(assert)
    })

    test('validación, permiso, factura anulada y anular factura con notas', async ({ client, assert }) => {
        const { servicioId } = await servicioCortado()
        const facturas = await facturasDe(servicioId)
        const [septiembre, octubre] = facturas.filter((f) => f.tipo === 'servicio')
        const { token } = await usuarioConRoles(['contabilidad'])
        const cajero = await usuarioConRoles(['cajero'])

        await estado(
            nota(client, cajero.token, septiembre!.id, { monto: '10.00', motivo: 'sin permiso' }),
            403,
        )
        const sinMotivo = await estado(nota(client, token, septiembre!.id, { monto: '10.00' }), 422)
        assert.equal(sinMotivo.body().errors[0].field, 'motivo')
        await estado(nota(client, token, septiembre!.id, { monto: '0', motivo: 'cero' }), 422)
        await estado(nota(client, token, 999_999_999, { monto: '1.00', motivo: 'no existe' }), 404)

        // con una nota, la factura no se anula
        await estado(nota(client, token, septiembre!.id, { monto: '10.00', motivo: 'ajuste' }), 201)
        const anular = await estado(
            client
                .post(`/api/v1/facturas/${septiembre!.id}/anular`)
                .bearerToken(token)
                .json({ motivo: 'no corresponde' }),
            409,
        )
        assert.equal(anular.body().type, 'urn:argosisp:problema:factura_con_notas_credito')

        // factura anulada → 409
        await estado(
            client
                .post(`/api/v1/facturas/${octubre!.id}/anular`)
                .bearerToken(token)
                .json({ motivo: 'emitida por error' }),
            200,
        )
        const anulada = await estado(
            nota(client, token, octubre!.id, { monto: '10.00', motivo: 'tarde' }),
            409,
        )
        assert.equal(anulada.body().type, 'urn:argosisp:problema:factura_anulada')

        // la nota es inmutable y su asiento no se revierte directo
        const [fila] = await db.from('billing.notas_credito').where('factura_id', septiembre!.id)
        await assert.rejects(() =>
            db.from('billing.notas_credito').where('id', fila.id).update({ motivo: 'cambiado' }),
        )
        const asiento = await db
            .from('ledger.asientos')
            .where('origen_tipo', 'nota_credito')
            .where('origen_id', fila.id)
            .firstOrFail()
        const reverso = await estado(
            client
                .post(`/api/v1/libro/asientos/${asiento.id}/revertir`)
                .bearerToken(token)
                .header('Idempotency-Key', unico('rev'))
                .json({ motivo: 'directo' }),
            422,
        )
        assert.equal(reverso.body().type, 'urn:argosisp:problema:reverso_por_documento')
        await afirmarLibroCuadrado(assert)
    })

    test('mora: la nota debita Recargos por mora; la acción también audita sin HTTP', async ({ assert }) => {
        const { servicioId, clienteId } = await servicioCortado({
            plantilla: { mora_tipo: 'fija', mora_valor: '10.00' },
        })
        const facturas = await facturasDe(servicioId)
        const mora = facturas.find((f) => f.tipo === 'mora')!
        const resultado = await new EmitirNotaCredito().execute(
            { factura_id: mora.id, monto: '10.00', motivo: 'perdón de mora' },
            contextoPrueba(),
        )
        assert.equal(resultado.iva, '0.00')
        assert.equal(resultado.factura.estado, 'pagada')
        assert.deepEqual(await lineasAsiento('nota_credito', resultado.id), [
            ['4.1.02', '10.00', '0.00', null],
            ['1.1.03', '0.00', '10.00', clienteId],
        ])
        await afirmarLibroCuadrado(assert)
    })

    test('reparto proporcional: suma exacta al centavo y el consumidor revisa promesas', async ({
        assert,
    }) => {
        const partes = repartirProporcional(
            [
                { cuenta_id: 1, cuenta_codigo: '4.1.01', haber: '89.29' },
                { cuenta_id: 2, cuenta_codigo: '2.1.02', haber: '10.71' },
            ],
            dec('33.33'),
        )
        assert.deepEqual(
            partes.map((p) => [p.cuenta_codigo, p.debe.toFixed(2)]),
            [
                ['4.1.01', '29.76'],
                ['2.1.02', '3.57'],
            ],
        )
        assert.isTrue(new ConsumidorBilling().acepta('nota_credito.emitida'))
    })
})
