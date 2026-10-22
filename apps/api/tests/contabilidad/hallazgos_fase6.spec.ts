import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { prepararEmpresas, servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { verificarLibro } from '#tests/contabilidad/verificar_libro'
import ImportarFacturaPendiente from '#billing/actions/importar_factura_pendiente'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'

/**
 * Auditor contable · hallazgos abiertos de la fase 6. Cada uno con su `.fails` mientras exista; su
 * invariante está en `HALLAZGOS_ABIERTOS` y no lo revisan las demás pruebas.
 *
 * H27 (lo destapó el generativo en fase 6 PR B, y está en main): una factura importada guarda su IVA
 * desglosado (`iva` > 0) pero su asiento es CxC / 2.9.01 sin IVA; una nota de crédito por su total se
 * guarda con IVA 0. Σ IVA de las notas ≠ IVA de la factura acreditada completa. Qué IVA debe llevar
 * esa nota (o si la importada debe guardar `iva` 0) lo decide el PM.
 */

test.group('Auditor contable · hallazgos de la fase 6', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('H27: la nota de crédito por el total de una factura importada con IVA deja IVA residual', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await servicioEn(e.B)
        const importada = await new ImportarFacturaPendiente().execute(
            {
                origen: 'auditoria',
                id_externo: unico('f'),
                cliente_id: s.clienteId,
                empresa_id: e.B,
                cargo_unico: true,
                emitida_en: '2026-09-05',
                total: '43.98',
            },
            e.ctx,
        )
        const factura = await db.from('billing.facturas').where('id', importada.factura_id!).firstOrFail()
        assert.notEqual(factura.iva, '0.00', 'la importada desglosa su IVA')
        await new EmitirNotaCredito().execute(
            { factura_id: importada.factura_id!, monto: '43.98', motivo: 'auditoría: acredita el total' },
            e.ctx,
        )
        const violaciones = await verificarLibro([e.B, e.C], { incluirHallazgosAbiertos: true })
        assert.deepEqual(
            violaciones.map((v) => v.invariante.split(' ')[0]),
            [],
        )
    }).fails('H27: nota de crédito sobre una factura importada con IVA (decisión del PM pendiente)')
})
