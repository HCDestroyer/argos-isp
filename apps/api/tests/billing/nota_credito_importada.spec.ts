import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { crearClienteFila } from '#tests/core/fabricas'
import { saldoCuenta } from '#tests/contabilidad/ayudas_contabilidad'
import { verificarLibro } from '#tests/contabilidad/verificar_libro'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import ImportarFacturaPendiente from '#billing/actions/importar_factura_pendiente'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import AnularFactura from '#billing/actions/anular_factura'
import CerrarApertura from '#ledger/actions/cerrar_apertura'
import VerificarCierre from '#ledger/actions/verificar_cierre'
import { verFactura } from '#billing/facturas'
import type { ContextoAccion } from '#shared/contexto'

/**
 * H27 (decisión del líder): una nota de crédito sobre una factura importada que desglosa IVA lleva
 * el IVA proporcional como cualquier factura: `2.1.02` al debe por el IVA y la base contra 2.9.01,
 * o contra el patrimonio al que se cerró la apertura (2.9.01 no se reabre). La anulación de una
 * importada con la apertura cerrada la vuelve a trasladar.
 */

async function importada(ctx: ContextoAccion, empresaId: number, total = '43.98', fecha = '2026-09-05') {
    const clienteId = await crearClienteFila()
    const r = await new ImportarFacturaPendiente().execute(
        {
            origen: 'prueba_h27',
            id_externo: unico('f'),
            cliente_id: clienteId,
            empresa_id: empresaId,
            cargo_unico: true,
            emitida_en: fecha,
            total,
        },
        ctx,
    )
    const factura = (await db.from('billing.facturas').where('id', r.factura_id!).firstOrFail()) as {
        id: number
        iva: string
        total: string
    }
    return { ...factura, clienteId }
}

async function movimientosDeNota(notaId: number) {
    const filas = (await db
        .from('ledger.asientos as a')
        .join('ledger.movimientos as m', 'm.asiento_id', 'a.id')
        .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
        .where('a.origen_tipo', 'nota_credito')
        .where('a.origen_id', notaId)
        .orderBy('m.id')
        .select('c.codigo', 'm.debe', 'm.haber')) as Array<{ codigo: string; debe: string; haber: string }>
    return filas.map((f) => [f.codigo, f.debe, f.haber])
}

async function sinViolaciones(assert: { deepEqual: (a: unknown, b: unknown) => void }, empresas: number[]) {
    const violaciones = await verificarLibro(empresas, { incluirHallazgosAbiertos: true })
    assert.deepEqual(
        violaciones.map((v) => v.invariante.split(' ')[0]),
        [],
    )
}

test.group('Facturación · nota de crédito sobre una factura importada (H27)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('total: el IVA de la factura a 2.1.02 y la base a 2.9.01', async ({ assert }) => {
        const e = await prepararEmpresasGt()
        const f = await importada(e.ctx, e.B)
        assert.notEqual(f.iva, '0.00')
        const nota = await new EmitirNotaCredito().execute(
            { factura_id: f.id, monto: f.total, motivo: 'H27: acredita el total' },
            e.ctx,
        )
        const base = (Number(f.total) * 100 - Number(f.iva) * 100) / 100
        assert.equal(nota.iva, f.iva)
        assert.deepEqual(await movimientosDeNota(nota.id), [
            ['2.9.01', base.toFixed(2), '0.00'],
            ['2.1.02', f.iva, '0.00'],
            ['1.1.03', '0.00', f.total],
        ])
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('parcial: IVA proporcional; la segunda nota acredita el resto exacto', async ({ assert }) => {
        const e = await prepararEmpresasGt()
        const f = await importada(e.ctx, e.B, '112.00')
        assert.equal(f.iva, '12.00')
        const primera = await new EmitirNotaCredito().execute(
            { factura_id: f.id, monto: '56.00', motivo: 'H27: mitad' },
            e.ctx,
        )
        assert.deepEqual([primera.subtotal, primera.iva], ['50.00', '6.00'])
        const segunda = await new EmitirNotaCredito().execute(
            { factura_id: f.id, monto: '56.00', motivo: 'H27: resto' },
            e.ctx,
        )
        assert.deepEqual([segunda.subtotal, segunda.iva], ['50.00', '6.00'])
        // 2.9.01 conserva el IVA (Q12): se declaró en el sistema de origen y la nota lo rebaja del
        // débito del mes (2.1.02 al debe); el cierre de apertura lo lleva a patrimonio
        assert.equal(await saldoCuenta(e.B, '2.9.01'), '-12.00')
        assert.equal(await saldoCuenta(e.B, '2.1.02'), '12.00')
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('por línea: la base de la línea va a 2.9.01, no al ingreso', async ({ assert }) => {
        const e = await prepararEmpresasGt()
        const f = await importada(e.ctx, e.B, '112.00')
        const linea = (await verFactura(f.id)).lineas[0]!
        const nota = await new EmitirNotaCredito().execute(
            { factura_id: f.id, lineas: [{ linea_id: linea.id, monto: '112.00' }], motivo: 'H27: por línea' },
            e.ctx,
        )
        assert.equal(nota.iva, '12.00')
        assert.sameDeepMembers(await movimientosDeNota(nota.id), [
            ['2.9.01', '100.00', '0.00'],
            ['2.1.02', '12.00', '0.00'],
            ['1.1.03', '0.00', '112.00'],
        ])
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('con la apertura cerrada: la base va a 3.3.01 y apertura_cero sigue pasando; anular la vuelve a trasladar', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const f = await importada(e.ctx, e.B, '112.00')
        const otra = await importada(e.ctx, e.B, '224.00')
        await new CerrarApertura().execute({ empresa_id: e.B, fecha: '2026-09-30' }, e.ctx)
        assert.equal(await saldoCuenta(e.B, '2.9.01'), '0.00')
        assert.equal(await saldoCuenta(e.B, '3.3.01'), '-336.00')

        const nota = await new EmitirNotaCredito().execute(
            { factura_id: f.id, monto: '112.00', motivo: 'H27: con la apertura cerrada' },
            e.ctx,
        )
        assert.deepEqual(await movimientosDeNota(nota.id), [
            ['3.3.01', '100.00', '0.00'],
            ['2.1.02', '12.00', '0.00'],
            ['1.1.03', '0.00', '112.00'],
        ])
        assert.equal(await saldoCuenta(e.B, '2.9.01'), '0.00')

        await new AnularFactura().execute(
            { factura_id: otra.id, motivo: 'H27: anular con la apertura cerrada' },
            e.ctx,
        )
        assert.equal(await saldoCuenta(e.B, '2.9.01'), '0.00')
        assert.equal(await saldoCuenta(e.B, '3.3.01'), '-12.00')

        const hoy = new Date().toISOString().slice(0, 7)
        const verificacion = await new VerificarCierre().execute(
            { empresa_id: e.B, tipo: 'mensual', periodo: hoy },
            e.ctx,
        )
        assert.equal(verificacion.checks.find((c) => c.clave === 'apertura_cero')?.estado, 'revisado')
        await sinViolaciones(assert, [e.B, e.C])
    })
})
