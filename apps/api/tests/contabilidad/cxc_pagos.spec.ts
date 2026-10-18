import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import { generar } from '#tests/billing/ayudas_billing'
import { ConsumidorBilling } from '#billing/consumidor'
import RegistrarPago from '#billing/actions/registrar_pago'
import AnularPago from '#billing/actions/anular_pago'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import VencerFacturas from '#billing/actions/vencer_facturas'
import CrearPromesaPago from '#billing/actions/crear_promesa_pago'
import IncumplirPromesas from '#billing/actions/incumplir_promesas'
import { saldoAnticipos } from '#billing/cobros'
import { CUENTAS } from '#ledger/plan_cuentas'
import { dec } from '#ledger/dinero'
import {
    errorDe,
    facturasDelServicio,
    lineas,
    pendientes,
    prepararEmpresas,
    saldoCuenta,
    servicioEn,
    servicioFacturado,
    saldoClienteTexto,
    anticiposTexto,
    codigoCaja,
} from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro, contarAsientos, fotoEstado } from '#tests/contabilidad/verificar_libro'

/**
 * Auditor contable · invariantes 3 (CxC), 5 (pagos) y 9 (notas de crédito, promesas y mora).
 */

test.group('Auditor contable · CxC, pagos, notas, promesas y mora (3, 5, 9)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('3. saldo = auxiliar CxC = Σ pendiente de facturas; anticipos aparte (saldoAnticipos)', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await servicioFacturado(e.B, '2026-10-01', { precio: '275.50', instalacion: '2026-07-17' })
        const lista = await pendientes([e.B], s.clienteId)
        const pendiente = lista.reduce((t, f) => t.plus(f.total).minus(f.pagado), dec('0'))
        assert.equal(await saldoClienteTexto(s.clienteId, e.B), pendiente.toFixed(2))
        assert.equal(await saldoCuenta(e.B, CUENTAS.CXC_CLIENTES), pendiente.toFixed(2))
        // pago de más: el saldo baja a 0 y el excedente es anticipo
        await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '1000.00', empresa_id: e.B },
            e.ctx,
        )
        const anticipo = await saldoAnticipos(db.connection(), s.clienteId, e.B)
        assert.equal(await saldoClienteTexto(s.clienteId, e.B), '0.00')
        assert.equal(anticipo.toFixed(2), dec('1000.00').minus(pendiente).toFixed(2))
        // en la otra empresa no hay nada: el anticipo es por empresa
        assert.equal(await anticiposTexto(s.clienteId, e.C), '0.00')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('5. un pago nunca aplica más de lo pendiente; el excedente va a anticipos y paga la factura siguiente', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await servicioEn(e.B, { precio: '150.00', instalacion: '2026-09-01' })
        await generar(s.servicioId, '2026-09-01')
        const [septiembre] = await facturasDelServicio(s.servicioId)
        const pago = await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'caja',
                monto: '200.00',
                facturas: [septiembre!.id],
                empresa_id: e.B,
            },
            e.ctx,
        )
        assert.deepEqual(
            pago.aplicaciones.map((a) => [a.factura_id, a.monto]),
            [[septiembre!.id, '150.00']],
        )
        const caja = await codigoCaja(e.cajas.get(e.B)!)
        assert.deepEqual(await lineas('pago', pago.id), [
            [caja, '200.00', '0.00'],
            [CUENTAS.CXC_CLIENTES, '0.00', '150.00'],
            [CUENTAS.ANTICIPOS_CLIENTES, '0.00', '50.00'],
        ])
        assert.equal(await saldoCuenta(e.B, CUENTAS.ANTICIPOS_CLIENTES, s.clienteId), '-50.00')
        // la factura de octubre consume el anticipo al emitirse
        await generar(s.servicioId, '2026-10-01')
        const [, octubre] = await facturasDelServicio(s.servicioId)
        assert.equal(octubre!.pagado, '50.00')
        assert.equal(await saldoCuenta(e.B, CUENTAS.ANTICIPOS_CLIENTES, s.clienteId), '0.00')
        assert.equal(await saldoClienteTexto(s.clienteId, e.B), '100.00')
        await afirmarLibro(assert, e.B)
    })

    test('5. anular un pago deja todo como estaba, con reversos (también si su anticipo ya se aplicó)', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await servicioEn(e.B, { precio: '199.99', instalacion: '2026-08-11' })
        await generar(s.servicioId, '2026-09-01')
        await new VencerFacturas().execute({ servicio_id: s.servicioId, hasta: '2026-10-16' }, e.ctx)
        const antes = await fotoEstado([e.B])
        const asientosAntes = await contarAsientos([e.B])
        const pago = await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '555.55', empresa_id: e.B },
            e.ctx,
        )
        // el anticipo de este pago paga la factura de octubre
        await generar(s.servicioId, '2026-10-01')
        const conOctubre = await fotoEstado([e.B])
        await new AnularPago().execute({ pago_id: pago.id, motivo: 'auditoría' }, e.ctx)
        const despues = await fotoEstado([e.B])
        // los saldos vuelven a los de antes del pago más la factura de octubre, ahora sin cubrir
        const todas = await facturasDelServicio(s.servicioId)
        const octubre = todas.at(-1)!
        assert.equal(octubre.pagado, '0.00')
        assert.deepEqual(
            despues.facturas.filter((f) => Number(f.id) !== octubre.id),
            antes.facturas,
        )
        assert.notDeepEqual(conOctubre, despues)
        assert.isAbove(await contarAsientos([e.B]), asientosAntes)
        // ningún asiento del pago quedó sin reverso
        const vivos = await db
            .from('ledger.asientos as a')
            .where('a.origen_tipo', 'pago')
            .where('a.origen_id', pago.id)
            .whereNull('a.reversa_de')
            .whereNotExists((q) => q.from('ledger.asientos as r').whereRaw('r.reversa_de = a.id'))
        assert.lengthOf(vivos, 0)
        await afirmarLibro(assert, e.B)
    })

    test('9. nota de crédito: debita ingresos e IVA en proporción, acredita CxC y nunca excede el saldo', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await servicioFacturado(e.B, '2026-09-01', { precio: '150.00', instalacion: '2026-09-01' })
        const factura = s.facturas[0]!
        await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'caja',
                monto: '100.00',
                facturas: [factura.id],
                empresa_id: e.B,
            },
            e.ctx,
        )
        const excede = await errorDe(
            new EmitirNotaCredito().execute(
                { factura_id: factura.id, monto: '50.01', motivo: 'auditoría' },
                e.ctx,
            ),
        )
        assert.equal(excede.status, 422)
        const nota = await new EmitirNotaCredito().execute(
            { factura_id: factura.id, monto: '50.00', motivo: 'auditoría' },
            e.ctx,
        )
        // 50/150 de 133.93 + 16.07
        assert.deepEqual(await lineas('nota_credito', nota.id), [
            [CUENTAS.INGRESOS_INTERNET, '44.64', '0.00'],
            [CUENTAS.IVA_DEBITO, '5.36', '0.00'],
            [CUENTAS.CXC_CLIENTES, '0.00', '50.00'],
        ])
        assert.equal(nota.iva, '5.36')
        const [pagada] = await facturasDelServicio(s.servicioId)
        assert.equal(pagada!.estado, 'pagada')
        await afirmarLibro(assert, e.B)
    })

    test('9. la mora no lleva IVA (decisión del PM): asiento CxC / Recargos por mora', async ({ assert }) => {
        const e = await prepararEmpresas()
        for (const plantilla of [
            { mora_tipo: 'fija', mora_valor: '12.50' },
            { mora_tipo: 'porcentaje', mora_valor: '7.77' },
        ]) {
            const s = await servicioFacturado(e.B, '2026-09-01', {
                precio: '199.99',
                instalacion: '2026-09-01',
                plantilla,
            })
            await new VencerFacturas().execute({ servicio_id: s.servicioId, hasta: '2026-10-16' }, e.ctx)
            const facturas = await facturasDelServicio(s.servicioId)
            const moras = facturas.filter((f) => f.tipo === 'mora')
            assert.lengthOf(moras, 1)
            assert.equal(moras[0]!.iva, '0.00')
            const esperado = plantilla.mora_tipo === 'fija' ? '12.50' : '15.54'
            assert.deepEqual(await lineas('mora', moras[0]!.id), [
                [CUENTAS.CXC_CLIENTES, esperado, '0.00'],
                [CUENTAS.RECARGOS_MORA, '0.00', esperado],
            ])
            // una nota de crédito sobre la mora no toca IVA
            const nota = await new EmitirNotaCredito().execute(
                { factura_id: moras[0]!.id, monto: '5.00', motivo: 'auditoría' },
                e.ctx,
            )
            assert.equal(nota.iva, '0.00')
        }
        await afirmarLibro(assert, e.B)
    })

    test('9. las promesas no mueven el libro: crear, cumplir (evento repetido) e incumplir', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const a = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-08-01' })
        const b = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-08-01' })
        await new VencerFacturas().execute({ hasta: '2026-10-16', servicio_id: a.servicioId }, e.ctx)
        await new VencerFacturas().execute({ hasta: '2026-10-16', servicio_id: b.servicioId }, e.ctx)
        const inicio = await contarAsientos([e.B])
        const vence = DateTime.now().plus({ days: 3 }).toJSDate()
        const pa = await new CrearPromesaPago().execute(
            { servicio_id: a.servicioId, vence_en: vence, monto: '150.00', canal: 'operador' },
            e.ctx,
        )
        const pb = await new CrearPromesaPago().execute(
            { servicio_id: b.servicioId, vence_en: vence, monto: '150.00', canal: 'operador' },
            e.ctx,
        )
        assert.equal(await contarAsientos([e.B]), inicio)
        // cumplir: el pago mueve el libro; el evento procesado dos veces no
        const pago = await new RegistrarPago().execute(
            { cliente_id: a.clienteId, metodo: 'caja', monto: '450.00', empresa_id: e.B },
            e.ctx,
        )
        const conPago = await contarAsientos([e.B])
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'pago.registrado')
            .whereRaw(`(payload->>'pago_id')::bigint = ?`, [pago.id])
            .firstOrFail()
        for (let i = 0; i < 2; i++) {
            await new ConsumidorBilling().procesar({
                id: evento.id,
                evento: evento.evento,
                payload: evento.payload,
            })
        }
        assert.equal(await contarAsientos([e.B]), conPago)
        const cumplida = await db.from('billing.promesas').where('id', pa.id).firstOrFail()
        assert.equal(cumplida.estado, 'cumplida')
        await new IncumplirPromesas().execute({ ahora: DateTime.now().plus({ days: 10 }).toJSDate() }, e.ctx)
        const incumplida = await db.from('billing.promesas').where('id', pb.id).firstOrFail()
        assert.equal(incumplida.estado, 'incumplida')
        assert.equal(await contarAsientos([e.B]), conPago)
        await afirmarLibro(assert, e.B)
    })
})
