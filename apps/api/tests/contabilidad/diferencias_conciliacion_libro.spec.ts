import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import DepositarCaja from '#ledger/actions/depositar_caja'
import ImportarExtracto from '#ledger/actions/importar_extracto'
import ConciliarLinea from '#ledger/actions/conciliar_linea'
import AnularConciliacion from '#ledger/actions/anular_conciliacion'
import { lineasDeExtracto } from '#ledger/conciliacion'
import { motivosEfectivos } from '#ledger/diferencias_conciliacion'
import { hoyGuatemala } from '#ledger/fechas'
import { afirmarLibro, verificarLibro } from '#tests/contabilidad/verificar_libro'
import { prepararEmpresasGt, type EmpresasGt } from '#tests/ledger/ayudas_bancos'

/**
 * Auditor contable · AU3 (diferencias al conciliar, lote B3, plan de contabilidad §5.8).
 *
 * El auditor del libro conoce el origen `diferencia_conciliacion`: sus asientos van del banco de la
 * línea a la cuenta del motivo (o al revés) y las invariantes 9 y 4 los verifican por lo que son.
 * La invariante 13 (`llegada_reatribuida`) cuenta solo las llegadas vigentes de una línea: al
 * deshacer una conciliación (E11) la llegada se revierte y el mismo depósito puede volver a llegar.
 * Todo con `afirmarLibro` directo, sin descontar nada.
 */

const MAL_FORMADA = '9.diferencia_conciliacion_mal_contabilizada'

async function motivo(empresaId: number, codigo: string) {
    const lista = await motivosEfectivos(empresaId)
    return lista.find((m) => m.codigo === codigo)!
}

async function depositoYLinea(
    e: EmpresasGt,
    monto: string,
    boleta: string,
    montoLinea: string,
    saldoInicial = '0.00',
) {
    const banco = e.banco.get(e.B)!
    const deposito = await new DepositarCaja().execute(
        { caja_id: e.cajas.get(e.B)!, monto, boleta, cuenta_bancaria_id: banco.id },
        e.ctx,
    )
    const hoy = hoyGuatemala()
    const ext = await new ImportarExtracto().execute(
        {
            cuenta_bancaria_id: banco.id,
            desde: hoy,
            hasta: hoy,
            saldo_inicial: saldoInicial,
            saldo_final: (Number(saldoInicial) + Number(montoLinea)).toFixed(2),
            lineas: [
                { fecha: hoy, descripcion: `DEPOSITO ${boleta}`, referencia: boleta, monto: montoLinea },
            ],
        },
        e.ctx,
    )
    const [linea] = await lineasDeExtracto(ext.id)
    return { deposito, linea: linea!, banco }
}

/** Corre `paso` en una transacción que se deshace y devuelve las violaciones del auditor del libro. */
async function fabricado(e: EmpresasGt, paso: (trx: TransactionClientContract) => Promise<void>) {
    const trx = await db.transaction()
    try {
        await paso(trx)
        return await verificarLibro([e.B, e.C], { cliente: trx, incluirHallazgosAbiertos: true })
    } finally {
        await trx.rollback()
    }
}

test.group('Auditor contable · AU3 · diferencias al conciliar', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('diferencias de menos y de más se aceptan y se verifican (invariantes 9 y 4) sin descontar nada', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const comision = await motivo(e.B, 'comision_banco')
        const redondeo = await motivo(e.B, 'redondeo')
        // de menos: el banco acreditó Q 2.00 menos (comisión)
        const a = await depositoYLinea(e, '60.00', 'AU3-A', '58.00')
        await new ConciliarLinea().execute(
            {
                linea_id: a.linea.id,
                depositos: [a.deposito.id],
                diferencias: [{ motivo_id: comision.id, monto: '2.00' }],
            },
            e.ctx,
        )
        await afirmarLibro(assert, [e.B, e.C])
        // de más: el banco acreditó Q 0.03 de más (redondeo): Banco debe / cuenta del motivo haber
        const b = await depositoYLinea(e, '30.00', 'AU3-B', '30.03', '58.00')
        await new ConciliarLinea().execute(
            {
                linea_id: b.linea.id,
                depositos: [b.deposito.id],
                diferencias: [{ motivo_id: redondeo.id, monto: '0.03' }],
            },
            e.ctx,
        )
        await afirmarLibro(assert, [e.B, e.C])
        const origenes = (await db.rawQuery(
            `SELECT count(*)::int AS n FROM ledger.asientos WHERE origen_tipo = 'diferencia_conciliacion' AND empresa_id = ?`,
            [e.B],
        )) as { rows: Array<{ n: number }> }
        assert.equal(origenes.rows[0]!.n, 2)
        // deshacer una: su reverso deja de contar como saldo del banco y el libro sigue cuadrado
        const conc = (await db.rawQuery(
            `SELECT min(id)::int AS id FROM ledger.conciliaciones WHERE linea_id = ?`,
            [a.linea.id],
        )) as { rows: Array<{ id: number }> }
        await new AnularConciliacion().execute({ conciliacion_id: conc.rows[0]!.id, motivo: 'AU3' }, e.ctx)
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('una diferencia que toca caja, o que no cuadra con su registro, se detecta', async ({ assert }) => {
        const e = await prepararEmpresasGt()
        const comision = await motivo(e.B, 'comision_banco')
        const a = await depositoYLinea(e, '100.00', 'AU3-C', '98.00')
        await new ConciliarLinea().execute(
            {
                linea_id: a.linea.id,
                depositos: [a.deposito.id],
                diferencias: [{ motivo_id: comision.id, monto: '2.00' }],
            },
            e.ctx,
        )
        // el gasto de la diferencia cae en una caja en vez de su cuenta de gasto
        const aCaja = await fabricado(e, async (trx) => {
            await trx.rawQuery('ALTER TABLE ledger.movimientos DISABLE TRIGGER USER')
            await trx.rawQuery(
                `UPDATE ledger.movimientos SET cuenta_id = (SELECT id FROM ledger.cuentas WHERE codigo LIKE '1.1.01.%' ORDER BY codigo LIMIT 1)
                  WHERE asiento_id IN (SELECT id FROM ledger.asientos WHERE origen_tipo = 'diferencia_conciliacion' AND empresa_id = ?)
                    AND debe > 0`,
                [e.B],
            )
            await trx.rawQuery('ALTER TABLE ledger.movimientos ENABLE TRIGGER USER')
        })
        assert.isTrue(aCaja.some((v) => v.invariante.startsWith(MAL_FORMADA)))
        // el monto del asiento distinto del de la diferencia (ambos lados, queda cuadrado)
        const otroMonto = await fabricado(e, async (trx) => {
            await trx.rawQuery('ALTER TABLE ledger.movimientos DISABLE TRIGGER USER')
            await trx.rawQuery(
                `UPDATE ledger.movimientos SET debe = CASE WHEN debe > 0 THEN 3.00 ELSE 0 END, haber = CASE WHEN haber > 0 THEN 3.00 ELSE 0 END
                  WHERE asiento_id IN (SELECT id FROM ledger.asientos WHERE origen_tipo = 'diferencia_conciliacion' AND empresa_id = ?)`,
                [e.B],
            )
            await trx.rawQuery('ALTER TABLE ledger.movimientos ENABLE TRIGGER USER')
        })
        assert.isTrue(otroMonto.some((v) => v.invariante.startsWith(MAL_FORMADA)))
        assert.isTrue(otroMonto.some((v) => v.invariante.startsWith('4.saldo_de_caja_o_banco_distinto')))
        // un asiento de origen diferencia_conciliacion sin su registro
        const huerfano = await fabricado(e, async (trx) => {
            await trx.rawQuery('ALTER TABLE ledger.asientos DISABLE TRIGGER USER')
            await trx.insertQuery().table('ledger.asientos').insert({
                empresa_id: e.B,
                fecha: hoyGuatemala(),
                descripcion: 'sin diferencia',
                origen_tipo: 'diferencia_conciliacion',
                origen_id: 999_999_999,
            })
            await trx.rawQuery('ALTER TABLE ledger.asientos ENABLE TRIGGER USER')
        })
        assert.isTrue(huerfano.some((v) => v.invariante.startsWith(MAL_FORMADA)))
        // y sin tocar nada, el libro está limpio
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('invariante 13: deshacer la conciliación y volver a conciliar deja una sola llegada vigente por línea', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const comision = await motivo(e.B, 'comision_banco')
        const a = await depositoYLinea(e, '60.00', 'AU3-D', '58.00')
        const entrada = {
            linea_id: a.linea.id,
            depositos: [a.deposito.id],
            diferencias: [{ motivo_id: comision.id, monto: '2.00' }],
        }
        const c = await new ConciliarLinea().execute(entrada, e.ctx)
        await new AnularConciliacion().execute({ conciliacion_id: c.id, motivo: 'otro depósito' }, e.ctx)
        await afirmarLibro(assert, [e.B, e.C])
        // el mismo depósito llega otra vez con la misma línea: dos filas, una sola vigente
        await new ConciliarLinea().execute(entrada, e.ctx)
        const filas = (await db.rawQuery(
            `SELECT count(*)::int AS total,
                    count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM ledger.transitos_reatribuciones rr WHERE rr.acreditado_id = x.id))::int AS vigentes
               FROM ledger.transitos_acreditados x WHERE x.linea_id = ?`,
            [a.linea.id],
        )) as { rows: Array<{ total: number; vigentes: number }> }
        assert.deepEqual(filas.rows[0], { total: 2, vigentes: 1 })
        await afirmarLibro(assert, [e.B, e.C])
        // dos llegadas vigentes de la misma línea sí rompen la invariante
        const doble = await fabricado(e, async (trx) => {
            await trx.rawQuery('ALTER TABLE ledger.transitos_acreditados DISABLE TRIGGER USER')
            await trx.rawQuery(
                `INSERT INTO ledger.transitos_acreditados (empresa_id, tipo, documento_id, cuenta_id, fecha, linea_id)
                 SELECT empresa_id, tipo, documento_id, cuenta_id, fecha, linea_id FROM ledger.transitos_acreditados
                  WHERE linea_id = ? ORDER BY id DESC LIMIT 1`,
                [a.linea.id],
            )
            await trx.rawQuery('ALTER TABLE ledger.transitos_acreditados ENABLE TRIGGER USER')
        })
        assert.isTrue(doble.some((v) => v.invariante.startsWith('13.llegada_reatribuida')))
    })
})
