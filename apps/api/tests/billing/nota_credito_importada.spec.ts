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
import { cuentaIngresoDeLinea } from '#billing/facturas'
import { errorDe } from '#tests/contabilidad/ayudas_contabilidad'
import VerificarCierre from '#ledger/actions/verificar_cierre'
import { verFactura } from '#billing/facturas'
import type { ContextoAccion } from '#shared/contexto'
import { CERO, aTexto, dec } from '#ledger/dinero'

const aTextoSuma = (montos: string[]) => aTexto(montos.reduce((s, m) => s.plus(dec(m)), CERO))

/**
 * H27 / H50 (decisiones del líder): una nota de crédito sobre una factura importada que desglosa IVA
 * es una rebaja de ventas del periodo: `2.1.02` al debe por el IVA proporcional y la base a la cuenta
 * de ingreso de la línea. 2.9.01 no se toca (conserva el saldo importado hasta su cierre). Con la
 * apertura cerrada, anular una importada responde 409 (se acredita con una nota).
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

test.group('Facturación · nota de crédito sobre una factura importada (H27, H50)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    async function cuentaDeIngreso(facturaId: number) {
        const detalle = await verFactura(facturaId)
        return cuentaIngresoDeLinea(detalle.lineas[0]!)
    }

    test('total: el IVA de la factura a 2.1.02 y la base a la cuenta de ingreso de la línea', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const f = await importada(e.ctx, e.B, '112.00')
        assert.equal(f.iva, '12.00')
        const ingreso = await cuentaDeIngreso(f.id)
        const nota = await new EmitirNotaCredito().execute(
            { factura_id: f.id, monto: f.total, motivo: 'H27: acredita el total' },
            e.ctx,
        )
        assert.deepEqual([nota.subtotal, nota.iva], ['100.00', '12.00'])
        assert.sameDeepMembers(await movimientosDeNota(nota.id), [
            [ingreso, '100.00', '0.00'],
            ['2.1.02', '12.00', '0.00'],
            ['1.1.03', '0.00', '112.00'],
        ])
        // 2.9.01 conserva el saldo importado: lo cancela el cierre de apertura
        assert.equal(await saldoCuenta(e.B, '2.9.01'), '-112.00')
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('parcial: IVA proporcional; la segunda nota acredita el resto exacto', async ({ assert }) => {
        const e = await prepararEmpresasGt()
        const f = await importada(e.ctx, e.B, '43.98')
        const notas = []
        for (const monto of ['10.01', '10.01', '10.01', '13.95']) {
            notas.push(
                await new EmitirNotaCredito().execute(
                    { factura_id: f.id, monto, motivo: 'H27: parcial' },
                    e.ctx,
                ),
            )
        }
        assert.equal(aTextoSuma(notas.map((n) => n.iva)), f.iva)
        assert.equal(await saldoCuenta(e.B, '2.1.02'), f.iva)
        assert.equal(await saldoCuenta(e.B, '1.1.03'), '0.00')
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('por línea: la base de la línea va a su cuenta de ingreso', async ({ assert }) => {
        const e = await prepararEmpresasGt()
        const f = await importada(e.ctx, e.B, '112.00')
        const detalle = await verFactura(f.id)
        const linea = detalle.lineas[0]!
        const nota = await new EmitirNotaCredito().execute(
            { factura_id: f.id, lineas: [{ linea_id: linea.id, monto: '112.00' }], motivo: 'H27: por línea' },
            e.ctx,
        )
        assert.equal(nota.iva, '12.00')
        assert.sameDeepMembers(await movimientosDeNota(nota.id), [
            [cuentaIngresoDeLinea(linea), '100.00', '0.00'],
            ['2.1.02', '12.00', '0.00'],
            ['1.1.03', '0.00', '112.00'],
        ])
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('con la apertura cerrada: la nota no toca 2.9.01 ni patrimonio; anular la importada es 409', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const f = await importada(e.ctx, e.B, '112.00')
        const otra = await importada(e.ctx, e.B, '224.00')
        await new CerrarApertura().execute({ empresa_id: e.B, fecha: '2026-09-30' }, e.ctx)
        assert.equal(await saldoCuenta(e.B, '3.3.01'), '-336.00')
        const ingreso = await cuentaDeIngreso(f.id)
        const nota = await new EmitirNotaCredito().execute(
            { factura_id: f.id, monto: '112.00', motivo: 'H27: con la apertura cerrada' },
            e.ctx,
        )
        assert.sameDeepMembers(await movimientosDeNota(nota.id), [
            [ingreso, '100.00', '0.00'],
            ['2.1.02', '12.00', '0.00'],
            ['1.1.03', '0.00', '112.00'],
        ])
        assert.equal(await saldoCuenta(e.B, '2.9.01'), '0.00')
        assert.equal(await saldoCuenta(e.B, '3.3.01'), '-336.00')

        const anular = await errorDe(
            new AnularFactura().execute(
                { factura_id: otra.id, motivo: 'H50: anular con la apertura cerrada' },
                e.ctx,
            ),
        )
        assert.deepInclude(anular, { status: 409, codigo: 'importada_con_apertura_cerrada' })
        assert.equal(await saldoCuenta(e.B, '2.9.01'), '0.00')

        const hoy = new Date().toISOString().slice(0, 7)
        const verificacion = await new VerificarCierre().execute(
            { empresa_id: e.B, tipo: 'mensual', periodo: hoy },
            e.ctx,
        )
        assert.equal(verificacion.checks.find((c) => c.clave === 'apertura_cero')?.estado, 'revisado')
        await sinViolaciones(assert, [e.B, e.C])
    })

    test('con la apertura abierta: anular la importada la devuelve a 2.9.01 (corrige la importación)', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const f = await importada(e.ctx, e.B, '112.00')
        await new AnularFactura().execute({ factura_id: f.id, motivo: 'importada por error' }, e.ctx)
        assert.equal(await saldoCuenta(e.B, '2.9.01'), '0.00')
        assert.equal(await saldoCuenta(e.B, '1.1.03'), '0.00')
        await sinViolaciones(assert, [e.B, e.C])
    })
})
