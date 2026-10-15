import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DomainAction, type Transaccion, verificarRestriccionesDiferidas } from '#shared/domain_action'
import { contextoPrueba, unico } from '#tests/ayudas'

async function crearCuenta(trx: TransactionClientContract | typeof db = db): Promise<number> {
    const [fila] = (await trx
        .insertQuery()
        .table('ledger.cuentas')
        .insert({ codigo: unico('1.1'), nombre: 'Caja prueba', tipo: 'activo' })
        .returning('id')) as Array<{ id: number }>
    return fila!.id
}

async function crearAsiento(
    trx: TransactionClientContract,
    movimientos: Array<{ debe: string | number; haber: string | number }>,
) {
    const cuenta = await crearCuenta(trx)
    const [asiento] = (await trx
        .insertQuery()
        .table('ledger.asientos')
        .insert({ fecha: '2026-10-19', descripcion: unico('asiento'), origen_tipo: 'ajuste' })
        .returning('id')) as Array<{ id: number }>
    if (movimientos.length > 0) {
        await trx
            .insertQuery()
            .table('ledger.movimientos')
            .multiInsert(movimientos.map((m) => ({ asiento_id: asiento!.id, cuenta_id: cuenta, ...m })))
    }
    return asiento!.id
}

async function asientoCuadrado(): Promise<number> {
    return db.transaction((trx) =>
        crearAsiento(trx, [
            { debe: '50.00', haber: 0 },
            { debe: 0, haber: '50.00' },
        ]),
    )
}

class AccionAuditada extends DomainAction<{ x: number }, void> {
    readonly nombre = 'zonas.ver'
    protected async handle(_input: { x: number }, t: Transaccion) {
        await t.registrarCambios({ tipo: 'prueba', id: 1 }, { valor: 1 }, { valor: 2 })
        await t.emit('aaa.caido', { nodo: 'aaa-1', desde: new Date(0).toISOString() })
    }
}

/**
 * Ejecuta un asiento en una transacción explícita (BEGIN ... COMMIT) en una sola llamada, para que
 * el error del constraint trigger diferido aparezca justamente en el COMMIT.
 */
async function asientoConCommit(movimientos: Array<[string, string]>): Promise<string> {
    const cuenta = await crearCuenta()
    const descripcion = unico('asiento')
    const valores = movimientos.map(([debe, haber]) => `(${debe}::numeric, ${haber}::numeric)`).join(', ')
    const insertarMovimientos =
        movimientos.length === 0
            ? ''
            : `INSERT INTO ledger.movimientos (asiento_id, cuenta_id, debe, haber)
               SELECT a.id, ${cuenta}, v.debe, v.haber
                 FROM ledger.asientos a, (VALUES ${valores}) AS v (debe, haber)
                WHERE a.descripcion = '${descripcion}';`
    await db.rawQuery(`
        BEGIN;
        INSERT INTO ledger.asientos (fecha, descripcion, origen_tipo) VALUES ('2026-10-19', '${descripcion}', 'ajuste');
        ${insertarMovimientos}
        COMMIT;
    `)
    return descripcion
}

test.group('Libro: cuadre al COMMIT', () => {
    test('acepta un asiento cuadrado', async ({ assert }) => {
        const id = await asientoCuadrado()
        const movimientos = await db.from('ledger.movimientos').where('asiento_id', id)
        assert.lengthOf(movimientos, 2)

        const descripcion = await asientoConCommit([
            ['25.50', '0'],
            ['0', '20.00'],
            ['0', '5.50'],
        ])
        assert.isNotNull(await db.from('ledger.asientos').where('descripcion', descripcion).first())
    })

    test('rechaza al COMMIT un asiento con debe distinto de haber', async ({ assert }) => {
        await assert.rejects(
            () =>
                asientoConCommit([
                    ['100.00', '0'],
                    ['0', '99.99'],
                ]),
            /descuadrado: debe 100.00 <> haber 99.99/,
        )
    })

    test('rechaza al COMMIT un asiento con un solo movimiento o sin movimientos', async ({ assert }) => {
        await assert.rejects(() => asientoConCommit([['10.00', '0']]), /al menos 2/)
        await assert.rejects(() => asientoConCommit([]), /al menos 2/)
    })

    test('dentro de una transacción Lucid, verificarRestriccionesDiferidas lo rechaza', async ({
        assert,
    }) => {
        const descripcion = unico('asiento')
        await assert.rejects(
            () =>
                db.transaction(async (trx) => {
                    const id = await crearAsiento(trx, [
                        { debe: '10.00', haber: 0 },
                        { debe: 0, haber: '9.00' },
                    ])
                    await trx.from('ledger.asientos').where('id', id).select('id')
                    await verificarRestriccionesDiferidas(trx)
                }),
            /descuadrado/,
        )
        assert.isNull(await db.from('ledger.asientos').where('descripcion', descripcion).first())
    })

    test('cada movimiento lleva exactamente uno de debe/haber mayor que cero', async ({ assert }) => {
        await assert.rejects(
            () =>
                db.transaction((trx) =>
                    crearAsiento(trx, [
                        { debe: '10.00', haber: '10.00' },
                        { debe: '10.00', haber: '10.00' },
                    ]),
                ),
            /movimientos_un_lado/,
        )
        await assert.rejects(
            () =>
                db.transaction((trx) =>
                    crearAsiento(trx, [
                        { debe: 0, haber: 0 },
                        { debe: 0, haber: 0 },
                    ]),
                ),
            /movimientos_un_lado/,
        )
    })
})

test.group('Inmutabilidad de ledger y audit', () => {
    test('rechaza UPDATE y DELETE en ledger.asientos y ledger.movimientos', async ({ assert }) => {
        const id = await asientoCuadrado()
        await assert.rejects(
            () => db.from('ledger.asientos').where('id', id).update({ descripcion: 'otra' }),
            /inmutable/,
        )
        await assert.rejects(() => db.from('ledger.asientos').where('id', id).delete(), /inmutable/)
        await assert.rejects(
            () => db.from('ledger.movimientos').where('asiento_id', id).update({ debe: 1 }),
            /inmutable/,
        )
        await assert.rejects(
            () => db.from('ledger.movimientos').where('asiento_id', id).delete(),
            /inmutable/,
        )
        await assert.rejects(() => db.rawQuery('TRUNCATE ledger.movimientos CASCADE'), /inmutable/)
    })

    test('rechaza UPDATE y DELETE en audit.acciones, audit.cambios y audit.red', async ({ assert }) => {
        const ctx = contextoPrueba()
        await new AccionAuditada().execute({ x: 1 }, ctx)
        await db.table('audit.red').insert({ tipo: 'coa', comando: JSON.stringify({ a: 1 }), ok: true })

        for (const tabla of ['audit.acciones', 'audit.cambios']) {
            await assert.rejects(
                () => db.from(tabla).where('request_id', ctx.requestId).update({ request_id: 'x' }),
                /inmutable/,
            )
            await assert.rejects(
                () => db.from(tabla).where('request_id', ctx.requestId).delete(),
                /inmutable/,
            )
        }
        await assert.rejects(() => db.from('audit.red').update({ ok: false }), /inmutable/)
        await assert.rejects(() => db.from('audit.red').delete(), /inmutable/)
    })

    test('audit.outbox solo permite actualizar publicado_en e intentos, nunca borrar', async ({ assert }) => {
        const ctx = contextoPrueba()
        await new AccionAuditada().execute({ x: 1 }, ctx)
        const consulta = () => db.from('audit.outbox').where('request_id', ctx.requestId)

        await consulta().update({ publicado_en: db.knexRawQuery('now()'), intentos: 1 })
        const evento = await consulta().firstOrFail()
        assert.isNotNull(evento.publicado_en)
        assert.equal(evento.intentos, 1)

        await assert.rejects(() => consulta().update({ evento: 'otro' }), /solo se pueden actualizar/)
        await assert.rejects(() => consulta().update({ payload: '{}' }), /solo se pueden actualizar/)
        await assert.rejects(() => consulta().delete(), /inmutable/)
    })
})
