import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import { generar } from '#tests/billing/ayudas_billing'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import RegistrarPago from '#billing/actions/registrar_pago'
import AnularPago from '#billing/actions/anular_pago'
import AnularFactura from '#billing/actions/anular_factura'
import { prepararEmpresas, saldoCuenta, servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro, verificarLibro } from '#tests/contabilidad/verificar_libro'

/**
 * Auditor contable · nota de crédito con saldo a favor (decisión del líder, lealtad §15.2;
 * `a3/lealtad-2`): lo que la nota pasa del saldo de su factura queda en Anticipos
 * (`notas_credito.a_favor`) y se aplica a las facturas siguientes (`notas_credito_aplicaciones`).
 * `pagado` cuenta la nota solo por lo que aplicó a su factura.
 */

async function facturas(servicioId: number) {
    return (await db
        .from('billing.facturas')
        .where('servicio_id', servicioId)
        .orderBy('id')
        .select('id', 'total', 'pagado', 'estado')) as Array<{
        id: number
        total: string
        pagado: string
        estado: string
    }>
}

async function servicioPagado(
    e: Awaited<ReturnType<typeof prepararEmpresas>>,
    cobrar: (total: string) => string,
) {
    const s = await servicioEn(e.B, { precio: '150.00', instalacion: '2026-10-01' })
    await generar(s.servicioId, '2026-10-01')
    const [octubre] = await facturas(s.servicioId)
    const pago = await new RegistrarPago().execute(
        {
            cliente_id: s.clienteId,
            metodo: 'caja',
            monto: cobrar(octubre!.total),
            facturas: [octubre!.id],
            empresa_id: e.B,
        },
        e.ctx,
    )
    return { ...s, octubre: octubre!, pagoId: pago.id }
}

test.group('Auditor contable · notas de crédito con saldo a favor', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('factura con saldo parcial: la nota aplica el saldo y deja el resto a favor; pagado = solo lo aplicado; la próxima factura lo consume', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await servicioPagado(e, (total) => (Number(total) - 30).toFixed(2))
        const nota = await new EmitirNotaCredito().execute(
            { factura_id: s.octubre.id, monto: '50.00', motivo: 'canje', excedente_a_anticipos: true },
            e.ctx,
        )
        const fila = await db.from('billing.notas_credito').where('id', nota.id).firstOrFail()
        assert.include(fila, { monto: '50.00', a_favor: '20.00' })
        const [octubre] = await facturas(s.servicioId)
        assert.include(octubre!, { pagado: octubre!.total, estado: 'pagada' })
        assert.equal(await saldoCuenta(e.B, '2.1.01', s.clienteId), '-20.00')
        await afirmarLibro(assert, [e.B, e.C])
        await generar(s.servicioId, '2026-11-01')
        const [, noviembre] = await facturas(s.servicioId)
        assert.equal(noviembre!.pagado, '20.00', 'el saldo a favor paga la factura siguiente')
        assert.equal(Number(await saldoCuenta(e.B, '2.1.01', s.clienteId)), 0)
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('anular el pago de la factura acreditada con excedente: el saldo a favor cubre su propia factura y el libro cuadra', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await servicioPagado(e, (total) => total)
        await new EmitirNotaCredito().execute(
            { factura_id: s.octubre.id, monto: '50.00', motivo: 'canje', excedente_a_anticipos: true },
            e.ctx,
        )
        await new AnularPago().execute({ pago_id: s.pagoId, motivo: 'cheque rechazado' }, e.ctx)
        assert.deepEqual(await verificarLibro([e.B, e.C]), [])
    })

    test('anular la factura que recibió el saldo a favor de una nota: la aplicación se deshace y el crédito vuelve a Anticipos', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await servicioPagado(e, (total) => total)
        await new EmitirNotaCredito().execute(
            { factura_id: s.octubre.id, monto: '50.00', motivo: 'canje', excedente_a_anticipos: true },
            e.ctx,
        )
        await generar(s.servicioId, '2026-11-01')
        const [, noviembre] = await facturas(s.servicioId)
        assert.equal(noviembre!.pagado, '50.00')
        const anulada = await new AnularFactura()
            .execute({ factura_id: noviembre!.id, motivo: 'error de facturación' }, e.ctx)
            .then(() => 'anulada')
            .catch((error: { codigo?: string; status?: number }) => `${error.status} ${error.codigo}`)
        if (anulada === 'anulada') {
            // si se permite, el crédito debe volver entero a Anticipos y la factura no queda con aplicaciones vivas
            assert.equal(await saldoCuenta(e.B, '2.1.01', s.clienteId), '-50.00')
            assert.deepEqual(await verificarLibro([e.B, e.C]), [])
        } else {
            assert.match(anulada, /^409 /, `rechazo: ${anulada}`)
            await afirmarLibro(assert, [e.B, e.C])
        }
    })
})
