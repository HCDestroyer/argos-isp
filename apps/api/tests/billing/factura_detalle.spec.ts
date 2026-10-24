import { test } from '@japa/runner'
import { estado, soloEmpresaPrincipal } from '#tests/ayudas'
import { servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import RegistrarPago from '#billing/actions/registrar_pago'
import AnularPago from '#billing/actions/anular_pago'
import { verFactura } from '#billing/facturas'

/**
 * `GET /facturas/:id` (`FacturaDetalle`) trae los pagos aplicados, los asientos de la factura y el
 * tope de diferencia de cobro de la empresa (pedidos de A4, `a4.md:30` y `a4.md:77`).
 */
test.group('Facturación · detalle de factura con pagos, asientos y tope', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('pagos (también anulados), asientos con diario y diferencia_cobro_tope', async ({
        assert,
        client,
    }) => {
        const e = await prepararEmpresasGt()
        const s = await servicioFacturado(e.B, '2026-09-01', { precio: '150.00', instalacion: '2026-09-01' })
        const factura = s.facturas[0]!
        const primero = await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'caja',
                monto: '50.00',
                facturas: [factura.id],
                empresa_id: e.B,
            },
            e.ctx,
        )
        const segundo = await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'caja',
                monto: '30.00',
                facturas: [factura.id],
                empresa_id: e.B,
            },
            e.ctx,
        )
        await new AnularPago().execute({ pago_id: segundo.id, motivo: 'cobrado dos veces' }, e.ctx)

        const detalle = await verFactura(factura.id)
        assert.deepEqual(
            detalle.pagos.map((p) => [p.pago_id, p.monto, p.metodo, p.estado]),
            [
                [primero.id, '50.00', 'caja', 'registrado'],
                [segundo.id, '30.00', 'caja', 'anulado'],
            ],
        )
        assert.lengthOf(detalle.asientos, 1)
        assert.include(detalle.asientos[0]!, {
            origen_tipo: 'factura',
            diario: 'VEN',
            total: factura.total,
            reversa_de: null,
            revertido_por: null,
        })
        assert.equal(detalle.diferencia_cobro_tope, '1.00')

        const http = await estado(
            client
                .get(`/api/v1/facturas/${factura.id}`)
                .bearerToken(e.token)
                .header('X-Empresa-Id', String(e.B)),
            200,
        )
        assert.equal(http.body().empresa_id, e.B)
        assert.lengthOf(http.body().pagos, 2)
        assert.equal(http.body().asientos[0].id, detalle.asientos[0]!.id)
        assert.equal(http.body().diferencia_cobro_tope, '1.00')
        await afirmarLibro(assert, [e.B, e.C])
    })
})
