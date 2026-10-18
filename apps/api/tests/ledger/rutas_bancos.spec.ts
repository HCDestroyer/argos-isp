import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { CABECERA_FIRMA, PasarelaFalsa } from '#billing/pasarelas/falsa'
import { hoyGuatemala } from '#ledger/fechas'
import { saldoCuenta, servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { afirmarLibroFase4 } from '#tests/ledger/verificar_bancos'

/**
 * Fase 4 por HTTP: permisos exactos, Idempotency-Key y el webhook de pasarela con proveedor de
 * cobro configurado (un solo pago a 1.1.10.NN aunque llegue repetido).
 */

test.group('Fase 4 · rutas de cobros y bancos', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('webhook repetido con proveedor: un pago a 1.1.10.NN; la liquidación con Idempotency-Key se registra una vez', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const s = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-09-01' })
        const proveedor = await estado(
            client
                .post('/api/v1/cobros/proveedores')
                .bearerToken(e.token)
                .header('X-Empresa-Id', String(e.B))
                .header('Idempotency-Key', unico('prov'))
                .json({
                    metodo: 'pasarela',
                    pasarela: 'falsa',
                    nombre: 'Falsa',
                    cuenta_bancaria_id: e.banco.get(e.B)!.id,
                }),
            201,
        )
        const cuentaPuente = proveedor.body().cuenta_codigo as string
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
        await Promise.all([enviar(), enviar(), enviar()])
        const pagos = await db.from('billing.pagos').where('referencia', cobro.body().id_proveedor)
        assert.lengthOf(pagos, 1)
        assert.equal(pagos[0].proveedor_cobro_id, proveedor.body().id)
        assert.equal(await saldoCuenta(e.B, cuentaPuente), pagos[0].monto)

        const clave = unico('liq')
        const liquidar = () =>
            client
                .post('/api/v1/cobros/liquidaciones')
                .bearerToken(e.token)
                .header('X-Empresa-Id', String(e.B))
                .header('Idempotency-Key', clave)
                .json({
                    proveedor_cobro_id: proveedor.body().id,
                    referencia: 'LIQ-HTTP',
                    bruto: pagos[0].monto,
                    comision: '1.00',
                    pagos: [pagos[0].id],
                })
        const primera = await estado(liquidar(), 201)
        const segunda = await estado(liquidar(), 201)
        assert.equal(segunda.body().id, primera.body().id)
        const resumen = await estado(
            client
                .get('/api/v1/cobros/por-liquidar')
                .bearerToken(e.token)
                .header('X-Empresa-Id', String(e.B)),
            200,
        )
        assert.isTrue(resumen.body()[0].cuadra)
        await afirmarLibroFase4(assert, [e.B, e.C])
    })

    test('permisos: el cajero deposita su caja pero no liquida, no concilia ni castiga', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const { token } = await usuarioConRoles(['cajero'])
        const cajaId = e.cajas.get(e.B)!
        const deposito = await estado(
            client
                .post(`/api/v1/cajas/${cajaId}/depositar`)
                .bearerToken(token)
                .header('X-Empresa-Id', String(e.B))
                .header('Idempotency-Key', unico('dep'))
                .json({ monto: '50.00', boleta: 'B-HTTP', cuenta_bancaria_id: e.banco.get(e.B)!.id }),
            201,
        )
        assert.equal(deposito.body().estado, 'en_transito')
        for (const [ruta, cuerpo] of [
            [
                '/api/v1/cobros/liquidaciones',
                { proveedor_cobro_id: 1, referencia: 'x', bruto: '1', comision: '0', pagos: [1] },
            ],
            ['/api/v1/bancos/conciliaciones', { linea_id: 1, movimientos: [1] }],
            ['/api/v1/cartera/castigos', { facturas: [1], motivo: 'x', evidencia: 'y' }],
            [
                '/api/v1/bancos/extractos',
                {
                    cuenta_id: 1,
                    desde: hoyGuatemala(),
                    hasta: hoyGuatemala(),
                    saldo_inicial: '0',
                    saldo_final: '1',
                    lineas: [{ fecha: hoyGuatemala(), descripcion: 'x', monto: '1' }],
                },
            ],
        ] as const) {
            await estado(
                client
                    .post(ruta)
                    .bearerToken(token)
                    .header('X-Empresa-Id', String(e.B))
                    .header('Idempotency-Key', unico('k'))
                    .json(cuerpo),
                403,
            )
        }
        await afirmarLibroFase4(assert, [e.B])
    })
})
