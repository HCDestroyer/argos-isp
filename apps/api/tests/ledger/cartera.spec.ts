import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import RegistrarPago from '#billing/actions/registrar_pago'
import AnularPago from '#billing/actions/anular_pago'
import AnularFactura from '#billing/actions/anular_factura'
import RegistrarPagoHistorico from '#billing/actions/registrar_pago_historico'
import ProvisionarCartera from '#ledger/actions/provisionar_cartera'
import CastigarCartera from '#ledger/actions/castigar_cartera'
import { CUENTAS } from '#ledger/plan_cuentas'
import { hoyGuatemala } from '#ledger/fechas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import {
    codigoCaja,
    errorDe,
    facturasDelServicio,
    lineas,
    saldoCuenta,
    servicioFacturado,
} from '#tests/contabilidad/ayudas_contabilidad'
import { cola, datosNit, dtesDe, empresasFel, servicioFel } from '#tests/fiscal/ayudas_fel'
import { crearClienteFila } from '#tests/core/fabricas'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import SolicitarCertificacion from '#fiscal/actions/solicitar_certificacion'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'

/**
 * Fase 4 (§10.9): estimación y castigo de cartera. Las diferencias de cobro (gasto, decisión B) están en
 * `tests/billing/diferencia_gasto.spec.ts`.
 */

const IVA_POR_CERTIFICAR = CUENTAS_GT.IVA_POR_CERTIFICAR

test.group('Fase 4 · diferencias de cobro y cartera', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

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
        await afirmarLibro(assert, [e.B, e.C])
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
        await afirmarLibro(assert, [e.B])
    })

    test('castigada y recuperación: estado propio, pagado intacto; lo cobrado después va a 4.2.03 hasta lo castigado', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const s = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-10-01' })
        const [factura] = s.facturas
        await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'caja',
                monto: '20.00',
                caja_id: e.cajas.get(e.B)!,
                empresa_id: e.B,
            },
            e.ctx,
        )
        const castigo = await new CastigarCartera().execute(
            { facturas: [factura!.id], motivo: 'incobrable', evidencia: 'gestión documentada' },
            e.ctx,
        )
        assert.equal(castigo.monto, '130.00')
        let [despues] = await facturasDelServicio(s.servicioId)
        assert.equal(despues!.estado, 'castigada')
        assert.equal(despues!.pagado, '20.00', 'pagado es solo lo cobrado')
        const caja = await codigoCaja(e.cajas.get(e.B)!)
        const p1 = await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'caja',
                monto: '100.00',
                caja_id: e.cajas.get(e.B)!,
                empresa_id: e.B,
            },
            e.ctx,
        )
        assert.deepEqual(await lineas('pago', p1.id), [
            [caja, '100.00', '0.00'],
            [CUENTAS_GT.RECUPERACION_INCOBRABLES, '0.00', '100.00'],
        ])
        assert.lengthOf(p1.aplicaciones, 0, 'nunca se aplica a la factura castigada')
        const p2 = await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'caja',
                monto: '50.00',
                caja_id: e.cajas.get(e.B)!,
                empresa_id: e.B,
            },
            e.ctx,
        )
        assert.deepEqual(await lineas('pago', p2.id), [
            [caja, '50.00', '0.00'],
            [CUENTAS_GT.RECUPERACION_INCOBRABLES, '0.00', '30.00'],
            [CUENTAS.ANTICIPOS_CLIENTES, '0.00', '20.00'],
        ])
        ;[despues] = await facturasDelServicio(s.servicioId)
        assert.equal(despues!.estado, 'castigada')
        assert.equal(despues!.pagado, '20.00')
        // anular un pago aplicado a la factura antes del castigo: el castigo ya cerró su saldo
        const pagoPrevio = await db
            .from('billing.pagos_aplicaciones')
            .where('factura_id', factura!.id)
            .select('pago_id')
            .firstOrFail()
        const castigada = await errorDe(
            new AnularPago().execute({ pago_id: Number(pagoPrevio.pago_id), motivo: 'error' }, e.ctx),
        )
        assert.equal(castigada.codigo, 'factura_castigada')
        // ni se anula ni se sustituye: el castigo cerró su saldo en el libro
        const anular = await errorDe(
            new AnularFactura().execute({ factura_id: factura!.id, motivo: 'error' }, e.ctx),
        )
        assert.equal(anular.codigo, 'factura_castigada')
        // anular una recuperación la revierte con su espejo
        await new AnularPago().execute({ pago_id: p2.id, motivo: 'cheque rechazado' }, e.ctx)
        assert.equal(await saldoCuenta(e.B, CUENTAS_GT.RECUPERACION_INCOBRABLES), '-100.00')
        assert.equal(await saldoCuenta(e.B, CUENTAS.ANTICIPOS_CLIENTES, s.clienteId), '0.00')
        // quedan 30 por recuperar: un pago histórico que sobra también es recuperación antes que anticipo
        const hist = await new RegistrarPagoHistorico().execute(
            {
                historico: true,
                origen: 'prueba',
                id_externo: 'hist-castigada-1',
                cliente_id: s.clienteId,
                metodo: 'deposito',
                monto: '5.00',
                fecha: '2026-10-01',
                empresa_id: e.B,
            },
            e.ctx,
        )
        assert.deepEqual(await lineas('pago', hist.id), [
            [CUENTAS.SALDOS_APERTURA, '5.00', '0.00'],
            [CUENTAS_GT.RECUPERACION_INCOBRABLES, '0.00', '5.00'],
        ])
        await new AnularPago().execute({ pago_id: hist.id, motivo: 'duplicado' }, e.ctx)
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('H16 · aviso acreditado entero por notas internas: estado acreditada, sin DTE ni cola; a mano 409', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const s = await servicioFel(e, 'pagar', '150.00', await crearClienteFila(datosNit()))
        const f = s.facturas[0]!
        await new EmitirNotaCredito().execute({ factura_id: f.id, monto: '100.00', motivo: 'baja' }, e.ctx)
        await new EmitirNotaCredito().execute({ factura_id: f.id, monto: '50.00', motivo: 'baja' }, e.ctx)
        const [despues] = await facturasDelServicio(s.servicioId)
        assert.equal(despues!.estado, 'acreditada')
        await cola(e)
        assert.lengthOf(await dtesDe('factura', f.id), 0)
        const manual = await errorDe(new SolicitarCertificacion().execute({ factura_id: f.id }, e.ctx))
        assert.equal(manual.codigo, 'factura_acreditada')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('H17 · la recuperación de un aviso castigado se parte en base (4.2.03) e IVA (2.1.11) como el castigo', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const s = await servicioFel(e, 'pagar', '150.00', await crearClienteFila(datosNit()))
        const k = await new CastigarCartera().execute(
            { facturas: [s.facturas[0]!.id], motivo: 'incobrable', evidencia: 'gestión documentada' },
            e.ctx,
        )
        assert.equal(k.iva, '16.07')
        const p1 = await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '100.00', empresa_id: e.B },
            e.ctx,
        )
        const caja = await codigoCaja(p1.caja_id!)
        assert.deepEqual(await lineas('pago', p1.id), [
            [caja, '100.00', '0.00'],
            [CUENTAS_GT.RECUPERACION_INCOBRABLES, '0.00', '89.29'],
            [IVA_POR_CERTIFICAR, '0.00', '10.71'],
        ])
        // el resto recupera exactamente el IVA que faltaba; lo que sobra es anticipo
        const p2 = await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '60.00', empresa_id: e.B },
            e.ctx,
        )
        assert.deepEqual(await lineas('pago', p2.id), [
            [caja, '60.00', '0.00'],
            [CUENTAS_GT.RECUPERACION_INCOBRABLES, '0.00', '44.64'],
            [IVA_POR_CERTIFICAR, '0.00', '5.36'],
            [CUENTAS.ANTICIPOS_CLIENTES, '0.00', '10.00'],
        ])
        // anular la primera devuelve su parte: la siguiente recuperación vuelve a tomarla
        await new AnularPago().execute({ pago_id: p1.id, motivo: 'cheque rechazado' }, e.ctx)
        const rec = await db
            .from('ledger.recuperaciones_castigo as r')
            .join('billing.pagos as p', 'p.id', 'r.pago_id')
            .where('r.castigo_id', k.id)
            .where('p.estado', 'registrado')
            .select(db.raw('sum(r.monto)::text as monto'), db.raw('sum(r.iva)::text as iva'))
            .first()
        assert.deepEqual({ monto: rec.monto, iva: rec.iva }, { monto: '50.00', iva: '5.36' })
    })
})
