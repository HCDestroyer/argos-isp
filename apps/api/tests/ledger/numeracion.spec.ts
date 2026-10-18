import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import RegistrarAsiento, { type EntradaAsiento } from '#ledger/actions/registrar_asiento'
import RevertirAsiento from '#ledger/actions/revertir_asiento'
import CerrarPeriodo from '#ledger/actions/cerrar_periodo'
import ReabrirPeriodo from '#ledger/actions/reabrir_periodo'
import RegistrarPago from '#billing/actions/registrar_pago'
import { libroDiario, verAsiento } from '#ledger/consultas'
import { CUENTAS } from '#ledger/plan_cuentas'
import { prepararEmpresas, servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'

/**
 * Numeración guardada del libro (§10.7 de localización fiscal, hallazgo H4): número por diario y
 * año al insertar, sin huecos ni repetidos aun con asientos simultáneos, y partida del Libro
 * Diario al cerrar el mes, que nunca se renumera.
 */

function ajuste(empresaId: number, fecha: string, descripcion: string): EntradaAsiento {
    return {
        empresa_id: empresaId,
        fecha,
        descripcion,
        origen_tipo: 'ajuste',
        movimientos: [
            { cuenta: CUENTAS.GASTO_OTROS, debe: '1.00' },
            { cuenta: CUENTAS.BANCO_PRINCIPAL, haber: '1.00' },
        ],
    }
}

async function numeros(empresaId: number) {
    const filas = await db
        .from('ledger.asientos as a')
        .join('ledger.asientos_numeros as n', 'n.asiento_id', 'a.id')
        .join('ledger.diarios as d', 'd.id', 'n.diario_id')
        .leftJoin('ledger.asientos_partidas as p', 'p.asiento_id', 'a.id')
        .where('a.empresa_id', empresaId)
        .orderBy('a.id')
        .select('a.id', 'd.codigo as diario', 'n.anio', 'n.numero', 'p.partida')
    return filas as Array<{
        id: number
        diario: string
        anio: number
        numero: number
        partida: number | null
    }>
}

test.group('ledger · numeración del diario', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('cada asiento recibe diario y número al registrarse; uno con fecha anterior no renumera', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await servicioFacturado(e.B, '2026-10-01', { precio: '150.00', instalacion: '2026-10-01' })
        await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '150.00', empresa_id: e.B },
            e.ctx,
        )
        const antes = await numeros(e.B)
        assert.includeMembers(
            antes.map((n) => n.diario),
            ['VEN', `CAJ-${e.cajas.get(e.B)}`],
        )
        const manual = await new RegistrarAsiento().execute(ajuste(e.B, '2026-09-15', 'olvidado'), e.ctx)
        assert.equal(manual.diario, 'VAR')
        assert.equal(manual.numero, 1)
        const despues = await numeros(e.B)
        assert.deepEqual(despues.slice(0, antes.length), antes)

        const visto = await verAsiento(manual.id)
        assert.containSubset(visto, { diario: 'VAR', numero: 1, partida: null })
        const diario = await libroDiario({ limit: 100 }, [e.B])
        assert.isTrue(diario.data.every((a) => a.diario !== null && a.numero !== null))

        // el reverso va al diario de su original con el número siguiente
        const reverso = await new RevertirAsiento().execute(
            { asiento_id: manual.id, motivo: 'prueba' },
            e.ctx,
        )
        assert.equal(reverso.diario, 'VAR')
        assert.equal(reverso.numero, 2)

        // la base rechaza editar o borrar un número, y retroceder la secuencia
        for (const sql of [
            `UPDATE ledger.asientos_numeros SET numero = numero + 100 WHERE asiento_id = ${manual.id}`,
            `DELETE FROM ledger.asientos_numeros WHERE asiento_id = ${manual.id}`,
            `UPDATE ledger.secuencias SET ultimo = 0 WHERE empresa_id = ${e.B}`,
        ]) {
            const trx = await db.transaction()
            await assert.rejects(() => trx.rawQuery(sql))
            await trx.rollback()
        }
    })

    test('asientos simultáneos del mismo diario: números distintos y sin huecos, también si uno falla', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const resultados = await Promise.allSettled(
            Array.from({ length: 12 }, (_, i) =>
                i % 4 === 3
                    ? // uno de cada cuatro descuadra: se deshace con su número
                      new RegistrarAsiento().execute(
                          {
                              ...ajuste(e.C, '2026-10-02', `simultáneo ${i}`),
                              movimientos: [
                                  { cuenta: CUENTAS.GASTO_OTROS, debe: '2.00' },
                                  { cuenta: CUENTAS.BANCO_PRINCIPAL, haber: '1.00' },
                              ],
                          },
                          e.ctx,
                      )
                    : new RegistrarAsiento().execute(ajuste(e.C, '2026-10-02', `simultáneo ${i}`), e.ctx),
            ),
        )
        assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 9)
        const todos = await numeros(e.C)
        const vistos = todos.filter((n) => n.diario === 'VAR').map((n) => n.numero)
        assert.deepEqual(
            [...vistos].sort((a, b) => a - b),
            [1, 2, 3, 4, 5, 6, 7, 8, 9],
        )
        const secuencia = await db
            .from('ledger.secuencias as s')
            .join('ledger.diarios as d', 'd.id', 's.diario_id')
            .where('d.empresa_id', e.C)
            .where('d.codigo', 'VAR')
            .where('s.anio', 2026)
            .firstOrFail()
        assert.equal(secuencia.ultimo, 9)
    })

    test('la partida se asigna al cerrar el mes, en orden cronológico, y no cambia al reabrir y volver a cerrar', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const tercero = await new RegistrarAsiento().execute(ajuste(e.B, '2026-08-20', 'tercero'), e.ctx)
        const primero = await new RegistrarAsiento().execute(ajuste(e.B, '2026-08-03', 'primero'), e.ctx)
        const segundo = await new RegistrarAsiento().execute(ajuste(e.B, '2026-08-10', 'segundo'), e.ctx)
        assert.deepEqual([tercero.numero, primero.numero, segundo.numero], [1, 2, 3])
        const abierto = await verAsiento(primero.id)
        assert.isNull(abierto.partida)

        const cierre = await new CerrarPeriodo().execute({ empresa_id: e.B, anio: 2026, mes: 8 }, e.ctx)
        const partidas = async () => {
            const filas = await numeros(e.B)
            return new Map(filas.map((n) => [Number(n.id), n.partida]))
        }
        const tras = await partidas()
        assert.deepEqual([tras.get(primero.id), tras.get(segundo.id), tras.get(tercero.id)], [1, 2, 3])

        // reabrir, agregar un asiento al inicio del mes y volver a cerrar: los anteriores conservan su partida
        await new ReabrirPeriodo().execute(
            { empresa_id: e.B, anio: 2026, mes: 8, motivo: 'ajuste del auditor' },
            e.ctx,
        )
        const nuevo = await new RegistrarAsiento().execute(ajuste(e.B, '2026-08-01', 'nuevo'), e.ctx)
        await new CerrarPeriodo().execute({ empresa_id: e.B, anio: 2026, mes: 8 }, e.ctx)
        const final = await partidas()
        assert.deepEqual(
            [final.get(primero.id), final.get(segundo.id), final.get(tercero.id), final.get(nuevo.id)],
            [1, 2, 3, 4],
        )

        // septiembre sigue la cuenta del año; la base no acepta partidas de un mes abierto
        const sept = await new RegistrarAsiento().execute(ajuste(e.B, '2026-09-05', 'septiembre'), e.ctx)
        const trx = await db.transaction()
        await assert.rejects(() =>
            trx.rawQuery(
                `INSERT INTO ledger.asientos_partidas (asiento_id, empresa_id, anio, partida, cierre_id) VALUES (?, ?, 2026, 99, ?)`,
                [sept.id, e.B, cierre.id],
            ),
        )
        await trx.rollback()
        await new CerrarPeriodo().execute({ empresa_id: e.B, anio: 2026, mes: 9 }, e.ctx)
        const cerradoSept = await verAsiento(sept.id)
        assert.equal(cerradoSept.partida, 5)

        // reabrir agosto con septiembre cerrado: 409; primero septiembre, después agosto
        const reabrir = (mes: number) =>
            new ReabrirPeriodo().execute({ empresa_id: e.B, anio: 2026, mes, motivo: 'revisión' }, e.ctx)
        const fuera = await reabrir(8).then(
            () => null,
            (error: { tipo?: string; message: string }) => error,
        )
        assert.include(fuera?.tipo ?? '', 'reapertura_fuera_de_orden')
        assert.include(fuera!.message, '2026-09')
        await reabrir(9)
        await reabrir(8)
        assert.deepEqual(await partidas(), final.set(sept.id, 5))
    })
})
