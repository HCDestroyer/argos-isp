import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { afirmarLibro, verificarLibro } from '#tests/contabilidad/verificar_libro'
import { contextoPrueba, soloEmpresaPrincipal } from '#tests/ayudas'
import {
    lineas,
    prepararEmpresas,
    sacarDeLaColaFel,
    servicioEn,
} from '#tests/contabilidad/ayudas_contabilidad'
import { cola, dtesDe, empresasFel } from '#tests/fiscal/ayudas_fel'
import { periodosHasta } from '#billing/periodos'
import EmitirFactura from '#billing/actions/emitir_factura'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import RegistrarPago from '#billing/actions/registrar_pago'

/**
 * Auditor contable · línea `descuento` de las facturas (`a3/descuento-linea`; contrato de
 * localización fiscal §3.5, lealtad §5): IVA del neto al centavo con varios descuentos, notas de
 * crédito parciales que nunca acreditan más que el neto, mes gratis (descuento del 100 %) y FEL.
 */

const NOVIEMBRE = periodosHasta(
    { ciclo: 'dia_fijo', dia: 1, prorrateo: true },
    '2026-10-01',
    '2026-11-01',
)[1]!

async function facturaCon(
    empresaId: number,
    precio: string,
    descuentos: Array<{ concepto: string; monto: string }>,
    plantilla: Record<string, unknown> = {},
    ctx = contextoPrueba(),
) {
    const s = await servicioEn(empresaId, { precio, instalacion: '2026-10-01', plantilla })
    const r = await new EmitirFactura().execute(
        { servicio_id: s.servicioId, periodo: NOVIEMBRE, descuentos },
        ctx,
    )
    return { ...s, facturaId: r.factura_id! }
}

test.group('Auditor contable · línea de descuento', (group) => {
    group.each.teardown(async () => {
        await sacarDeLaColaFel()
        await soloEmpresaPrincipal()
    })

    test('varios descuentos de centavos sobre precios incómodos: IVA de la factura = IVA del neto redondeado una vez', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        for (const [precio, descuentos] of [
            ['199.99', ['0.01', '0.01', '0.03']],
            ['333.33', ['111.11', '0.07', '0.05']],
            ['99.01', ['33.33', '33.33', '50.00']],
        ] as const) {
            const f = await facturaCon(
                e.B,
                precio,
                descuentos.map((m, i) => ({ concepto: `Puntos ${i}`, monto: m })),
            )
            const factura = await db.from('billing.facturas').where('id', f.facturaId).firstOrFail()
            const neto = Number(factura.total)
            const ivaNeto = Math.round((neto - neto / 1.12) * 100) / 100
            assert.equal(factura.iva, ivaNeto.toFixed(2), `precio ${precio}, neto ${factura.total}`)
            await afirmarLibro(assert, [e.B, e.C])
        }
    })

    test('notas por monto en partes sobre una factura con descuento: nunca más que el neto; 4.1.01 − 5.1.01 y el IVA terminan en cero', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const f = await facturaCon(e.B, '200.00', [{ concepto: 'Puntos', monto: '50.00' }])
        for (const monto of ['0.01', '49.99', '33.33']) {
            await new EmitirNotaCredito().execute(
                { factura_id: f.facturaId, monto, motivo: 'parcial' },
                e.ctx,
            )
            await afirmarLibro(assert, [e.B, e.C])
        }
        await new EmitirNotaCredito().execute(
            { factura_id: f.facturaId, monto: '66.67', motivo: 'el resto' },
            e.ctx,
        )
        const resto = await new EmitirNotaCredito()
            .execute({ factura_id: f.facturaId, monto: '0.01', motivo: 'de más' }, e.ctx)
            .then(() => null)
            .catch((error: { status?: number }) => error.status)
        assert.oneOf(resto, [409, 422], 'no se acredita más que el neto')
        const saldo = await db
            .from('ledger.movimientos as m')
            .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
            .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
            .where('a.empresa_id', e.B)
            .whereIn('c.codigo', ['4.1.01', '5.1.01', '2.1.02', '1.1.03'])
            .groupBy('c.codigo')
            .orderBy('c.codigo')
            .select('c.codigo', db.raw('sum(m.debe - m.haber)::numeric(14,2)::text as saldo'))
        assert.deepEqual(
            saldo.map((s) => [s.codigo, s.saldo]),
            [
                ['1.1.03', '0.00'],
                ['2.1.02', '0.00'],
                ['4.1.01', '-44.64'],
                ['5.1.01', '44.64'],
            ],
        )
        await afirmarLibro(assert, [e.B, e.C])
    })

    for (const certificarAl of ['pagar', 'emitir'] as const) {
        test(`mes gratis (descuento del 100 %) con certificar_al = ${certificarAl}: factura en cero pagada, sin CxC, sin cobro ni DTE de Q0.00`, async ({
            assert,
        }) => {
            // H21: con «emitir», app/billing/emision.ts deja la factura en cero por_certificar y la cola certifica una FACT
            // de Q0.00 (después queda «emitida» con total 0, no «pagada»); con «pagar», el aviso en cero nace pagado y
            // la cola (app/fiscal/fel/cola.ts) también lo certifica por Q0.00. Con H16 el líder decidió que un documento sin
            // venta no se certifica: un mes gratis no es venta (o, si la SAT lo pide, que el contador lo confirme).
            const e = await empresasFel('obligatoria')
            const f = await facturaCon(
                e.B,
                '150.00',
                [{ concepto: 'Mes gratis', monto: '150.00' }],
                { certificar_al: certificarAl },
                e.ctx,
            )
            await cola(e)
            assert.deepEqual(await verificarLibro([e.B, e.C], { incluirHallazgosAbiertos: true }), [])
            const factura = await db.from('billing.facturas').where('id', f.facturaId).firstOrFail()
            const dtes = await dtesDe('factura', f.facturaId)
            assert.lengthOf(
                dtes,
                0,
                `DTE ${dtes[0]?.id} por Q${dtes[0]?.total} (${dtes[0]?.estado}); factura ${factura.estado}`,
            )
            assert.include(factura, { total: '0.00', iva: '0.00', estado: 'pagada' })
            assert.deepEqual(await lineas('factura', f.facturaId), [
                ['5.1.01', '133.93', '0.00'],
                ['4.1.01', '0.00', '133.93'],
            ])
        })
    }

    test('nota por línea en una factura con otro concepto: la línea con descuento solo admite su neto aunque la factura dé para más', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await servicioEn(e.B, { precio: '200.00', instalacion: '2026-10-01' })
        await db
            .table('billing.conceptos_recurrentes')
            .insert({ servicio_id: s.servicioId, nombre: 'Router', monto: '100.00' })
        const r = await new EmitirFactura().execute(
            {
                servicio_id: s.servicioId,
                periodo: NOVIEMBRE,
                descuentos: [{ concepto: 'Puntos', monto: '50.00' }],
            },
            contextoPrueba(),
        )
        const plan = await db
            .from('billing.facturas_lineas')
            .where({ factura_id: r.factura_id!, tipo: 'servicio' })
            .firstOrFail()
        const factura = await db.from('billing.facturas').where('id', r.factura_id!).firstOrFail()
        assert.equal(factura.total, '250.00')
        const deMas = await new EmitirNotaCredito()
            .execute(
                {
                    factura_id: r.factura_id!,
                    lineas: [{ linea_id: Number(plan.id), monto: '180.00' }],
                    motivo: 'de más',
                },
                e.ctx,
            )
            .then(() => null)
            .catch((error: { status?: number }) => error.status)
        assert.equal(deMas, 422, 'la línea del plan vale 150.00 neta')
        await new EmitirNotaCredito().execute(
            {
                factura_id: r.factura_id!,
                lineas: [{ linea_id: Number(plan.id), monto: '150.00' }],
                motivo: 'toda la línea',
            },
            e.ctx,
        )
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('pago parcial y anticipo sobre facturas con descuento: se cobra el neto y el resto queda a favor', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const f = await facturaCon(e.B, '275.50', [{ concepto: 'Puntos', monto: '75.50' }])
        await new RegistrarPago().execute(
            { cliente_id: f.clienteId, metodo: 'caja', monto: '250.00', empresa_id: e.B },
            e.ctx,
        )
        const factura = await db.from('billing.facturas').where('id', f.facturaId).firstOrFail()
        assert.include(factura, { total: '200.00', pagado: '200.00', estado: 'pagada' })
        assert.deepEqual(await verificarLibro([e.B, e.C]), [])
    })
})
