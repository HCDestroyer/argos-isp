import { test } from '@japa/runner'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import { crearClienteFila } from '#tests/core/fabricas'
import RegistrarPago from '#billing/actions/registrar_pago'
import AnularFactura from '#billing/actions/anular_factura'
import { controlFelFalso } from '#fiscal/fel/falso'
import { errorDe, sacarDeLaColaFel } from '#tests/contabilidad/ayudas_contabilidad'
import { verificarLibro } from '#tests/contabilidad/verificar_libro'
import { cola, datosNit, dtesDe, empresasFel, factura, servicioFel } from '#tests/fiscal/ayudas_fel'

/**
 * Auditor contable · decisión del líder sobre H6: mientras el DTE de una factura está en
 * `anulacion_pendiente`, la factura no recibe pagos ni aplicaciones; si el certificador rechaza la
 * anulación (el DTE vuelve a `certificado`), `fel.anular_dte` aplica en el acto los anticipos del
 * cliente a esa deuda. Invariantes: `12.aplicacion_durante_anulacion_pendiente` (abierto, H6),
 * `12.anulacion_rechazada_con_anticipo_sin_aplicar` y `3.anticipo_sin_aplicar_con_deuda` (que deja
 * fuera solo la deuda con la anulación pendiente).
 */

test.group('Auditor contable · factura con la anulación del DTE pendiente', (group) => {
    group.each.teardown(async () => {
        await sacarDeLaColaFel()
        await soloEmpresaPrincipal()
    })

    test('H6 · sin pagos durante la anulación pendiente; al rechazarse la anulación el anticipo se aplica en el acto', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const s = await servicioFel(e, 'emitir', '150.00', await crearClienteFila(datosNit()))
        const f = s.facturas[0]!
        await cola(e)
        await new AnularFactura().execute({ factura_id: f.id, motivo: 'error de plan' }, e.ctx)
        assert.equal(await dtesDe('factura', f.id).then((r) => r[0]!.estado), 'anulacion_pendiente')

        // pedirla en el pago: 422; sin pedirla, el pago queda como anticipo
        const pedida = await errorDe(
            new RegistrarPago().execute(
                {
                    cliente_id: s.clienteId,
                    metodo: 'caja',
                    monto: '150.00',
                    facturas: [f.id],
                    empresa_id: e.B,
                },
                e.ctx,
            ),
        )
        assert.equal(pedida.status, 422)
        await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '150.00', empresa_id: e.B },
            e.ctx,
        )
        const pendiente = await factura(f.id)
        assert.equal(pendiente.pagado, '0.00')
        assert.deepEqual(await verificarLibro(e.B, { incluirHallazgosAbiertos: true }), [])

        // el certificador rechaza la anulación: el DTE vuelve a certificado y el anticipo se aplica ya
        controlFelFalso.siguiente.push('rechazado')
        await cola(e)
        assert.equal(await dtesDe('factura', f.id).then((r) => r[0]!.estado), 'certificado')
        const cobrada = await factura(f.id)
        assert.equal(cobrada.estado, 'pagada')
        assert.deepEqual(await verificarLibro(e.B, { incluirHallazgosAbiertos: true }), [])
    }).fails('H6: la factura con la anulación pendiente recibe el pago')
})
