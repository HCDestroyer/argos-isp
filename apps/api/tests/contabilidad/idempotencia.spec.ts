import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { generar } from '#tests/billing/ayudas_billing'
import { ConsumidorBilling } from '#billing/consumidor'
import { ConsumidorResumenes } from '#billing/reportes/resumenes'
import VencerFacturas from '#billing/actions/vencer_facturas'
import { CABECERA_FIRMA, PasarelaFalsa } from '#billing/pasarelas/falsa'
import { prepararEmpresas, servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro, contarAsientos } from '#tests/contabilidad/verificar_libro'

/**
 * Auditor contable · invariante 11: repetir con la misma `Idempotency-Key`, reprocesar un evento,
 * repetir un webhook o volver a correr un cron nunca duplica asientos.
 */

test.group('Auditor contable · idempotencia (11)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('11. misma Idempotency-Key en cobrar, nota de crédito y anular → un solo asiento', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-09-01' })
        const post = (ruta: string, clave: string, cuerpo: Record<string, unknown>) =>
            client
                .post(`/api/v1${ruta}`)
                .bearerToken(e.token)
                .header('X-Empresa-Id', String(e.B))
                .header('Idempotency-Key', clave)
                .json(cuerpo)

        const inicio = await contarAsientos([e.B])
        const clavePago = unico('pago')
        const cuerpoPago = { cliente_id: s.clienteId, metodo: 'caja', monto: '200.00' }
        const primero = await estado(post('/pagos', clavePago, cuerpoPago), 201)
        const conPago = await contarAsientos([e.B])
        const segundo = await post('/pagos', clavePago, cuerpoPago)
        assert.oneOf(segundo.status(), [200, 201])
        assert.equal(segundo.body().id, primero.body().id)
        assert.equal(segundo.header('idempotent-replayed'), 'true')
        assert.equal(await contarAsientos([e.B]), conPago)
        assert.isAbove(conPago, inicio)
        // misma clave con otro cuerpo: no ejecuta
        const otro = await post('/pagos', clavePago, { ...cuerpoPago, monto: '1.00' })
        assert.equal(otro.status(), 422)
        assert.equal(await contarAsientos([e.B]), conPago)

        const factura = s.facturas[1]!
        const claveNota = unico('nota')
        await estado(
            post(`/facturas/${factura.id}/notas-credito`, claveNota, { monto: '10.00', motivo: 'auditoría' }),
            201,
        )
        const conNota = await contarAsientos([e.B])
        await post(`/facturas/${factura.id}/notas-credito`, claveNota, {
            monto: '10.00',
            motivo: 'auditoría',
        })
        assert.equal(await contarAsientos([e.B]), conNota)

        const claveAnular = unico('anular')
        await estado(post(`/pagos/${primero.body().id}/anular`, claveAnular, { motivo: 'auditoría' }), 200)
        const conAnulacion = await contarAsientos([e.B])
        const repetida = await post(`/pagos/${primero.body().id}/anular`, claveAnular, {
            motivo: 'auditoría',
        })
        assert.equal(repetida.status(), 200)
        assert.equal(await contarAsientos([e.B]), conAnulacion)
        await afirmarLibro(assert, e.B)
    })

    test('11. webhook de pasarela repetido y simultáneo → un solo pago y un solo asiento', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-09-01' })
        const cobro = await estado(
            client
                .post('/api/v1/pasarela/cobros')
                .bearerToken(e.token)
                .header('X-Empresa-Id', String(e.B))
                .header('Idempotency-Key', unico('cobro'))
                .json({ cliente_id: s.clienteId }),
            201,
        )
        const webhook = await new PasarelaFalsa().simularPago(cobro.body().id_proveedor)
        const enviar = () =>
            client
                .post('/api/v1/pasarela/webhook/falsa')
                .header('Content-Type', 'application/json')
                .header(CABECERA_FIRMA, webhook.cabeceras[CABECERA_FIRMA]!)
                .json(JSON.parse(webhook.cuerpo))
        await estado(enviar(), 200)
        const conPago = await contarAsientos([e.B])
        await Promise.all([enviar(), enviar(), enviar()])
        assert.equal(await contarAsientos([e.B]), conPago)
        const pagos = await db.from('billing.pagos').where('referencia', cobro.body().id_proveedor)
        assert.lengthOf(pagos, 1)
        await afirmarLibro(assert, e.B)
    })

    test('11. eventos y crons reprocesados: pago.registrado dos veces, generar y vencer dos veces', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await servicioFacturado(e.B, '2026-10-01', {
            instalacion: '2026-08-01',
            plantilla: { mora_tipo: 'porcentaje', mora_valor: '5.00', mora_recurrente: true },
        })
        await new VencerFacturas().execute({ servicio_id: s.servicioId, hasta: '2026-10-16' }, e.ctx)
        const conMora = await contarAsientos([e.B])
        await new VencerFacturas().execute({ servicio_id: s.servicioId, hasta: '2026-10-16' }, e.ctx)
        await generar(s.servicioId, '2026-10-01')
        assert.equal(await contarAsientos([e.B]), conMora)

        const { default: RegistrarPago } = await import('#billing/actions/registrar_pago')
        const pago = await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '100.00', empresa_id: e.B },
            e.ctx,
        )
        const conPago = await contarAsientos([e.B])
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'pago.registrado')
            .whereRaw(`(payload->>'pago_id')::bigint = ?`, [pago.id])
            .firstOrFail()
        const entrante = { id: evento.id, evento: evento.evento, payload: evento.payload }
        for (const consumidor of [new ConsumidorBilling(), new ConsumidorResumenes()]) {
            await consumidor.procesar(entrante)
            await consumidor.procesar(entrante)
        }
        assert.equal(await contarAsientos([e.B]), conPago)
        await afirmarLibro(assert, e.B)
    })
})
