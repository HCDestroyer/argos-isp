import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import RegistrarPago from '#billing/actions/registrar_pago'
import CerrarDiferenciaPago from '#billing/actions/cerrar_diferencia_pago'
import ProvisionarCartera from '#ledger/actions/provisionar_cartera'
import CastigarCartera from '#ledger/actions/castigar_cartera'
import { CUENTAS } from '#ledger/plan_cuentas'
import { hoyGuatemala } from '#ledger/fechas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import {
    errorDe,
    facturasDelServicio,
    lineas,
    saldoCuenta,
    servicioFacturado,
} from '#tests/contabilidad/ayudas_contabilidad'
import { cola, dtesDe, empresasFel, servicioFel } from '#tests/fiscal/ayudas_fel'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { afirmarLibroFase4 } from '#tests/ledger/verificar_bancos'

/**
 * Fase 4 (§10.9): cierre de diferencias de cobro, estimación y castigo de cartera.
 */

const IVA_POR_CERTIFICAR = CUENTAS_GT.IVA_POR_CERTIFICAR

test.group('Fase 4 · diferencias de cobro y cartera', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('cerrar diferencia: la base a 5.3.05 y el IVA proporcional; tope y una sola vez', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const s = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-10-01' })
        const [factura] = s.facturas
        const pago = await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'caja',
                monto: '149.50',
                caja_id: e.cajas.get(e.B)!,
                empresa_id: e.B,
            },
            e.ctx,
        )
        const cerrada = await new CerrarDiferenciaPago().execute({ pago_id: pago.id }, e.ctx)
        assert.equal(cerrada.monto, '0.50')
        assert.equal(cerrada.tope, '1.00')
        const [nota] = cerrada.notas
        assert.isFalse(nota!.ncre)
        assert.deepEqual(await lineas('nota_credito', nota!.nota_credito_id), [
            [CUENTAS_GT.DIFERENCIAS_COBRO, '0.45', '0.00'],
            [CUENTAS.IVA_DEBITO, '0.05', '0.00'],
            [CUENTAS.CXC_CLIENTES, '0.00', '0.50'],
        ])
        const [despues] = await facturasDelServicio(s.servicioId)
        assert.equal(despues!.id, factura!.id)
        assert.equal(despues!.estado, 'pagada')
        const otraVez = await errorDe(new CerrarDiferenciaPago().execute({ pago_id: pago.id }, e.ctx))
        assert.equal(otraVez.codigo, 'sin_diferencia')

        const s2 = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-10-01' })
        const corto = await new RegistrarPago().execute(
            {
                cliente_id: s2.clienteId,
                metodo: 'caja',
                monto: '140.00',
                caja_id: e.cajas.get(e.B)!,
                empresa_id: e.B,
            },
            e.ctx,
        )
        const sobre = await errorDe(new CerrarDiferenciaPago().execute({ pago_id: corto.id }, e.ctx))
        assert.equal(sobre.codigo, 'diferencia_sobre_tope')
        await afirmarLibroFase4(assert, [e.B, e.C])
    })

    test('cerrar diferencia de un aviso sin DTE: nota interna con IVA de 2.1.11 y el aviso se certifica por el neto', async ({
        assert,
    }) => {
        const e = await empresasFel('opcional')
        const s = await servicioFel(e, 'pagar')
        const [aviso] = s.facturas
        assert.equal(await saldoCuenta(e.B, IVA_POR_CERTIFICAR), `-${aviso!.iva}`)
        const pago = await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'caja',
                monto: '149.50',
                caja_id: e.cajas.get(e.B)!,
                empresa_id: e.B,
            },
            e.ctx,
        )
        const cerrada = await new CerrarDiferenciaPago().execute({ pago_id: pago.id }, e.ctx)
        assert.deepEqual(await lineas('nota_credito', cerrada.notas[0]!.nota_credito_id), [
            [CUENTAS_GT.DIFERENCIAS_COBRO, '0.45', '0.00'],
            [IVA_POR_CERTIFICAR, '0.05', '0.00'],
            [CUENTAS.CXC_CLIENTES, '0.00', '0.50'],
        ])
        await cola(e)
        const [dte] = await dtesDe('factura', aviso!.id)
        assert.equal(dte!.estado, 'certificado')
        assert.equal(dte!.total, '149.50')
        assert.equal(await saldoCuenta(e.B, IVA_POR_CERTIFICAR), '0.00')
        await afirmarLibroFase4(assert, [e.B])
    })

    test('estimación hasta el 3 % y castigo de un aviso sin DTE: IVA de 2.1.11, estimación y 5.3.02; no se certifica', async ({
        assert,
    }) => {
        const e = await empresasFel('opcional')
        const s = await servicioFel(e, 'pagar')
        const [aviso] = s.facturas
        const anio = Number(hoyGuatemala().slice(0, 4))
        const p1 = await new ProvisionarCartera().execute({ empresa_id: e.B, anio }, e.ctx)
        assert.equal(p1.base, '150.00')
        assert.equal(p1.tope, '4.50')
        assert.equal(p1.monto, '4.50')
        assert.deepEqual(await lineas('provision', p1.id), [
            [CUENTAS_GT.CUENTAS_INCOBRABLES, '4.50', '0.00'],
            [CUENTAS_GT.ESTIMACION_INCOBRABLES, '0.00', '4.50'],
        ])
        const p2 = await new ProvisionarCartera().execute({ empresa_id: e.B, anio }, e.ctx)
        assert.equal(p2.monto, '0.00', 'la reserva ya está en el tope')
        assert.isNull(p2.asiento_id)

        const sinEvidencia = await errorDe(
            new CastigarCartera().execute(
                { facturas: [aviso!.id], motivo: 'incobrable', evidencia: '' },
                e.ctx,
            ),
        )
        assert.equal(sinEvidencia.codigo, 'castigo_sin_evidencia')
        const castigo = await new CastigarCartera().execute(
            {
                facturas: [aviso!.id],
                motivo: 'cliente no localizado',
                evidencia: '3 llamadas y 2 cartas (oct-2026)',
            },
            e.ctx,
        )
        assert.equal(castigo.monto, '150.00')
        assert.equal(castigo.iva, aviso!.iva)
        assert.equal(castigo.estimacion, '4.50')
        assert.deepEqual(await lineas('castigo', castigo.id), [
            [IVA_POR_CERTIFICAR, aviso!.iva, '0.00'],
            [CUENTAS_GT.ESTIMACION_INCOBRABLES, '4.50', '0.00'],
            [CUENTAS_GT.CUENTAS_INCOBRABLES, castigo.gasto, '0.00'],
            [CUENTAS.CXC_CLIENTES, '0.00', '150.00'],
        ])
        assert.equal(await saldoCuenta(e.B, IVA_POR_CERTIFICAR), '0.00')
        assert.equal(await saldoCuenta(e.B, CUENTAS.CXC_CLIENTES, s.clienteId), '0.00')
        await cola(e)
        assert.lengthOf(await dtesDe('factura', aviso!.id), 0, 'lo castigado no se certifica')
        const dos = await errorDe(
            new CastigarCartera().execute(
                { facturas: [aviso!.id], motivo: 'otra vez', evidencia: 'nada nuevo' },
                e.ctx,
            ),
        )
        assert.include(dos.reglas, 'sin_saldo')
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'cartera.castigada')
            .whereRaw(`(payload->>'castigo_id')::bigint = ?`, [castigo.id])
            .first()
        assert.exists(evento)
        await afirmarLibroFase4(assert, [e.B, e.C])
    })

    test('castigo de un aviso con pago parcial: sale de 2.1.11 solo el IVA proporcional del saldo', async ({
        assert,
    }) => {
        const e = await empresasFel('opcional')
        const s = await servicioFel(e, 'pagar')
        const [aviso] = s.facturas
        await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'caja',
                monto: '50.00',
                caja_id: e.cajas.get(e.B)!,
                empresa_id: e.B,
            },
            e.ctx,
        )
        const castigo = await new CastigarCartera().execute(
            { facturas: [aviso!.id], motivo: 'incobrable', evidencia: 'gestión documentada' },
            e.ctx,
        )
        assert.equal(castigo.monto, '100.00')
        assert.equal(castigo.iva, '10.71')
        assert.equal(castigo.estimacion, '0.00')
        assert.equal(castigo.gasto, '89.29')
        assert.equal(await saldoCuenta(e.B, IVA_POR_CERTIFICAR), '-5.36')
        await afirmarLibroFase4(assert, [e.B])
    })
})
