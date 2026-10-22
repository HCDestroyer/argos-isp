import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import { prepararEmpresas } from '#tests/contabilidad/ayudas_contabilidad'
import { verificarLibro } from '#tests/contabilidad/verificar_libro'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import { CUENTAS } from '#ledger/plan_cuentas'

/**
 * Auditor contable · cierre anual (fase 6 PR C): el inv. 19 detecta un cierre que no cancela los
 * resultados, una reapertura sin reversos, un asiento de cierre sin cierre y un año cerrado antes del
 * anterior. Los cierres de verdad (y su reapertura) los recorre `tests/ledger/cierre_anual.spec.ts`,
 * que termina en `afirmarLibro`; aquí las violaciones se fabrican en una transacción que se revierte.
 */

async function fabricado(empresas: number[], paso: (trx: TransactionClientContract) => Promise<void>) {
    const trx = await db.transaction()
    try {
        await paso(trx)
        const violaciones = await verificarLibro(empresas, { cliente: trx, incluirHallazgosAbiertos: true })
        return violaciones.map((v) => v.invariante.split(' ')[0]!)
    } finally {
        await trx.rollback()
    }
}

async function cierre(trx: TransactionClientContract, empresaId: number, anio: number) {
    const [fila] = (await trx
        .insertQuery()
        .table('ledger.cierres_anuales')
        .insert({
            empresa_id: empresaId,
            anio,
            isr: '0.00',
            resultado_antes_isr: '0.00',
            resultado: '0.00',
            resumen: JSON.stringify({}),
        })
        .returning('id')) as Array<{ id: number }>
    return Number(fila!.id)
}

test.group('Auditor contable · cierre anual', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('inv. 19: cierre sin cancelar, reapertura sin reversos, asiento sin cierre y años fuera de orden', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        // un gasto en 2025 y otro en 2026: los dos años tienen resultados
        for (const fecha of ['2025-06-10', '2026-03-10']) {
            await new RegistrarAsiento().execute(
                {
                    empresa_id: e.C,
                    fecha,
                    descripcion: 'gasto del auditor',
                    origen_tipo: 'ajuste',
                    movimientos: [
                        { cuenta: CUENTAS.GASTO_OTROS, debe: '25.00' },
                        { cuenta: CUENTAS.BANCO_PRINCIPAL, haber: '25.00' },
                    ],
                },
                e.ctx,
            )
        }
        const empresas = [e.B, e.C]
        assert.deepEqual(await verificarLibro(empresas), [])

        // un «cierre» de 2025 que no cancela el gasto ni cierra diciembre
        assert.include(
            await fabricado(empresas, async (trx) => {
                await cierre(trx, e.C, 2025)
            }),
            '19.cierre_anual_mal_contabilizado',
        )
        // 2026 cerrado con 2025 abierto
        assert.include(
            await fabricado(empresas, async (trx) => {
                await cierre(trx, e.C, 2026)
            }),
            '19.ejercicios_fuera_de_orden',
        )
        // reabierto sin revertir su asiento, y un asiento cierre_anual sin cierre
        const reabierto = await fabricado(empresas, async (trx) => {
            const id = await cierre(trx, e.C, 2025)
            await trx.rawQuery('ALTER TABLE ledger.asientos DISABLE TRIGGER USER')
            await trx.insertQuery().table('ledger.asientos').insert({
                empresa_id: e.C,
                fecha: '2025-12-31',
                descripcion: 'cierre sin reverso',
                origen_tipo: 'cierre_anual',
                origen_id: id,
            })
            await trx.insertQuery().table('ledger.asientos').insert({
                empresa_id: e.C,
                fecha: '2025-12-31',
                descripcion: 'cierre huérfano',
                origen_tipo: 'cierre_anual',
                origen_id: 999_999_999,
            })
            await trx.rawQuery('ALTER TABLE ledger.asientos ENABLE TRIGGER USER')
            await trx
                .insertQuery()
                .table('ledger.reaperturas_anuales')
                .insert({ cierre_id: id, motivo: 'auditoría' })
        })
        assert.include(reabierto, '19.cierre_anual_reabierto_mal')
    })
})
