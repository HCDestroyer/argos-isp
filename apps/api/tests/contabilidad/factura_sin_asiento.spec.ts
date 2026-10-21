import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { prepararEmpresas, servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro, verificarLibro } from '#tests/contabilidad/verificar_libro'

/**
 * Auditor contable · `9.factura_sin_asiento`: toda factura no anulada con total > 0 tiene
 * exactamente un asiento original de su origen (`factura` o `mora`), de su empresa y sin reverso.
 * Excepciones del contrato:
 *
 * - `por_certificar` (localización fiscal §1, fila «Modo obligatorio», y §8.4): «La factura nace
 *   `por_certificar`, sin asiento ni `factura.emitida`, y se emite al certificarse»; al certificarse
 *   `facturas.confirmar_emision` escribe el asiento. Que no tenga asiento antes lo revisa
 *   `12.por_certificar_con_asiento_o_evento`.
 * - Importadas (`reglas_snapshot.importada`, contrato de importación): `saldada_en_origen` queda
 *   pagada «sin asiento ni pago» y el saldo inicial lleva su propio asiento de apertura.
 *
 * Las violaciones se fabrican en una transacción que se revierte, como las insertaban
 * `tests/core/filtros.spec.ts` y `tests/core/empresas_servicios.spec.ts` (ver `a1/fixtures-facturas`).
 */

async function fabricado(empresas: number[], paso: (trx: TransactionClientContract) => Promise<void>) {
    const trx = await db.transaction()
    try {
        await paso(trx)
        const violaciones = await verificarLibro(empresas, { cliente: trx, incluirHallazgosAbiertos: true })
        return violaciones.filter((v) => v.invariante.startsWith('9.factura_sin_asiento'))
    } finally {
        await trx.rollback()
    }
}

async function facturaDirecta(
    trx: TransactionClientContract,
    empresaId: number,
    clienteId: number,
    extra: Record<string, unknown> = {},
) {
    const [fila] = (await trx
        .insertQuery()
        .table('billing.facturas')
        .insert({
            empresa_id: empresaId,
            cliente_id: clienteId,
            servicio_id: null,
            tipo: 'servicio',
            periodo: '2026-09-01',
            clave_unica: unico('fac'),
            vence_en: '2026-09-10',
            estado: 'vencida',
            subtotal: '100.00',
            iva: '12.00',
            total: '112.00',
            ...extra,
        })
        .returning('id')) as Array<{ id: number }>
    return Number(fila!.id)
}

test.group('Auditor contable · factura sin asiento', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('una factura emitida por la acción tiene su asiento; insertada directo, sin asiento o con su asiento revertido, se detecta', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-09-01' })
        assert.isAbove(s.facturas.length, 0)
        await afirmarLibro(assert, [e.B, e.C])
        const empresas = [e.B, e.C]

        // como los fixtures de A1: una factura vencida de Q112 sin asiento
        const directa = await fabricado(empresas, async (trx) => {
            await facturaDirecta(trx, e.B, s.clienteId)
        })
        assert.lengthOf(directa, 1)
        // pagada sin asiento (y sin pago): también
        const pagada = await fabricado(empresas, async (trx) => {
            await facturaDirecta(trx, e.B, s.clienteId, { estado: 'pagada', pagado: '112.00' })
        })
        assert.lengthOf(pagada, 1)
        // el asiento de una factura viva revertido por fuera
        const factura = s.facturas[0]!
        const revertido = await fabricado(empresas, async (trx) => {
            const original = await trx
                .from('ledger.asientos')
                .where({ origen_tipo: 'factura', origen_id: factura.id })
                .whereNull('reversa_de')
                .firstOrFail()
            await trx.rawQuery('ALTER TABLE ledger.asientos DISABLE TRIGGER USER')
            await trx.insertQuery().table('ledger.asientos').insert({
                empresa_id: e.B,
                fecha: '2026-10-15',
                descripcion: 'reverso por fuera',
                origen_tipo: 'factura',
                origen_id: factura.id,
                reversa_de: original.id,
            })
            await trx.rawQuery('ALTER TABLE ledger.asientos ENABLE TRIGGER USER')
        })
        assert.lengthOf(revertido, 1)
        // un asiento factura de una factura que no existe
        const huerfano = await fabricado(empresas, async (trx) => {
            await trx.rawQuery('ALTER TABLE ledger.asientos DISABLE TRIGGER USER')
            await trx.insertQuery().table('ledger.asientos').insert({
                empresa_id: e.B,
                fecha: '2026-10-15',
                descripcion: 'sin factura',
                origen_tipo: 'factura',
                origen_id: 999_999_999,
            })
            await trx.rawQuery('ALTER TABLE ledger.asientos ENABLE TRIGGER USER')
        })
        assert.lengthOf(huerfano, 1)
    })

    test('excepciones del contrato: por_certificar, importada, anulada y total 0 no exigen asiento', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-09-01' })
        for (const extra of [
            { estado: 'por_certificar' },
            { estado: 'pagada', pagado: '112.00', reglas_snapshot: JSON.stringify({ importada: true }) },
            { estado: 'anulada' },
        ]) {
            const violaciones = await fabricado([e.B, e.C], async (trx) => {
                await facturaDirecta(trx, e.B, s.clienteId, extra)
            })
            assert.lengthOf(violaciones, 0, JSON.stringify(extra))
        }
        await afirmarLibro(assert, [e.B, e.C])
    })
})
