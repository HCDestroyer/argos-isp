import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import RegistrarPago from '#billing/actions/registrar_pago'
import AnularPago from '#billing/actions/anular_pago'
import CerrarDiferenciaPago from '#billing/actions/cerrar_diferencia_pago'
import { estadoCuenta } from '#billing/estado_cuenta'
import { CUENTAS } from '#ledger/plan_cuentas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import {
    errorDe,
    type Empresas,
    facturasDelServicio,
    lineas,
    saldoCuenta,
    servicioFacturado,
} from '#tests/contabilidad/ayudas_contabilidad'
import { cola, datosNit, dtesDe, empresasFel, servicioFel } from '#tests/fiscal/ayudas_fel'
import { crearClienteFila } from '#tests/core/fabricas'
import { afirmarLibro, verificarLibro, type Violacion } from '#tests/contabilidad/verificar_libro'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'

/**
 * B (decisión del líder): la diferencia de cobro es un gasto por centavos no cobrados — asiento
 * `diferencia_cobro` `5.3.05 / CxC`, sin tocar IVA ni DTE; `pagado` es solo dinero cobrado y la factura
 * queda `pagada` porque `pagado + Σ diferencias vigentes = total`. Anular el pago revierte en espejo.
 *
 * Mientras el auditor no amplíe los invariantes 5 (cobertura con diferencias vigentes) y 9 (origen
 * `diferencia_cobro`), las pruebas verifican que el libro no tiene **otras** violaciones y una prueba
 * `.fails` deja `afirmarLibro` puro (hallazgo `H-diferencia-gasto`).
 */

const PENDIENTES_DEL_AUDITOR = ['5.factura_estado_inconsistente', '9.origen_de_asiento_desconocido']

/** Las violaciones que quedan, salvo las de los invariantes que el auditor aún no amplía. */
async function otrasViolaciones(empresas: number[]): Promise<Violacion[]> {
    const violaciones = await verificarLibro(empresas)
    return violaciones.filter(
        (v) => !PENDIENTES_DEL_AUDITOR.some((prefijo) => v.invariante.startsWith(prefijo)),
    )
}

async function pagoCorto(e: Pick<Empresas, 'B' | 'cajas' | 'ctx'>, clienteId: number, monto: string) {
    return new RegistrarPago().execute(
        { cliente_id: clienteId, metodo: 'caja', monto, caja_id: e.cajas.get(e.B)!, empresa_id: e.B },
        e.ctx,
    )
}

test.group('Facturas · diferencia de cobro como gasto', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('cerrar: 5.3.05 / CxC, pagado intacto y pagada; evento; una sola vez y tope; estado de cuenta; anular el pago la revierte', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const s = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-10-01' })
        const [factura] = s.facturas
        const pago = await pagoCorto(e, s.clienteId, '149.50')
        const cerrada = await new CerrarDiferenciaPago().execute({ pago_id: pago.id }, e.ctx)
        assert.include(cerrada, { pago_id: pago.id, empresa_id: e.B, monto: '0.50', tope: '1.00' })
        assert.lengthOf(cerrada.diferencias, 1)
        const [dif] = cerrada.diferencias
        assert.include(dif!, { factura_id: factura!.id, monto: '0.50' })
        assert.deepEqual(await lineas('diferencia_cobro', dif!.diferencia_id), [
            [CUENTAS_GT.DIFERENCIAS_COBRO, '0.50', '0.00'],
            [CUENTAS.CXC_CLIENTES, '0.00', '0.50'],
        ])
        const asiento = await db.from('ledger.asientos').where('id', dif!.asiento_id).firstOrFail()
        assert.include(asiento, { origen_tipo: 'diferencia_cobro', origen_id: dif!.diferencia_id })
        // pagado es solo dinero cobrado; la factura queda cubierta por la diferencia
        const [despues] = await facturasDelServicio(s.servicioId)
        assert.include(despues!, { estado: 'pagada', pagado: '149.50' })
        assert.equal(await saldoCuenta(e.B, CUENTAS.CXC_CLIENTES, s.clienteId), '0.00')
        assert.equal(await saldoCuenta(e.B, '2.1.02'), `-${factura!.iva}`, 'el IVA no se toca')
        // ninguna nota de crédito
        assert.lengthOf(await db.from('billing.notas_credito').where('factura_id', factura!.id), 0)
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'pago.diferencia_cerrada')
            .whereRaw(`(payload->>'pago_id')::bigint = ?`, [pago.id])
            .firstOrFail()
        assert.deepInclude(evento.payload, {
            pago_id: pago.id,
            empresa_id: e.B,
            cliente_id: s.clienteId,
            facturas: [factura!.id],
            monto: '0.50',
        })
        const cuenta = await estadoCuenta(s.clienteId, [e.B])
        const abono = cuenta.movimientos.find((m) => m.tipo === 'diferencia_cobro')
        assert.include(abono!, { abono: '0.50', referencia_id: dif!.diferencia_id })

        const otraVez = await errorDe(new CerrarDiferenciaPago().execute({ pago_id: pago.id }, e.ctx))
        assert.equal(otraVez.codigo, 'sin_diferencia')
        const s2 = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-10-01' })
        const corto = await pagoCorto(e, s2.clienteId, '140.00')
        const sobre = await errorDe(new CerrarDiferenciaPago().execute({ pago_id: corto.id }, e.ctx))
        assert.equal(sobre.codigo, 'diferencia_sobre_tope')

        // anular el pago: reverso espejo de la diferencia; la factura vuelve a deber todo
        await new AnularPago().execute({ pago_id: pago.id, motivo: 'cheque rechazado' }, e.ctx)
        const reverso = await db
            .from('ledger.asientos')
            .where('reversa_de', dif!.asiento_id)
            .select('id', 'origen_tipo', 'origen_id')
            .firstOrFail()
        assert.include(reverso, { origen_tipo: 'diferencia_cobro', origen_id: dif!.diferencia_id })
        const [reabierta] = await facturasDelServicio(s.servicioId)
        assert.include(reabierta!, { pagado: '0.00' })
        assert.notEqual(reabierta!.estado, 'pagada')
        assert.equal(await saldoCuenta(e.B, CUENTAS.CXC_CLIENTES, s.clienteId), '150.00')
        assert.equal(await saldoCuenta(e.B, CUENTAS_GT.DIFERENCIAS_COBRO), '0.00')
        // el pago anulado ya no admite cerrar
        const anulado = await errorDe(new CerrarDiferenciaPago().execute({ pago_id: pago.id }, e.ctx))
        assert.equal(anulado.codigo, 'pago_anulado')
        assert.deepEqual(await otrasViolaciones([e.B, e.C]), [])
    })

    test('aviso (certificar_al = pagar): la diferencia lo cubre y se certifica por el total; el IVA entero pasa a 2.1.02', async ({
        assert,
    }) => {
        const e = await empresasFel('opcional')
        const s = await servicioFel(e, 'pagar')
        const [aviso] = s.facturas
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
        await new CerrarDiferenciaPago().execute({ pago_id: pago.id }, e.ctx)
        await cola(e)
        const [dte] = await dtesDe('factura', aviso!.id)
        assert.include(dte!, { estado: 'certificado', total: '150.00', iva: aviso!.iva })
        assert.equal(await saldoCuenta(e.B, CUENTAS_GT.IVA_POR_CERTIFICAR), '0.00')
        assert.equal(await saldoCuenta(e.B, '2.1.02'), `-${aviso!.iva}`)
        assert.equal(await saldoCuenta(e.B, CUENTAS_GT.DIFERENCIAS_COBRO), '0.50')
        assert.deepEqual(await otrasViolaciones([e.B]), [])
    })

    test('con DTE certificado, anular el pago solo revierte el gasto: el DTE queda y no hay cargo', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const s = await servicioFel(e, 'pagar', '150.00', await crearClienteFila(datosNit()))
        const [factura] = s.facturas
        const pago = await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '149.50', empresa_id: e.B },
            e.ctx,
        )
        await new CerrarDiferenciaPago().execute({ pago_id: pago.id }, e.ctx)
        await cola(e)
        const [dte] = await dtesDe('factura', factura!.id)
        assert.include(dte!, { estado: 'certificado', total: '150.00' })
        await new AnularPago().execute({ pago_id: pago.id, motivo: 'cheque rechazado' }, e.ctx)
        await cola(e)
        const dtes = await dtesDe('factura', factura!.id)
        assert.deepEqual(
            dtes.map((d) => [d.id, d.estado]),
            [[dte!.id, 'certificado']],
        )
        assert.lengthOf(
            await db
                .from('billing.facturas')
                .where('factura_origen_id', factura!.id)
                .whereNot('tipo', 'mora'),
            0,
        )
        assert.equal(await saldoCuenta(e.B, CUENTAS.CXC_CLIENTES, s.clienteId), '150.00')
        assert.equal(await saldoCuenta(e.B, CUENTAS_GT.DIFERENCIAS_COBRO), '0.00')
        assert.deepEqual(await otrasViolaciones([e.B, e.C]), [])
    })

    test('anular otro pago de la misma factura también revierte la diferencia (dejó de estar cubierta)', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const s = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-10-01' })
        const [factura] = s.facturas
        const primero = await pagoCorto(e, s.clienteId, '100.00')
        const segundo = await pagoCorto(e, s.clienteId, '49.50')
        const cerrada = await new CerrarDiferenciaPago().execute({ pago_id: segundo.id }, e.ctx)
        await new AnularPago().execute({ pago_id: primero.id, motivo: 'billete falso' }, e.ctx)
        const revertido = await db
            .from('ledger.asientos')
            .where('reversa_de', cerrada.diferencias[0]!.asiento_id)
            .first()
        assert.exists(revertido)
        const [f] = await facturasDelServicio(s.servicioId)
        assert.equal(f!.id, factura!.id)
        assert.include(f!, { pagado: '49.50', estado: 'parcial' })
        assert.equal(await saldoCuenta(e.B, CUENTAS.CXC_CLIENTES, s.clienteId), '100.50')
        // una diferencia por pago y factura: el segundo pago no vuelve a cerrar la misma factura
        const otraVez = await errorDe(new CerrarDiferenciaPago().execute({ pago_id: segundo.id }, e.ctx))
        assert.equal(otraVez.codigo, 'sin_diferencia')
        assert.deepEqual(await otrasViolaciones([e.B, e.C]), [])
    })

    test('H-diferencia-gasto: cerrar una diferencia deja el libro limpio para el auditor', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const s = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-10-01' })
        const pago = await pagoCorto(e, s.clienteId, '149.50')
        await new CerrarDiferenciaPago().execute({ pago_id: pago.id }, e.ctx)
        await afirmarLibro(assert, [e.B, e.C])
    }).fails(
        'H-diferencia-gasto: el inv. 5 aún exige pagado = total en una factura pagada (cobertura con diferencias vigentes) y el inv. 9 no conoce el origen diferencia_cobro',
    )
})
