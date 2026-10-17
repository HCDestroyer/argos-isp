import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import { crearClienteFila } from '#tests/core/fabricas'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import AnularNotaCredito from '#billing/actions/anular_nota_credito'
import RevertirAsiento from '#ledger/actions/revertir_asiento'
import { controlFelFalso } from '#fiscal/fel/falso'
import { errorDe, sacarDeLaColaFel, type Empresas } from '#tests/contabilidad/ayudas_contabilidad'
import { verificarLibro } from '#tests/contabilidad/verificar_libro'
import { cola, datosNit, dtesDe, empresasFel, servicioFel } from '#tests/fiscal/ayudas_fel'

/**
 * Auditor contable · anulación de una nota de crédito cuya NCRE la SAT rechazó en definitivo
 * (desvío (a) de §17, condición del líder). A3 la implementa con `billing.notas_credito_anulaciones`
 * (nota_id único, asiento_id del reverso, motivo, anulado_por, anulado_en; solo inserción), reverso
 * con `RevertirAsiento` y el monto fuera de `facturas.pagado`.
 *
 * La anulación correcta pasa por la acción real (`AnularNotaCredito`), que además rechaza con 409
 * anular una nota con la NCRE certificada y la doble anulación. Las mutaciones (reverso parcial,
 * nota certificada anulada a mano, doble anulación) se escriben como dueño dentro de una
 * transacción que se revierte y `verificarLibro` tiene que verlas.
 */

interface Escenario {
    e: Empresas
    facturaId: number
    rechazada: { id: number; monto: string; dteId: number }
    certificada: { id: number; monto: string; dteId: number }
}

/** Factura certificada con dos NCRE: una rechazada en definitivo por la SAT y otra certificada. */
async function escenario(): Promise<Escenario> {
    const e = await empresasFel('obligatoria')
    const s = await servicioFel(e, 'emitir', '224.00', await crearClienteFila(datosNit()))
    const facturaId = s.facturas[0]!.id
    await cola(e)
    const r = await new EmitirNotaCredito().execute(
        { factura_id: facturaId, monto: '50.00', motivo: 'NIT' },
        e.ctx,
    )
    controlFelFalso.siguiente.push('rechazado')
    await cola(e)
    const c = await new EmitirNotaCredito().execute(
        { factura_id: facturaId, monto: '30.00', motivo: 'baja' },
        e.ctx,
    )
    await cola(e)
    const [dteR] = await dtesDe('nota_credito', r.id)
    const [dteC] = await dtesDe('nota_credito', c.id)
    if (dteR?.estado !== 'rechazado' || !dteR.definitivo || dteC?.estado !== 'certificado') {
        throw new Error(`escenario mal armado: ${dteR?.estado}/${dteR?.definitivo} ${dteC?.estado}`)
    }
    return {
        e,
        facturaId,
        rechazada: { id: r.id, monto: r.monto, dteId: Number(dteR.id) },
        certificada: { id: c.id, monto: c.monto, dteId: Number(dteC.id) },
    }
}

async function asientoDe(trx: TransactionClientContract, notaId: number): Promise<number> {
    const fila = (await trx
        .from('ledger.asientos')
        .where({ origen_tipo: 'nota_credito', origen_id: notaId })
        .whereNull('reversa_de')
        .firstOrFail()) as { id: number }
    return Number(fila.id)
}

/** Fila de anulación escrita a mano (las mutaciones; la anulación correcta usa la acción). */
async function registrarAnulacion(
    x: Escenario,
    trx: TransactionClientContract,
    nota: { id: number; dteId: number },
    reversoId: number,
) {
    await trx.rawQuery(
        `INSERT INTO billing.notas_credito_anulaciones (empresa_id, nota_id, asiento_id, dte_id, motivo, anulado_por)
         VALUES (?, ?, ?, ?, 'NCRE rechazada', ?)`,
        [x.e.B, nota.id, reversoId, nota.dteId, x.e.usuarioId],
    )
}

async function quitarDePagado(x: Escenario, trx: TransactionClientContract, monto: string) {
    await trx.rawQuery(
        `UPDATE billing.facturas SET pagado = pagado - ?::numeric,
                estado = CASE WHEN pagado - ?::numeric = total THEN 'pagada'
                              WHEN vencida_en IS NOT NULL THEN 'vencida'
                              WHEN pagado - ?::numeric > 0 THEN 'parcial' ELSE 'emitida' END
          WHERE id = ?`,
        [monto, monto, monto, x.facturaId],
    )
}

/** Anulación hecha a mano con `RevertirAsiento`, fila y `pagado` (para las mutaciones). */
async function anular(
    x: Escenario,
    trx: TransactionClientContract,
    nota: { id: number; monto: string; dteId: number },
) {
    const reverso = await new RevertirAsiento().execute(
        {
            asiento_id: await asientoDe(trx, nota.id),
            motivo: 'NCRE rechazada por la SAT',
            por_anulacion: true,
        },
        x.e.ctx,
        { trx },
    )
    await registrarAnulacion(x, trx, nota, Number(reverso.id))
    await quitarDePagado(x, trx, nota.monto)
}

async function enTransaccion(prueba: (trx: TransactionClientContract) => Promise<void>) {
    const trx = await db.transaction()
    try {
        await prueba(trx)
    } finally {
        await trx.rollback()
    }
}

async function violaciones(x: Escenario, trx: TransactionClientContract) {
    return verificarLibro(x.e.B, { cliente: trx, sinFuncionesProducto: true })
}

async function invariantes(x: Escenario, trx: TransactionClientContract) {
    const lista = await violaciones(x, trx)
    return lista.map((i) => i.invariante.split(' ')[0])
}

test.group('Auditor contable · anulación de notas de crédito con NCRE rechazada', (group) => {
    group.each.teardown(async () => {
        await sacarDeLaColaFel()
        await soloEmpresaPrincipal()
    })

    test('la anulación correcta deja el libro cuadrado: la nota anulada sale de pagado y de las sumas de notas', async ({
        assert,
    }) => {
        const x = await escenario()
        assert.deepEqual(await verificarLibro(x.e.B), [])
        await new AnularNotaCredito().execute({ nota_id: x.rechazada.id, motivo: 'NCRE rechazada' }, x.e.ctx)
        assert.deepEqual(await verificarLibro(x.e.B), [])
        // la acción no anula una nota con la NCRE certificada ni dos veces la misma
        for (const [notaId, codigo] of [
            [x.certificada.id, 'ncre_certificada'],
            [x.rechazada.id, 'nota_anulada'],
        ] as const) {
            const error = await errorDe(
                new AnularNotaCredito().execute({ nota_id: notaId, motivo: 'otra vez' }, x.e.ctx),
            )
            assert.equal(error.status, 409)
            assert.equal(error.codigo, codigo)
        }
        assert.deepEqual(await verificarLibro(x.e.B), [])
    })

    test('mutación: reverso parcial (un centavo menos en cada lado) → 9.nota_anulada_mal', async ({
        assert,
    }) => {
        const x = await escenario()
        await enTransaccion(async (trx) => {
            const original = await asientoDe(trx, x.rechazada.id)
            await trx.rawQuery(`ALTER TABLE ledger.asientos DISABLE TRIGGER asientos_validar`)
            await trx.rawQuery(`ALTER TABLE ledger.movimientos DISABLE TRIGGER movimientos_validar`)
            const { rows } = (await trx.rawQuery(
                `INSERT INTO ledger.asientos (empresa_id, fecha, descripcion, origen_tipo, origen_id, reversa_de)
                 SELECT empresa_id, fecha, 'reverso parcial', origen_tipo, origen_id, id FROM ledger.asientos WHERE id = ?
                 RETURNING id`,
                [original],
            )) as { rows: Array<{ id: number }> }
            const reverso = Number(rows[0]!.id)
            // el primer movimiento de cada lado con un centavo menos: sigue cuadrado, ya no es espejo
            await trx.rawQuery(
                `INSERT INTO ledger.movimientos (asiento_id, cuenta_id, cliente_id, debe, haber)
                 SELECT ?, m.cuenta_id, m.cliente_id,
                        CASE WHEN m.haber > 0 THEN m.haber - CASE WHEN m.id = (SELECT min(id) FROM ledger.movimientos WHERE asiento_id = ? AND haber > 0) THEN 0.01 ELSE 0 END ELSE 0 END,
                        CASE WHEN m.debe > 0 THEN m.debe - CASE WHEN m.id = (SELECT min(id) FROM ledger.movimientos WHERE asiento_id = ? AND debe > 0) THEN 0.01 ELSE 0 END ELSE 0 END
                   FROM ledger.movimientos m WHERE m.asiento_id = ? ORDER BY m.id`,
                [reverso, original, original, original],
            )
            await registrarAnulacion(x, trx, x.rechazada, reverso)
            await quitarDePagado(x, trx, x.rechazada.monto)
            assert.include(await invariantes(x, trx), '9.nota_anulada_mal')
        })
    })

    test('mutación: anular una nota cuya NCRE está certificada → 9.nota_anulada_mal', async ({ assert }) => {
        const x = await escenario()
        await enTransaccion(async (trx) => {
            await anular(x, trx, x.certificada)
            assert.include(await invariantes(x, trx), '9.nota_anulada_mal')
        })
    })

    test('mutación: doble anulación de la misma nota → rechazada por la base o 9.nota_anulada_mal', async ({
        assert,
    }) => {
        const x = await escenario()
        await enTransaccion(async (trx) => {
            await anular(x, trx, x.rechazada)
            const reverso = (await trx
                .from('billing.notas_credito_anulaciones')
                .where('nota_id', x.rechazada.id)
                .firstOrFail()) as { asiento_id: number }
            const segunda = await trx
                .transaction(async (sp) => {
                    await registrarAnulacion(x, sp, x.rechazada, Number(reverso.asiento_id))
                })
                .then(() => true)
                .catch(() => false)
            if (segunda) assert.include(await invariantes(x, trx), '9.nota_anulada_mal')
        })
    })
})
