import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal, unico } from '#tests/ayudas'
import RegistrarPago from '#billing/actions/registrar_pago'
import AnularPago from '#billing/actions/anular_pago'
import CerrarCaja from '#ledger/actions/cerrar_caja'
import AbrirCaja from '#ledger/actions/abrir_caja'
import RegistrarEgreso from '#ledger/actions/registrar_egreso'
import AnularEgreso from '#ledger/actions/anular_egreso'
import { CUENTAS } from '#ledger/plan_cuentas'
import { hoyGuatemala } from '#ledger/fechas'
import {
    lineas,
    prepararEmpresas,
    saldoCuenta,
    servicioFacturado,
} from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro, verificarLibro } from '#tests/contabilidad/verificar_libro'

/**
 * Auditor contable · invariante 4: la caja cerrada cuadra con los asientos del turno y el saldo de
 * cada caja y cuenta bancaria en el mayor es la suma de sus pagos (menos egresos, ± diferencias).
 */

async function codigoCaja(cajaId: number): Promise<string> {
    const fila = await db
        .from('ledger.cajas as c')
        .join('ledger.cuentas as cu', 'cu.id', 'c.cuenta_id')
        .where('c.id', cajaId)
        .select('cu.codigo')
        .firstOrFail()
    return fila.codigo as string
}

test.group('Auditor contable · cajas y bancos (4)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('4. caja: esperado = fondo + cobros − egresos del turno; faltante y sobrante con su asiento; anulación posterior no cambia el cierre', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const cajaId = e.cajas.get(e.B)!
        const s = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-08-01', precio: '199.99' })
        await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '123.45', empresa_id: e.B },
            e.ctx,
        )
        const p2 = await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '76.54', empresa_id: e.B },
            e.ctx,
        )
        const p3 = await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '10.00', empresa_id: e.B },
            e.ctx,
        )
        // anulado dentro del turno: no cuenta
        await new AnularPago().execute({ pago_id: p3.id, motivo: 'auditoría' }, e.ctx)
        const egreso = await new RegistrarEgreso().execute(
            { categoria: 'otros', monto: '20.00', metodo: 'caja', caja_id: cajaId, descripcion: 'auditoría' },
            e.ctx,
        )
        // faltante de Q1.99
        const turno = await new CerrarCaja().execute(
            { caja_id: cajaId, contado: '278.00', motivo: 'faltante de prueba' },
            e.ctx,
        )
        assert.equal(turno.esperado, '279.99') // 100 + 123.45 + 76.54 − 20
        assert.equal(turno.diferencia, '-1.99')
        assert.deepEqual(await lineas('cierre_caja', turno.id), [
            [CUENTAS.FALTANTES_CAJA, '1.99', '0.00'],
            [await codigoCaja(cajaId), '0.00', '1.99'],
        ])
        // anular después del cierre: el reverso sale de la caja, el cierre no cambia
        await new AnularPago().execute({ pago_id: p2.id, motivo: 'auditoría después del cierre' }, e.ctx)
        await new AbrirCaja().execute({ caja_id: cajaId, fondo_inicial: '0.00' }, e.ctx)
        await new AnularEgreso().execute({ egreso_id: egreso.id, motivo: 'auditoría' }, e.ctx)
        const segundo = await new CerrarCaja().execute(
            { caja_id: cajaId, contado: '5.00', motivo: 'sobrante de prueba' },
            e.ctx,
        )
        assert.equal(segundo.diferencia, '5.00')
        const cerrado = await db.from('ledger.cajas_turnos').where('id', turno.id).firstOrFail()
        assert.equal(cerrado.esperado, '279.99')
        // mayor de la caja: 123.45 (p1) − 1.99 (faltante) + 5.00 (sobrante); p2 y p3 anulados; egreso anulado
        assert.equal(await saldoCuenta(e.B, await codigoCaja(cajaId)), '126.46')
        await afirmarLibro(assert, e.B)
    })

    test('4. bancos: cada subcuenta y el banco principal suman sus pagos (depósito y pasarela con comisión) por empresa', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const b = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-09-01' })
        const c = await servicioFacturado(e.C, '2026-10-01', { instalacion: '2026-09-01' })
        const cuentaB = await db
            .from('billing.cuentas_bancarias as cb')
            .join('ledger.cuentas as cu', 'cu.id', 'cb.cuenta_id')
            .where('cb.id', e.cuentas.get(e.B)!)
            .select('cu.codigo')
            .firstOrFail()
        await new RegistrarPago().execute(
            {
                cliente_id: b.clienteId,
                metodo: 'deposito',
                monto: '150.00',
                cuenta_bancaria_id: e.cuentas.get(e.B)!,
                referencia: unico('BOL'),
            },
            e.ctx,
        )
        const anulado = await new RegistrarPago().execute(
            {
                cliente_id: b.clienteId,
                metodo: 'deposito',
                monto: '20.00',
                cuenta_bancaria_id: e.cuentas.get(e.B)!,
                referencia: unico('BOL'),
            },
            e.ctx,
        )
        await new AnularPago().execute({ pago_id: anulado.id, motivo: 'boleta rebotada' }, e.ctx)
        // pasarela en las dos empresas: el banco principal es común pero su saldo es por libro
        for (const [empresaId, clienteId, monto, comision] of [
            [e.B, b.clienteId, '150.00', '5.25'],
            [e.C, c.clienteId, '300.00', '10.50'],
        ] as const) {
            await new RegistrarPago().execute(
                {
                    cliente_id: clienteId,
                    metodo: 'pasarela',
                    pasarela: 'falsa',
                    monto,
                    comision,
                    referencia: unico('PAS'),
                    empresa_id: empresaId,
                },
                e.ctx,
            )
        }
        assert.equal(await saldoCuenta(e.B, cuentaB.codigo), '150.00')
        assert.equal(await saldoCuenta(e.B, CUENTAS.BANCO_PRINCIPAL), '144.75')
        assert.equal(await saldoCuenta(e.C, CUENTAS.BANCO_PRINCIPAL), '289.50')
        assert.equal(await saldoCuenta(e.C, CUENTAS.COMISIONES_PASARELAS), '10.50')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('4 · diseño: pasarela, agente y débito debitan el banco el día del pago, por el neto', async ({
        assert,
    }) => {
        // HALLAZGO DE DISEÑO (no es una prueba fallida): el asiento del pago por pasarela (también agente y
        // débito) va directo a 1.1.02.01 Banco principal con la fecha del webhook, por el neto. El proveedor
        // liquida días después: hasta entonces el mayor de bancos muestra dinero que todavía no está en la
        // cuenta y la conciliación bancaria no cuadra por fecha. Odoo usa una cuenta puente ("outstanding
        // receipts") que la liquidación limpia. Ver app/billing/actions/registrar_pago.ts (cuentaDebe).
        const e = await prepararEmpresas()
        const s = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-10-01' })
        for (const metodo of ['pasarela', 'agente', 'debito'] as const) {
            const pago = await new RegistrarPago().execute(
                {
                    cliente_id: s.clienteId,
                    metodo,
                    monto: '10.00',
                    referencia: unico(metodo),
                    empresa_id: e.B,
                    ...(metodo === 'pasarela' ? { comision: '0.35', pasarela: 'falsa' } : {}),
                },
                e.ctx,
            )
            const asiento = await db
                .from('ledger.asientos')
                .where('origen_tipo', 'pago')
                .where('origen_id', pago.id)
                .select(db.raw(`to_char(fecha, 'YYYY-MM-DD') as fecha`))
                .firstOrFail()
            assert.equal(asiento.fecha, hoyGuatemala())
            const movimientos = await lineas('pago', pago.id)
            const banco = movimientos.find(([codigo]) => codigo === CUENTAS.BANCO_PRINCIPAL)
            assert.deepEqual(banco, [
                CUENTAS.BANCO_PRINCIPAL,
                metodo === 'pasarela' ? '9.65' : '10.00',
                '0.00',
            ])
        }
        assert.deepEqual(await verificarLibro(e.B), [])
    })
})
