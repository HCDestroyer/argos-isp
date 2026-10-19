import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
import { contextoPrueba, soloEmpresaPrincipal } from '#tests/ayudas'
import {
    errorDe,
    lineas,
    prepararEmpresas,
    saldoCuenta,
    servicioEn,
} from '#tests/contabilidad/ayudas_contabilidad'
import { cola, dtesDe, empresasFel } from '#tests/fiscal/ayudas_fel'
import { periodosHasta } from '#billing/periodos'
import EmitirFactura from '#billing/actions/emitir_factura'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import RegistrarPago from '#billing/actions/registrar_pago'
import { verDte, dteParaEnviar } from '#fiscal/fel/dte'
import { xmlDte } from '#fiscal/fel/xml_gt'
import SolicitarCertificacion from '#fiscal/actions/solicitar_certificacion'

/**
 * Línea `descuento` de las facturas (contrato de localización fiscal §3.5; lealtad §5): una línea
 * negativa ligada a la línea del plan, IVA del neto, `5.1.01 Descuentos` al debe del asiento,
 * `Descuento` del ítem en el DTE, y notas de crédito que acreditan el neto.
 */

const NOVIEMBRE = periodosHasta(
    { ciclo: 'dia_fijo', dia: 1, prorrateo: true },
    '2026-10-01',
    '2026-11-01',
)[1]!

async function lineasDe(facturaId: number) {
    return db
        .from('billing.facturas_lineas')
        .where('factura_id', facturaId)
        .orderBy('id')
        .select('id', 'tipo', 'total', 'iva', 'linea_id', 'descuento')
}

async function facturaCon(empresaId: number, descuentos: Array<{ concepto: string; monto: string }>) {
    const s = await servicioEn(empresaId, { precio: '200.00', instalacion: '2026-10-01' })
    const r = await new EmitirFactura().execute(
        { servicio_id: s.servicioId, periodo: NOVIEMBRE, descuentos },
        contextoPrueba(),
    )
    return { ...s, facturaId: r.factura_id! }
}

test.group('Facturas · línea de descuento', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('ejemplo del contrato: Q200 − Q50, IVA del neto y CxC 150 + 5.1.01 44.64 / 4.1.01 178.57 + 2.1.02 16.07', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const f = await facturaCon(e.B, [{ concepto: 'Descuento por puntos (canje 381)', monto: '50.00' }])
        const filas = await lineasDe(f.facturaId)
        assert.deepEqual(
            filas.map((l) => [l.tipo, l.total, l.iva, l.descuento]),
            [
                ['servicio', '200.00', '21.43', '50.00'],
                ['descuento', '-50.00', '-5.36', '0.00'],
            ],
        )
        assert.equal(Number(filas[1]!.linea_id), Number(filas[0]!.id))
        const factura = await db.from('billing.facturas').where('id', f.facturaId).firstOrFail()
        assert.include(factura, { total: '150.00', iva: '16.07', subtotal: '133.93' })
        assert.deepEqual(await lineas('factura', f.facturaId), [
            ['1.1.03', '150.00', '0.00'],
            ['5.1.01', '44.64', '0.00'],
            ['4.1.01', '0.00', '178.57'],
            ['2.1.02', '0.00', '16.07'],
        ])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('un descuento nunca deja la línea bajo cero; dos descuentos suman con el IVA del neto', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const dos = await facturaCon(e.B, [
            { concepto: 'Puntos', monto: '30.00' },
            { concepto: 'Más puntos', monto: '20.00' },
        ])
        const filas = await lineasDe(dos.facturaId)
        const iva = filas.reduce((s, l) => s + Math.round(Number(l.iva) * 100), 0)
        assert.equal(iva, 1607)
        assert.equal(filas[0]!.descuento, '50.00')

        const gratis = await facturaCon(e.B, [{ concepto: 'Mes gratis', monto: '999.00' }])
        const factura = await db.from('billing.facturas').where('id', gratis.facturaId).firstOrFail()
        assert.include(factura, { total: '0.00', iva: '0.00' })
        assert.deepEqual(await lineas('factura', gratis.facturaId), [
            ['5.1.01', '178.57', '0.00'],
            ['4.1.01', '0.00', '178.57'],
        ])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('notas de crédito sobre una factura con descuento acreditan el neto (por monto y por línea)', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const porMonto = await facturaCon(e.B, [{ concepto: 'Puntos', monto: '50.00' }])
        await new EmitirNotaCredito().execute(
            { factura_id: porMonto.facturaId, monto: '150.00', motivo: 'servicio caído' },
            e.ctx,
        )
        // la factura entera acreditada: venta, descuento e IVA de la factura quedan en cero netos
        assert.equal(await saldoCuenta(e.B, '2.1.02'), '0.00')
        const resultado = await db
            .from('ledger.movimientos as m')
            .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
            .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
            .where('a.empresa_id', e.B)
            .whereIn('c.codigo', ['4.1.01', '5.1.01'])
            .select(db.raw('coalesce(sum(m.debe - m.haber), 0)::text as neto'))
            .firstOrFail()
        assert.equal(resultado.neto, '0.00')

        const porLinea = await facturaCon(e.B, [{ concepto: 'Puntos', monto: '50.00' }])
        const [plan, descuento] = await lineasDe(porLinea.facturaId)
        const deMas = await errorDe(
            new EmitirNotaCredito().execute(
                {
                    factura_id: porLinea.facturaId,
                    lineas: [{ linea_id: Number(plan!.id), monto: '150.01' }],
                    motivo: 'de más',
                },
                e.ctx,
            ),
        )
        assert.equal(deMas.status, 422)
        const sobreDescuento = await errorDe(
            new EmitirNotaCredito().execute(
                {
                    factura_id: porLinea.facturaId,
                    lineas: [{ linea_id: Number(descuento!.id), monto: '1.00' }],
                    motivo: 'x',
                },
                e.ctx,
            ),
        )
        assert.equal(sobreDescuento.status, 422)
        const nota = await new EmitirNotaCredito().execute(
            {
                factura_id: porLinea.facturaId,
                lineas: [{ linea_id: Number(plan!.id), monto: '150.00' }],
                motivo: 'servicio caído',
            },
            e.ctx,
        )
        assert.include(nota, { monto: '150.00', iva: '16.07' })
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('pago de una factura con descuento: se cobra el neto', async ({ assert }) => {
        const e = await prepararEmpresas()
        const f = await facturaCon(e.B, [{ concepto: 'Puntos', monto: '50.00' }])
        await new RegistrarPago().execute(
            {
                cliente_id: f.clienteId,
                metodo: 'caja',
                monto: '150.00',
                facturas: [f.facturaId],
                empresa_id: e.B,
            },
            e.ctx,
        )
        const factura = await db.from('billing.facturas').where('id', f.facturaId).firstOrFail()
        assert.include(factura, { estado: 'pagada', pagado: '150.00' })
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('FEL: el descuento va como Descuento del ítem (precio bruto, total e IVA netos)', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const s = await servicioEn(e.B, {
            precio: '200.00',
            instalacion: '2026-10-01',
            plantilla: { certificar_al: 'emitir' },
        })
        const r = await new EmitirFactura().execute(
            {
                servicio_id: s.servicioId,
                periodo: NOVIEMBRE,
                descuentos: [{ concepto: 'Puntos', monto: '50.00' }],
            },
            e.ctx,
        )
        const [dte] = await dtesDe('factura', r.factura_id!)
        const envio = await dteParaEnviar(db.connection(), await verDte(Number(dte!.id)))
        assert.lengthOf(envio.lineas, 1)
        assert.include(envio.lineas[0]!, {
            precio: '200.00',
            descuento: '50.00',
            total: '150.00',
            iva: '16.07',
        })
        assert.include(envio, { total: '150.00', iva: '16.07' })
        assert.include(xmlDte(envio), '<dte:Descuento>50.00</dte:Descuento>')
        await cola(e)
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('H21: un mes gratis en por_certificar nace pagada, sin CxC ni DTE; certificarla a mano responde 409', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const s = await servicioEn(e.B, {
            precio: '200.00',
            instalacion: '2026-10-01',
            plantilla: { certificar_al: 'emitir' },
        })
        const r = await new EmitirFactura().execute(
            {
                servicio_id: s.servicioId,
                periodo: NOVIEMBRE,
                descuentos: [{ concepto: 'Mes gratis', monto: '200.00' }],
            },
            e.ctx,
        )
        const factura = await db.from('billing.facturas').where('id', r.factura_id!).firstOrFail()
        assert.include(factura, { estado: 'pagada', total: '0.00', aviso_cobro: false, tipo_dte: null })
        assert.deepEqual(await lineas('factura', r.factura_id!), [
            ['5.1.01', '178.57', '0.00'],
            ['4.1.01', '0.00', '178.57'],
        ])
        await cola(e)
        assert.lengthOf(await dtesDe('factura', r.factura_id!), 0)
        const manual = await errorDe(
            new SolicitarCertificacion().execute({ factura_id: r.factura_id! }, e.ctx),
        )
        assert.equal(manual.codigo, 'factura_en_cero')
        await afirmarLibro(assert, [e.B, e.C])
    })
})
