import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { CUENTAS } from '#ledger/plan_cuentas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import RegistrarPago from '#billing/actions/registrar_pago'
import AnularPago from '#billing/actions/anular_pago'
import CerrarCaja from '#ledger/actions/cerrar_caja'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import AnularCompra from '#ledger/actions/anular_compra'
import RegistrarConstanciaEmitida from '#ledger/actions/registrar_constancia_emitida'
import {
    codigoCaja,
    errorDe,
    facturasDelServicio,
    saldoCuenta,
    servicioEn,
    servicioFacturado,
} from '#tests/contabilidad/ayudas_contabilidad'
import { generar } from '#tests/billing/ayudas_billing'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { hacerAgenteRetencion, haceMeses, partidas, proveedorEn } from '#tests/ledger/ayudas_compras'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'

/**
 * Fase 5 (§3.4, §3.5): constancias de retención recibidas de clientes (en el pago) y emitidas a
 * proveedores (con la compra).
 */

test.group('Fase 5 · retenciones y constancias', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('pago con constancia de IVA: caja por lo que entra, 1.1.05 por la constancia, CxC por el total; el turno cuadra', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const s = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-10-01' })
        const [factura] = s.facturas
        const cajaId = e.cajas.get(e.B)!
        const pago = await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'caja',
                monto: '147.59',
                caja_id: cajaId,
                empresa_id: e.B,
                retenciones: [{ codigo: 'RET_IVA_ESP', numero: 'ct-1001', monto: '2.41' }],
            },
            e.ctx,
        )
        assert.equal(pago.monto, '150.00')
        assert.equal(pago.retenido, '2.41')
        assert.deepEqual(
            pago.constancias.map((c) => [c.impuesto, c.impuesto_codigo, c.numero, c.monto]),
            [['iva', 'RET_IVA_ESP', 'CT-1001', '2.41']],
        )
        assert.deepEqual(await partidas('pago', pago.id), [
            [await codigoCaja(cajaId), '147.59', '0.00', null],
            [CUENTAS_GT.IVA_RETENIDO_CLIENTES, '2.41', '0.00', '+RET_IVA_REC'],
            [CUENTAS.CXC_CLIENTES, '0.00', '150.00', null],
        ])
        const [despues] = await facturasDelServicio(s.servicioId)
        assert.equal(despues!.id, factura!.id)
        assert.equal(despues!.estado, 'pagada')

        // la misma constancia en otro pago vigente: 409; anulado el pago, el número queda libre
        const s2 = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-10-01' })
        const repetida = await errorDe(
            new RegistrarPago().execute(
                {
                    cliente_id: s2.clienteId,
                    metodo: 'caja',
                    monto: '147.59',
                    caja_id: cajaId,
                    empresa_id: e.B,
                    retenciones: [{ codigo: 'RET_IVA_ESP', numero: 'CT-1001', monto: '2.41' }],
                },
                e.ctx,
            ),
        )
        assert.equal(repetida.codigo, 'constancia_duplicada')
        await new AnularPago().execute(
            { pago_id: pago.id, motivo: 'constancia del cliente equivocado' },
            e.ctx,
        )
        const libre = await new RegistrarPago().execute(
            {
                cliente_id: s2.clienteId,
                metodo: 'caja',
                monto: '139.50',
                caja_id: cajaId,
                empresa_id: e.B,
                retenciones: [
                    { codigo: 'RET_IVA_ESP', numero: 'CT-1001', monto: '2.41' },
                    { codigo: 'RET_ISR_OPC', numero: 'ISR-77', monto: '8.09' },
                ],
            },
            e.ctx,
        )
        assert.equal(libre.retenido, '10.50')
        assert.equal(await saldoCuenta(e.B, CUENTAS_GT.IVA_RETENIDO_CLIENTES), '2.41')
        assert.equal(await saldoCuenta(e.B, CUENTAS_GT.ISR_RETENIDO_CLIENTES), '8.09')

        // el esperado del turno es lo que entró en efectivo (sin constancias)
        const turno = await new CerrarCaja().execute({ caja_id: cajaId, contado: '239.50' }, e.ctx)
        assert.equal(turno.esperado, '239.50')
        assert.equal(turno.diferencia, '0.00')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('constancias recibidas: solo retenciones de venta, una empresa por pago, combustibles con tarjeta', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const s = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-10-01' })
        const emitida = await errorDe(
            new RegistrarPago().execute(
                {
                    cliente_id: s.clienteId,
                    metodo: 'caja',
                    monto: '140.00',
                    caja_id: e.cajas.get(e.B)!,
                    empresa_id: e.B,
                    retenciones: [{ codigo: 'RET_IVA_ESP_C', numero: '1', monto: '2.41' }],
                },
                e.ctx,
            ),
        )
        assert.include(emitida.reglas, 'retencion')
        const tarjeta = await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'deposito',
                monto: '149.76',
                referencia: unico('B'),
                cuenta_bancaria_id: e.cuentas.get(e.B)!,
                retenciones: [{ codigo: 'RET_IVA_TAR_COMB', numero: 'T-9', monto: '0.24' }],
            },
            e.ctx,
        )
        assert.deepEqual(await partidas('pago', tarjeta.id), [
            [e.banco.get(e.B)!.codigo, '149.76', '0.00', null],
            [CUENTAS_GT.IVA_RETENIDO_CLIENTES, '0.24', '0.00', '+RET_IVA_REC'],
            [CUENTAS.CXC_CLIENTES, '0.00', '150.00', null],
        ])

        // un cobro en efectivo que reparte entre dos empresas no lleva constancias
        const enB = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-10-01' })
        const enC = await servicioEn(e.C, { clienteId: enB.clienteId, instalacion: '2026-10-01' })
        await generar(enC.servicioId, '2026-10-01')
        const repartido = await errorDe(
            new RegistrarPago().execute(
                {
                    cliente_id: enB.clienteId,
                    metodo: 'caja',
                    monto: '290.00',
                    retenciones: [{ codigo: 'RET_IVA_ESP', numero: 'R-1', monto: '10.00' }],
                },
                e.ctx,
            ),
        )
        assert.equal(repartido.codigo, 'retencion_en_cobro_repartido')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('constancia emitida al proveedor: una por retención, número único, bloquea anular la compra', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await hacerAgenteRetencion(e.B, e.ctx)
        const proveedor = await proveedorEn(e.B, e.ctx)
        const nueva = (numero: string) =>
            new RegistrarCompra().execute(
                {
                    proveedor_id: proveedor.id,
                    tipo_documento: 'FACT',
                    numero,
                    fecha_documento: haceMeses(0),
                    condicion: 'credito',
                    lineas: [{ descripcion: 'Torre', total: '5600.00' }],
                },
                e.ctx,
            )
        const compra = await nueva(unico('F'))
        assert.deepEqual(
            compra.retenciones.map((r) => [r.impuesto_codigo, r.monto]),
            [['RET_IVA_ESP_C', '90.00']],
        )
        const constancia = await new RegistrarConstanciaEmitida().execute(
            { compra_id: compra.id, impuesto_codigo: 'RET_IVA_ESP_C', numero: '2026-000123' },
            e.ctx,
        )
        assert.equal(constancia.monto, '90.00')
        assert.equal(constancia.direccion, 'emitida')
        assert.equal(constancia.proveedor_id, proveedor.id)
        const otraVez = await errorDe(
            new RegistrarConstanciaEmitida().execute(
                { compra_id: compra.id, impuesto_codigo: 'RET_IVA_ESP_C', numero: '2026-000124' },
                e.ctx,
            ),
        )
        assert.equal(otraVez.codigo, 'constancia_registrada')
        const otra = await nueva(unico('F'))
        const mismoNumero = await errorDe(
            new RegistrarConstanciaEmitida().execute(
                { compra_id: otra.id, impuesto_codigo: 'RET_IVA_ESP_C', numero: '2026-000123' },
                e.ctx,
            ),
        )
        assert.equal(mismoNumero.codigo, 'constancia_duplicada')
        const sinRetencion = await errorDe(
            new RegistrarConstanciaEmitida().execute(
                { compra_id: otra.id, impuesto_codigo: 'RET_ISR_OPC_C', numero: 'X' },
                e.ctx,
            ),
        )
        assert.include(sinRetencion.reglas, 'exists')
        const anular = await errorDe(
            new AnularCompra().execute({ compra_id: compra.id, motivo: 'error' }, e.ctx),
        )
        assert.equal(anular.codigo, 'compra_con_constancia')
        // el libro no se movió con la constancia: 2.1.04 = Σ retenciones de las compras
        assert.equal(await saldoCuenta(e.B, CUENTAS_GT.RETENCIONES_IVA_POR_PAGAR), '-180.00')

        const lista = await estado(
            client
                .get('/api/v1/constancias')
                .bearerToken(e.token)
                .headers({ 'X-Empresa-Id': String(e.B) })
                .qs({ direccion: 'emitida' }),
            200,
        )
        assert.deepEqual(
            lista.body().data.map((c: { numero: string }) => c.numero),
            ['2026-000123'],
        )
        const ruta = await estado(
            client
                .post(`/api/v1/compras/${otra.id}/constancias`)
                .bearerToken(e.token)
                .headers({ 'X-Empresa-Id': String(e.B) })
                .json({ impuesto_codigo: 'RET_IVA_ESP_C', numero: '2026-000125' }),
            201,
        )
        assert.equal(ruta.body().compra_id, otra.id)
        const filas = await db.from('ledger.constancias_retencion').where('compra_id', otra.id)
        assert.lengthOf(filas, 1)
        await afirmarLibro(assert, [e.B, e.C])
    })
})
