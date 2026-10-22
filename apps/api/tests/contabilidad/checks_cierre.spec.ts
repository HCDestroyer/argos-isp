import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import { prepararEmpresas } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro, verificarLibro } from '#tests/contabilidad/verificar_libro'
import { hoyGuatemala } from '#ledger/fechas'
import CerrarPeriodo from '#ledger/actions/cerrar_periodo'

/**
 * Auditor contable · lista de verificación de cierre (fase 6 PR B, §10.5): el inv. 18 detecta un
 * cierre con un check que no pasaba y una fila de check mal formada. Las violaciones se fabrican en
 * una transacción que se revierte, con el trigger de solo inserción apagado.
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

test.group('Auditor contable · checks de cierre', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('inv. 18: un cierre con un check en anomalía al cerrarse y un check mal formado se detectan', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const mes = DateTime.fromISO(hoyGuatemala(), { zone: 'utc' }).minus({ months: 2 }).startOf('month')
        const cierre = await new CerrarPeriodo().execute(
            { empresa_id: e.C, anio: mes.year, mes: mes.month },
            e.ctx,
        )
        assert.exists(cierre)
        await afirmarLibro(assert, [e.B, e.C])
        const periodo = mes.toISODate()!
        const fila = await db
            .from('ledger.cierres_checks')
            .where({ empresa_id: e.C, tipo: 'mensual', periodo, clave: 'turnos_cerrados' })
            .orderBy('id', 'desc')
            .firstOrFail()
        const cerrado = await db
            .from('ledger.cierres_mensuales')
            .where({ empresa_id: e.C, periodo })
            .firstOrFail()

        // una anomalía vigente al momento del cierre (fila anterior al cierre que nadie supervisó)
        assert.include(
            await fabricado([e.B, e.C], async (trx) => {
                await trx.insertQuery().table('ledger.cierres_checks').insert({
                    empresa_id: e.C,
                    tipo: 'mensual',
                    periodo,
                    clave: 'turnos_cerrados',
                    automatico: true,
                    valor_esperado: '0',
                    valor_obtenido: '1',
                    resultado: 'anomalia',
                    estado: 'anomalia',
                    created_at: cerrado.created_at,
                })
            }),
            '18.cierre_con_checks_pendientes',
        )
        // una «supervisión» que cambia el obtenido de lo que supervisa
        assert.include(
            await fabricado([e.B, e.C], async (trx) => {
                await trx.insertQuery().table('ledger.cierres_checks').insert({
                    empresa_id: e.C,
                    tipo: 'mensual',
                    periodo,
                    clave: 'turnos_cerrados',
                    automatico: false,
                    valor_esperado: fila.valor_esperado,
                    valor_obtenido: '7',
                    resultado: 'anomalia',
                    estado: 'supervisado',
                    nota: 'nota del revisor',
                    revisado_por: e.usuarioId,
                })
            }),
            '18.check_mal_formado',
        )
        // una clave que no está en §10.5
        assert.include(
            await fabricado([e.B, e.C], async (trx) => {
                await trx.insertQuery().table('ledger.cierres_checks').insert({
                    empresa_id: e.C,
                    tipo: 'mensual',
                    periodo,
                    clave: 'inventada',
                    automatico: true,
                    resultado: 'ok',
                    estado: 'revisado',
                })
            }),
            '18.check_mal_formado',
        )
    })
})
