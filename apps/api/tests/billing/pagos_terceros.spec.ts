import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado, saldoTexto } from '#tests/ledger/ayudas_libro'
import CrearPromesaPago from '#billing/actions/crear_promesa_pago'
import { ConsumidorBilling } from '#billing/consumidor'
import {
    bancoId,
    cuentaBancariaPrueba,
    estadoServicio,
    eventosDe,
    facturasDe,
    lineasAsiento,
    servicioCortado,
    unicoBd,
    AHORA_PROMESAS,
    diasDespues,
} from '#tests/billing/ayudas_billing'

/**
 * Pago de terceros (decisión del PM): una persona paga con una sola transferencia su factura y
 * la de un familiar (cuyo servicio está a nombre del familiar).
 */

async function nombreDe(clienteId: number): Promise<string> {
    const fila = await db.from('core.clientes').where('id', clienteId).select('nombre').firstOrFail()
    return fila.nombre as string
}

test.group('billing · pago de terceros', () => {
    test('una transferencia cubre dos clientes: un asiento, dos auxiliares, reactiva ambos y se anula entero', async ({
        client,
        assert,
    }) => {
        const pagador = await servicioCortado()
        const familiar = await servicioCortado()
        const [septiembreF, octubreF] = await facturasDe(familiar.servicioId)
        const cuenta = await cuentaBancariaPrueba()
        const { token } = await usuarioConRoles(['cajero'])
        const { token: contador } = await usuarioConRoles(['contabilidad'])
        const referencia = await unicoBd('trf')
        const cuerpo = {
            cliente_id: pagador.clienteId,
            metodo: 'transferencia',
            monto: '650.00',
            referencia,
            cuenta_bancaria_id: cuenta.id,
            banco_origen_id: await bancoId(),
            facturas: [septiembreF!.id, octubreF!.id],
        }

        const respuesta = await estado(
            client
                .post('/api/v1/pagos')
                .bearerToken(token)
                .header('Idempotency-Key', unico('p'))
                .json(cuerpo),
            201,
        )
        const pago = respuesta.body()
        const [septiembreP, octubreP] = await facturasDe(pagador.servicioId)
        const nombreF = await nombreDe(familiar.clienteId)
        const nombreP = await nombreDe(pagador.clienteId)
        assert.deepEqual(pago.aplicaciones, [
            {
                factura_id: septiembreF!.id,
                monto: '150.00',
                cliente_id: familiar.clienteId,
                cliente_nombre: nombreF,
            },
            {
                factura_id: octubreF!.id,
                monto: '150.00',
                cliente_id: familiar.clienteId,
                cliente_nombre: nombreF,
            },
            {
                factura_id: septiembreP!.id,
                monto: '150.00',
                cliente_id: pagador.clienteId,
                cliente_nombre: nombreP,
            },
            {
                factura_id: octubreP!.id,
                monto: '150.00',
                cliente_id: pagador.clienteId,
                cliente_nombre: nombreP,
            },
        ])
        assert.sameDeepMembers(
            pago.servicios.map((s: { servicio_id: number; estado: string }) => [s.servicio_id, s.estado]),
            [
                [familiar.servicioId, 'activo'],
                [pagador.servicioId, 'activo'],
            ],
        )
        assert.equal(await estadoServicio(familiar.servicioId), 'activo')
        assert.equal(await estadoServicio(pagador.servicioId), 'activo')

        // un solo asiento: banco por el total; CxC de cada dueño; el excedente a Anticipos del pagador
        const lineas = await lineasAsiento('pago', pago.id)
        const [menor, mayor] = [pagador.clienteId, familiar.clienteId].sort((a, b) => a - b)
        assert.deepEqual(lineas, [
            [cuenta.cuenta_codigo, '650.00', '0.00', null],
            ['1.1.03', '0.00', '300.00', menor],
            ['1.1.03', '0.00', '300.00', mayor],
            ['2.1.01', '0.00', '50.00', pagador.clienteId],
        ])
        const asientos = await db
            .from('ledger.asientos')
            .where('origen_tipo', 'pago')
            .where('origen_id', pago.id)
        assert.lengthOf(asientos, 1)
        assert.equal(await saldoTexto(familiar.clienteId), '0.00')
        assert.equal(await saldoTexto(pagador.clienteId), '0.00')
        await afirmarLibroCuadrado(assert)

        const [evento] = await eventosDe('pago.registrado', 'pago_id', pago.id)
        assert.deepEqual(evento.payload.clientes, [pagador.clienteId, familiar.clienteId])
        assert.equal(evento.payload.cliente_id, pagador.clienteId)

        // estado de cuenta del familiar: "pagado por <pagador>"
        const cuentaF = await estado(
            client.get(`/api/v1/clientes/${familiar.clienteId}/estado-cuenta`).bearerToken(token),
            200,
        )
        assert.match(cuentaF.body().movimientos.at(-1).descripcion, new RegExp(`pagado por ${nombreP}$`))
        const cuentaP = await estado(
            client.get(`/api/v1/clientes/${pagador.clienteId}/estado-cuenta`).bearerToken(token),
            200,
        )
        assert.notMatch(cuentaP.body().movimientos.at(-1).descripcion, /pagado por/)

        // la referencia sigue siendo única aunque cubra varios clientes
        await estado(client.post('/api/v1/pagos').bearerToken(token).json(cuerpo), 409)

        // anular: revierte los dos auxiliares y vuelve a cortar ambos
        await estado(
            client
                .post(`/api/v1/pagos/${pago.id}/anular`)
                .bearerToken(contador)
                .json({ motivo: 'transferencia rechazada' }),
            200,
        )
        assert.equal(await saldoTexto(familiar.clienteId), '300.00')
        assert.equal(await saldoTexto(pagador.clienteId), '300.00')
        assert.equal(await estadoServicio(familiar.servicioId), 'suspendido')
        assert.equal(await estadoServicio(pagador.servicioId), 'suspendido')
        const [anulado] = await eventosDe('pago.anulado', 'pago_id', pago.id)
        assert.sameMembers(anulado.payload.clientes, [pagador.clienteId, familiar.clienteId])
        await afirmarLibroCuadrado(assert)
    })

    test('factura inexistente o no pendiente → 422 por índice; la promesa del dueño se cumple', async ({
        client,
        assert,
    }) => {
        const pagador = await servicioCortado()
        const familiar = await servicioCortado()
        const [septiembreF] = await facturasDe(familiar.servicioId)
        const { token } = await usuarioConRoles(['cajero'])

        const invalido = await estado(
            client
                .post('/api/v1/pagos')
                .bearerToken(token)
                .json({
                    cliente_id: pagador.clienteId,
                    metodo: 'caja',
                    monto: '10.00',
                    facturas: [septiembreF!.id, 999_999_999],
                }),
            422,
        )
        assert.deepEqual(
            invalido.body().errors.map((e: { field: string }) => e.field),
            ['facturas.1'],
        )

        // instante fijo: a dos días del reloj real chocaría con la siguiente facturación el 30 y 31
        const promesa = await new CrearPromesaPago().execute(
            {
                servicio_id: familiar.servicioId,
                vence_en: diasDespues(2),
                monto: '300.00',
                canal: 'operador',
                ahora: AHORA_PROMESAS,
            },
            contextoPrueba(),
        )
        assert.equal(promesa.estado, 'activa')
        const [, octubreF] = await facturasDe(familiar.servicioId)
        const pago = await estado(
            client
                .post('/api/v1/pagos')
                .bearerToken(token)
                .json({
                    cliente_id: pagador.clienteId,
                    metodo: 'caja',
                    monto: '300.00',
                    facturas: [septiembreF!.id, octubreF!.id],
                }),
            201,
        )
        const [evento] = await eventosDe('pago.registrado', 'pago_id', pago.body().id)
        await new ConsumidorBilling().procesar({
            id: evento.id,
            evento: 'pago.registrado',
            payload: evento.payload,
        })
        const cumplida = await db.from('billing.promesas').where('id', promesa.id).firstOrFail()
        assert.equal(cumplida.estado, 'cumplida')
        // el pagador no tenía facturas pedidas más allá de las del familiar
        assert.equal(await saldoTexto(pagador.clienteId), '300.00')
        await afirmarLibroCuadrado(assert)
    })
})
