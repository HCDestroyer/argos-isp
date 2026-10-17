import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado, saldoTexto } from '#tests/ledger/ayudas_libro'
import {
    estadoServicio,
    eventosDe,
    facturasDe,
    lineasAsiento,
    servicioCortado,
} from '#tests/billing/ayudas_billing'
import { CABECERA_FIRMA, PasarelaFalsa, firmar } from '#billing/pasarelas/falsa'
import { hoyGuatemala } from '#ledger/fechas'
import { crearClienteFila } from '#tests/core/fabricas'
import env from '#start/env'
import { resolverUrlRetorno } from '#billing/pasarelas/pasarela'
import type { ValidacionFallida } from '#shared/errores'

/**
 * Pasarela en línea con el adaptador falso: cobro, webhook firmado (HMAC, ventana, idempotente),
 * pago con comisión que reactiva, y conciliación diaria con diferencias.
 */

const falsa = new PasarelaFalsa()

test.group('billing · pasarela en línea', () => {
    test('cobro → webhook firmado → pago pasarela con comisión que reactiva; repetido no duplica', async ({
        client,
        assert,
    }) => {
        const datos = await servicioCortado()
        assert.equal(await estadoServicio(datos.servicioId), 'suspendido')
        const { token } = await usuarioConRoles(['cajero'])

        const cobro = await estado(
            client
                .post('/api/v1/pasarela/cobros')
                .bearerToken(token)
                .header('Idempotency-Key', `cobro-${datos.clienteId}`)
                .json({ cliente_id: datos.clienteId }),
            201,
        )
        assert.equal(cobro.body().monto, '300.00')
        assert.equal(cobro.body().estado, 'pendiente')
        assert.equal(cobro.body().proveedor, 'falsa')
        assert.match(cobro.body().url_pago, /\/api\/v1\/pasarela\/falsa\/falsa_[0-9a-f]+$/)

        const webhook = await falsa.simularPago(cobro.body().id_proveedor)
        const enviar = () =>
            client
                .post('/api/v1/pasarela/webhook/falsa')
                .header('Content-Type', 'application/json')
                .header(CABECERA_FIRMA, webhook.cabeceras[CABECERA_FIRMA]!)
                .json(JSON.parse(webhook.cuerpo))
        const respuesta = await estado(enviar(), 200)
        assert.isFalse(respuesta.body().duplicado)
        const pagoId = respuesta.body().pago_id as number
        assert.isNumber(pagoId)

        // reactivado en la misma transacción del pago
        assert.equal(await estadoServicio(datos.servicioId), 'activo')
        assert.equal(await saldoTexto(datos.clienteId), '0.00')
        // asiento: Bancos (neto) + Comisiones de pasarelas / CxC
        assert.deepEqual(await lineasAsiento('pago', pagoId), [
            ['1.1.02.01', '289.50', '0.00', null],
            ['5.1.02', '10.50', '0.00', null],
            ['1.1.03', '0.00', '300.00', datos.clienteId],
        ])
        const pago = await db.from('billing.pagos').where('id', pagoId).firstOrFail()
        assert.include(pago, {
            metodo: 'pasarela',
            pasarela: 'falsa',
            comision: '10.50',
            referencia: cobro.body().id_proveedor,
        })
        assert.lengthOf(await eventosDe('pago.registrado', 'pago_id', pagoId), 1)

        const visto = await estado(
            client.get(`/api/v1/pasarela/cobros/${cobro.body().id}`).bearerToken(token),
            200,
        )
        assert.include(visto.body(), {
            estado: 'pagado',
            pago_id: pagoId,
            comision: '10.50',
            monto_pagado: '300.00',
        })

        // el proveedor reintenta: mismo resultado, un solo pago
        const otra = await estado(enviar(), 200)
        assert.isTrue(otra.body().duplicado)
        assert.equal(otra.body().pago_id, pagoId)
        // dos a la vez
        const [a, b] = await Promise.all([enviar(), enviar()])
        assert.equal(a.status(), 200)
        assert.equal(b.status(), 200)
        const pagos = await db.from('billing.pagos').where('referencia', cobro.body().id_proveedor)
        assert.lengthOf(pagos, 1)
        await afirmarLibroCuadrado(assert)
    })

    test('firma inválida, fuera de ventana o proveedor desconocido → 401 sin pago', async ({
        client,
        assert,
    }) => {
        const datos = await servicioCortado()
        const { token } = await usuarioConRoles(['cajero'])
        const [septiembre] = await facturasDe(datos.servicioId)
        const cobro = await estado(
            client
                .post('/api/v1/pasarela/cobros')
                .bearerToken(token)
                .json({ cliente_id: datos.clienteId, facturas: [septiembre!.id] }),
            201,
        )
        assert.equal(cobro.body().monto, '150.00')
        assert.deepEqual(cobro.body().facturas, [septiembre!.id])

        const webhook = await falsa.simularPago(cobro.body().id_proveedor)
        const alterada = await client
            .post('/api/v1/pasarela/webhook/falsa')
            .header('Content-Type', 'application/json')
            .header(CABECERA_FIRMA, webhook.cabeceras[CABECERA_FIRMA]!)
            .json(JSON.parse(webhook.cuerpo.replace('"150.00"', '"1500.00"')))
        alterada.assertStatus(401)
        assert.equal(alterada.body().type, 'urn:argosisp:problema:firma_invalida')

        const vieja = Math.floor(Date.now() / 1000) - 600
        const fueraDeVentana = await client
            .post('/api/v1/pasarela/webhook/falsa')
            .header('Content-Type', 'application/json')
            .header(CABECERA_FIRMA, firmar(webhook.cuerpo, vieja))
            .json(JSON.parse(webhook.cuerpo))
        fueraDeVentana.assertStatus(401)
        assert.match(fueraDeVentana.body().detail, /ventana/)

        const sinFirma = await client
            .post('/api/v1/pasarela/webhook/falsa')
            .header('Content-Type', 'application/json')
            .json(JSON.parse(webhook.cuerpo))
        sinFirma.assertStatus(401)

        const otroProveedor = await client
            .post('/api/v1/pasarela/webhook/otra')
            .header('Content-Type', 'application/json')
            .header(CABECERA_FIRMA, webhook.cabeceras[CABECERA_FIRMA]!)
            .json(JSON.parse(webhook.cuerpo))
        otroProveedor.assertStatus(401)

        assert.lengthOf(await db.from('billing.pagos').where('referencia', cobro.body().id_proveedor), 0)
        assert.equal(await estadoServicio(datos.servicioId), 'suspendido')

        // sin deuda → 422 sin_deuda
        const alDia = await crearClienteFila()
        const sinDeuda = await client
            .post('/api/v1/pasarela/cobros')
            .bearerToken(token)
            .json({ cliente_id: alDia })
        sinDeuda.assertStatus(422)
        assert.equal(sinDeuda.body().type, 'urn:argosisp:problema:sin_deuda')
    })

    test('laboratorio: página y pago simulado; conciliación diaria detecta el webhook perdido', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['contabilidad'])
        const { token: cajero } = await usuarioConRoles(['cajero'])
        const pagado = await servicioCortado()
        const perdido = await servicioCortado()
        const crear = (clienteId: number) =>
            estado(
                client.post('/api/v1/pasarela/cobros').bearerToken(cajero).json({ cliente_id: clienteId }),
                201,
            )
        const respuestaPagado = await crear(pagado.clienteId)
        const cobroPagado = respuestaPagado.body()
        const respuestaPerdido = await crear(perdido.clienteId)
        const cobroPerdido = respuestaPerdido.body()

        const pagina = await client.get(`/api/v1/pasarela/falsa/${cobroPagado.id_proveedor}`)
        pagina.assertStatus(200)
        assert.match(pagina.header('content-type') ?? '', /text\/html/)
        assert.include(pagina.text(), 'Pagar (simulado)')
        assert.include(pagina.text(), `${cobroPagado.id_proveedor}/formulario`)

        const simulado = await estado(
            client.post(`/api/v1/pasarela/falsa/${cobroPagado.id_proveedor}/pagar`).json({}),
            200,
        )
        assert.isNumber(simulado.body().pago_id)
        assert.equal(await estadoServicio(pagado.servicioId), 'activo')

        // el cliente pagó pero el webhook no llegó
        await estado(
            client
                .post(`/api/v1/pasarela/falsa/${cobroPerdido.id_proveedor}/pagar`)
                .json({ notificar: false }),
            200,
        )
        assert.equal(await estadoServicio(perdido.servicioId), 'suspendido')

        const conciliacion = await estado(
            client.post('/api/v1/pasarela/conciliar').bearerToken(token).json({ fecha: hoyGuatemala() }),
            200,
        )
        const resultado = conciliacion.body()
        assert.include(resultado.cobros_conciliados, cobroPagado.id)
        const diferencia = resultado.diferencias.find(
            (d: { cobro_id: number }) => d.cobro_id === cobroPerdido.id,
        )
        assert.include(diferencia, { tipo: 'pago_sin_registrar', proveedor: '300.00', pago_id: null })
        assert.isUndefined(
            resultado.diferencias.find((d: { cobro_id: number }) => d.cobro_id === cobroPagado.id),
        )

        const visto = await db.from('billing.pasarela_cobros').where('id', cobroPagado.id).firstOrFail()
        assert.isNotNull(visto.conciliado_en)
        const lista = await estado(client.get('/api/v1/pasarela/conciliaciones').bearerToken(token), 200)
        assert.equal(lista.body().data[0].id, resultado.id)
        await afirmarLibroCuadrado(assert)
    })

    test('url_retorno: solo orígenes permitidos, {cobro_id} resuelto y 303 de la página falsa con el estado', async ({
        client,
        assert,
    }) => {
        const previo = env.get('PASARELA_RETORNO_ORIGENES')
        env.set('PASARELA_RETORNO_ORIGENES', 'http://portal.prueba.local, https://otro.prueba.local:8443')
        try {
            // reglas de la URL
            assert.equal(
                resolverUrlRetorno('http://portal.prueba.local/corte?pago={cobro_id}', 7),
                'http://portal.prueba.local/corte?pago=7',
            )
            assert.equal(
                resolverUrlRetorno('https://otro.prueba.local:8443/x', 1),
                'https://otro.prueba.local:8443/x',
            )
            const reglas = (url: string) => {
                try {
                    resolverUrlRetorno(url, 1)
                } catch (error) {
                    return (error as ValidacionFallida).errores?.map((e) => `${e.field}:${e.rule}`)
                }
                return []
            }
            assert.deepEqual(reglas('https://malo.example/corte'), ['url_retorno:origen_no_permitido'])
            assert.deepEqual(reglas('https://portal.prueba.local/corte'), ['url_retorno:origen_no_permitido'])
            assert.deepEqual(reglas('javascript:alert(1)'), ['url_retorno:url'])
            assert.deepEqual(reglas('http://yo:clave@portal.prueba.local/'), ['url_retorno:url'])
            assert.deepEqual(reglas('/corte'), ['url_retorno:url'])

            const datos = await servicioCortado()
            const { token } = await usuarioConRoles(['cajero'])
            const antes = await db
                .from('billing.pasarela_cobros')
                .where('cliente_id', datos.clienteId)
                .count('* as n')
            const rechazado = await estado(
                client.post('/api/v1/pasarela/cobros').bearerToken(token).json({
                    cliente_id: datos.clienteId,
                    url_retorno: 'https://phishing.example/{cobro_id}',
                }),
                422,
            )
            assert.equal(rechazado.body().errors[0].field, 'url_retorno')
            const despues = await db
                .from('billing.pasarela_cobros')
                .where('cliente_id', datos.clienteId)
                .count('* as n')
            assert.deepEqual(despues, antes)

            const crear = async (facturas: number[]) => {
                const respuesta = await estado(
                    client.post('/api/v1/pasarela/cobros').bearerToken(token).json({
                        cliente_id: datos.clienteId,
                        facturas,
                        url_retorno: 'http://portal.prueba.local/corte?pago={cobro_id}',
                    }),
                    201,
                )
                return respuesta.body() as { id: number; id_proveedor: string; url_retorno: string }
            }
            const [septiembre, octubre] = await facturasDe(datos.servicioId)
            const pagado = await crear([septiembre!.id])
            assert.equal(pagado.url_retorno, `http://portal.prueba.local/corte?pago=${pagado.id}`)

            // el navegador manda el formulario de la página: 303 al retorno con el estado del cobro
            const pagar = await client
                .post(`/api/v1/pasarela/falsa/${pagado.id_proveedor}/formulario`)
                .form({ estado: 'pagado' })
                .redirects(0)
            pagar.assertStatus(303)
            assert.equal(
                pagar.header('location'),
                `http://portal.prueba.local/corte?pago=${pagado.id}&estado=pagado`,
            )
            const cobro = await db.from('billing.pasarela_cobros').where('id', pagado.id).firstOrFail()
            assert.equal(cobro.estado, 'pagado')
            assert.isNotNull(cobro.pago_id)

            const fallido = await crear([octubre!.id])
            const rechazar = await client
                .post(`/api/v1/pasarela/falsa/${fallido.id_proveedor}/formulario`)
                .form({ estado: 'fallido' })
                .redirects(0)
            rechazar.assertStatus(303)
            assert.equal(
                rechazar.header('location'),
                `http://portal.prueba.local/corte?pago=${fallido.id}&estado=fallido`,
            )

            // sin url_retorno, el formulario vuelve a la página de la pasarela
            const otro = await servicioCortado()
            const sinRetorno = await estado(
                client
                    .post('/api/v1/pasarela/cobros')
                    .bearerToken(token)
                    .json({ cliente_id: otro.clienteId }),
                201,
            )
            assert.isNull(sinRetorno.body().url_retorno)
            const volver = await client
                .post(`/api/v1/pasarela/falsa/${sinRetorno.body().id_proveedor}/formulario`)
                .form({ estado: 'pagado' })
                .redirects(0)
            volver.assertStatus(303)
            assert.equal(
                volver.header('location'),
                `/api/v1/pasarela/falsa/${sinRetorno.body().id_proveedor}`,
            )
            assert.equal(await estadoServicio(otro.servicioId), 'activo')
            await afirmarLibroCuadrado(assert)
        } finally {
            env.set('PASARELA_RETORNO_ORIGENES', previo ?? '')
        }
    })
})
