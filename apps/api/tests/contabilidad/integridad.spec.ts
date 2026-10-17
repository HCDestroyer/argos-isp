import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { estado, soloEmpresaPrincipal } from '#tests/ayudas'
import RegistrarPago from '#billing/actions/registrar_pago'
import SellarAsientos from '#ledger/actions/sellar_asientos'
import CerrarPeriodo from '#ledger/actions/cerrar_periodo'
import { verificarCadena } from '#ledger/sellos'
import { CUENTAS } from '#ledger/plan_cuentas'
import {
    errorDe,
    prepararEmpresas,
    servicioFacturado,
    type Empresas,
} from '#tests/contabilidad/ayudas_contabilidad'

/**
 * Auditor contable · cadena de hash (§10.10, §16 de la fase 2). Se ataca el libro **como DBA**
 * (superusuario, triggers desactivados) y se comprueba que la verificación del producto
 * (`verificarCadena`, que usan `GET /libro/integridad`, el job diario y el cierre) lo detecta.
 * Cada ataque corre en una transacción que se revierte al final (el DDL de Postgres es
 * transaccional), salvo el de la API, que se confirma y se deshace en `finally`.
 */

/** Empresa con asientos sellados: facturas de agosto a octubre y un pago. */
async function libroSellado(): Promise<Empresas> {
    const e = await prepararEmpresas()
    const s = await servicioFacturado(e.B, '2026-10-01', { precio: '150.00', instalacion: '2026-08-01' })
    await new RegistrarPago().execute(
        { cliente_id: s.clienteId, metodo: 'caja', monto: '200.00', empresa_id: e.B },
        e.ctx,
    )
    await new SellarAsientos().execute({ empresa_id: e.B }, e.ctx)
    return e
}

async function sellos(empresaId: number, cliente: { from: TransactionClientContract['from'] } = db) {
    return (await cliente
        .from('ledger.asientos_sellos')
        .where('empresa_id', empresaId)
        .orderBy('sello')
        .select('asiento_id', 'sello', 'hash')) as Array<{ asiento_id: number; sello: number; hash: string }>
}

/** Ataque de DBA dentro de una transacción que siempre se revierte. */
async function comoDba(ataque: (trx: TransactionClientContract) => Promise<void>) {
    const trx = await db.transaction()
    try {
        await ataque(trx)
    } finally {
        await trx.rollback()
    }
}

test.group('Auditor contable · cadena de hash atacada como DBA', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('alterar el monto de un asiento sellado (cuadrado) rompe la cadena en su sello y el cierre responde 409', async ({
        assert,
    }) => {
        const e = await libroSellado()
        const [, victima] = await sellos(e.B)
        await comoDba(async (trx) => {
            await trx.rawQuery(`ALTER TABLE ledger.movimientos DISABLE TRIGGER movimientos_inmutable`)
            // el mismo centavo de más en el debe y en el haber: el asiento sigue cuadrado
            await trx.rawQuery(
                `UPDATE ledger.movimientos SET debe = debe + 0.01 WHERE id = (SELECT min(id) FROM ledger.movimientos WHERE asiento_id = ? AND debe > 0)`,
                [victima!.asiento_id],
            )
            await trx.rawQuery(
                `UPDATE ledger.movimientos SET haber = haber + 0.01 WHERE id = (SELECT min(id) FROM ledger.movimientos WHERE asiento_id = ? AND haber > 0)`,
                [victima!.asiento_id],
            )
            const rota = await verificarCadena(e.B, {}, trx)
            assert.containSubset(rota, {
                verificado: false,
                ruptura: { sello: victima!.sello, motivo: 'hash_distinto' },
            })
            const cierre = await errorDe(
                new CerrarPeriodo().execute({ empresa_id: e.B, anio: 2026, mes: 9 }, e.ctx, { trx }),
            )
            assert.equal(cierre.status, 409)
            assert.equal(cierre.codigo, 'integridad_rota')
        })
        assert.isTrue(await verificarCadena(e.B).then((r) => r.verificado))
    })

    test('alterar el hash de un sello, su hash_anterior o la cabecera del asiento rompe la cadena', async ({
        assert,
    }) => {
        const e = await libroSellado()
        const lista = await sellos(e.B)
        const [primero, segundo, tercero] = lista
        await comoDba(async (trx) => {
            await trx.rawQuery(`ALTER TABLE ledger.asientos_sellos DISABLE TRIGGER asientos_sellos_inmutable`)
            await trx.rawQuery(`UPDATE ledger.asientos_sellos SET hash = ? WHERE asiento_id = ?`, [
                'f'.repeat(64),
                segundo!.asiento_id,
            ])
            const rota = await verificarCadena(e.B, {}, trx)
            assert.containSubset(rota, { verificado: false, ruptura: { sello: segundo!.sello } })
        })
        await comoDba(async (trx) => {
            // recalcular el hash del sello alterado y encadenar el siguiente no basta: el contenido no cambia
            await trx.rawQuery(`ALTER TABLE ledger.asientos_sellos DISABLE TRIGGER asientos_sellos_inmutable`)
            await trx.rawQuery(`UPDATE ledger.asientos_sellos SET hash_anterior = ? WHERE asiento_id = ?`, [
                primero!.hash.replace(/^./, primero!.hash[0] === 'a' ? 'b' : 'a'),
                segundo!.asiento_id,
            ])
            const rota = await verificarCadena(e.B, {}, trx)
            assert.containSubset(rota, {
                verificado: false,
                ruptura: { sello: segundo!.sello, motivo: 'encadenamiento' },
            })
        })
        await comoDba(async (trx) => {
            await trx.rawQuery(`ALTER TABLE ledger.asientos DISABLE TRIGGER asientos_inmutable`)
            await trx.rawQuery(`UPDATE ledger.asientos SET descripcion = descripcion || ' ' WHERE id = ?`, [
                tercero!.asiento_id,
            ])
            const rota = await verificarCadena(e.B, {}, trx)
            assert.containSubset(rota, {
                verificado: false,
                ruptura: { sello: tercero!.sello, motivo: 'hash_distinto' },
            })
        })
        await comoDba(async (trx) => {
            // mover la fecha del asiento fuera del rango pedido esconde la alteración del rango,
            // pero la verificación completa (job diario y cierre) la ve
            await trx.rawQuery(`ALTER TABLE ledger.asientos DISABLE TRIGGER asientos_inmutable`)
            await trx.rawQuery(`ALTER TABLE ledger.asientos DISABLE TRIGGER asientos_validar`)
            await trx.rawQuery(`UPDATE ledger.asientos SET fecha = '2020-01-01' WHERE id = ?`, [
                tercero!.asiento_id,
            ])
            const completa = await verificarCadena(e.B, {}, trx)
            assert.containSubset(completa, { verificado: false, ruptura: { sello: tercero!.sello } })
        })
        assert.isTrue(await verificarCadena(e.B).then((r) => r.verificado))
    })

    test('un sello fuera de orden, que no encadena o de otra empresa se rechaza al insertarlo; como DBA, la verificación lo ve', async ({
        assert,
    }) => {
        const e = await libroSellado()
        const lista = await sellos(e.B)
        const ultimo = lista.at(-1)!
        // un asiento nuevo sin sellar
        const facturaB = (await db.from('billing.facturas').where('empresa_id', e.B).firstOrFail()) as {
            cliente_id: number
        }
        await new RegistrarPago().execute(
            { cliente_id: facturaB.cliente_id, metodo: 'caja', monto: '1.00', empresa_id: e.B },
            e.ctx,
        )
        const nuevo = (await db
            .from('ledger.asientos as a')
            .where('a.empresa_id', e.B)
            .whereNotExists((q) => q.from('ledger.asientos_sellos as s').whereRaw('s.asiento_id = a.id'))
            .orderBy('a.id', 'desc')
            .firstOrFail()) as { id: number }
        const otraEmpresa = (await db.from('ledger.asientos').where('empresa_id', e.C).first()) as {
            id: number
        } | null
        const intentos = [
            { sello: ultimo.sello + 2, hash_anterior: ultimo.hash, asiento: nuevo.id },
            { sello: ultimo.sello, hash_anterior: ultimo.hash, asiento: nuevo.id },
            { sello: ultimo.sello + 1, hash_anterior: '0'.repeat(64), asiento: nuevo.id },
            ...(otraEmpresa
                ? [{ sello: ultimo.sello + 1, hash_anterior: ultimo.hash, asiento: otraEmpresa.id }]
                : []),
        ]
        for (const intento of intentos) {
            await comoDba(async (trx) => {
                await assert.rejects(() =>
                    trx.rawQuery(
                        `INSERT INTO ledger.asientos_sellos (asiento_id, empresa_id, sello, hash_anterior, hash) VALUES (?, ?, ?, ?, ?)`,
                        [intento.asiento, e.B, intento.sello, intento.hash_anterior, 'a'.repeat(64)],
                    ),
                )
            })
        }
        await comoDba(async (trx) => {
            await trx.rawQuery(`ALTER TABLE ledger.asientos_sellos DISABLE TRIGGER asientos_sellos_validar`)
            await trx.rawQuery(
                `INSERT INTO ledger.asientos_sellos (asiento_id, empresa_id, sello, hash_anterior, hash) VALUES (?, ?, ?, ?, ?)`,
                [nuevo.id, e.B, ultimo.sello + 2, ultimo.hash, 'a'.repeat(64)],
            )
            const rota = await verificarCadena(e.B, {}, trx)
            assert.containSubset(rota, {
                verificado: false,
                ruptura: { sello: ultimo.sello + 1, motivo: 'sello_faltante' },
            })
        })
    })

    test('GET /libro/integridad informa la ruptura de una alteración confirmada y vuelve a verificar al deshacerla', async ({
        assert,
        client,
    }) => {
        const e = await libroSellado()
        const [, victima] = await sellos(e.B)
        const consultar = async () => {
            const respuesta = await estado(
                client
                    .get('/api/v1/libro/integridad')
                    .bearerToken(e.token)
                    .header('X-Empresa-Id', String(e.B)),
                200,
            )
            const cuerpo = respuesta.body() as { data: Array<{ empresa_id: number; verificado: boolean }> }
            return cuerpo.data.find((d) => d.empresa_id === e.B)!
        }
        const movimiento = (await db
            .from('ledger.movimientos')
            .where('asiento_id', victima!.asiento_id)
            .orderBy('id')
            .firstOrFail()) as { id: number; cliente_id: number | null }
        const alterar = async (clienteId: number | null) => {
            const trx = await db.transaction()
            await trx.rawQuery(`ALTER TABLE ledger.movimientos DISABLE TRIGGER movimientos_inmutable`)
            await trx.rawQuery(`ALTER TABLE ledger.movimientos DISABLE TRIGGER movimientos_validar`)
            await trx.rawQuery(`UPDATE ledger.movimientos SET cliente_id = ? WHERE id = ?`, [
                // null también es un valor válido del binding (el movimiento puede no tener cliente)
                clienteId as number,
                movimiento.id,
            ])
            await trx.rawQuery(`ALTER TABLE ledger.movimientos ENABLE TRIGGER movimientos_inmutable`)
            await trx.rawQuery(`ALTER TABLE ledger.movimientos ENABLE TRIGGER movimientos_validar`)
            await trx.commit()
        }
        const otro = (await db
            .from('core.clientes')
            .whereNot('id', movimiento.cliente_id ?? 0)
            .firstOrFail()) as { id: number }
        const otroCliente = otro.id
        try {
            await alterar(otroCliente)
            const rota = await consultar()
            assert.containSubset(rota, {
                verificado: false,
                ruptura: { sello: victima!.sello, motivo: 'hash_distinto' },
            })
        } finally {
            await alterar(movimiento.cliente_id)
        }
        const restaurada = await consultar()
        assert.isTrue(restaurada.verificado)
    })

    test('H10 · un asiento agregado como DBA a un mes cerrado se sella después y la cadena verifica', async ({
        assert,
    }) => {
        // Producto: app/ledger/sellos.ts (verificarCadena) solo recalcula hashes y encadenamiento; el sellador
        // (app/ledger/actions/sellar_asientos.ts) sella cualquier asiento sin sello, también uno con fecha de un
        // mes ya cerrado. El cierre guarda `ultimo_sello`, pero nadie comprueba que los sellos posteriores no
        // traigan asientos de ese mes: la cadena no detecta una INSERCIÓN en el pasado (solo ediciones).
        // Propuesta: ruptura `asiento_en_mes_cerrado` si un sello > ultimo_sello de un cierre vigente tiene fecha
        // de ese mes (y el sellador no lo sella: alerta `libro.integridad_rota`).
        const e = await libroSellado()
        await new CerrarPeriodo().execute({ empresa_id: e.B, anio: 2026, mes: 9 }, e.ctx)
        const cajaCuenta = (await db
            .from('ledger.cajas')
            .where('id', e.cajas.get(e.B)!)
            .select('cuenta_id')
            .firstOrFail()) as { cuenta_id: number }
        const ingresos = (await db
            .from('ledger.cuentas')
            .where({ codigo: CUENTAS.INGRESOS_INTERNET, pais: 'GT' })
            .select('id')
            .firstOrFail()) as { id: number }
        await comoDba(async (trx) => {
            await trx.rawQuery(`ALTER TABLE ledger.asientos DISABLE TRIGGER asientos_validar`)
            await trx.rawQuery(`ALTER TABLE ledger.movimientos DISABLE TRIGGER movimientos_validar`)
            const { rows } = (await trx.rawQuery(
                `INSERT INTO ledger.asientos (empresa_id, fecha, descripcion, origen_tipo)
                 VALUES (?, '2026-09-15', 'venta inventada en septiembre (cerrado)', 'ajuste') RETURNING id`,
                [e.B],
            )) as { rows: Array<{ id: number }> }
            await trx.rawQuery(
                `INSERT INTO ledger.movimientos (asiento_id, cuenta_id, debe, haber) VALUES (?, ?, 500, 0), (?, ?, 0, 500)`,
                [rows[0]!.id, cajaCuenta.cuenta_id, rows[0]!.id, ingresos.id],
            )
            await new SellarAsientos().execute({ empresa_id: e.B }, e.ctx, { trx })
            const resultado = await verificarCadena(e.B, {}, trx)
            assert.isFalse(
                resultado.verificado,
                'la cadena verifica con un asiento nuevo en septiembre cerrado',
            )
        })
    })
})
