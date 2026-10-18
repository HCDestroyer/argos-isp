import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal } from '#tests/ayudas'
import RegistrarAsiento, { type EntradaAsiento } from '#ledger/actions/registrar_asiento'
import CerrarPeriodo from '#ledger/actions/cerrar_periodo'
import ReabrirPeriodo from '#ledger/actions/reabrir_periodo'
import SellarAsientos from '#ledger/actions/sellar_asientos'
import VerificarIntegridad from '#ledger/actions/verificar_integridad'
import { HASH_INICIAL, asientosCanonicos, calcularHash, jsonCanonico, verificarCadena } from '#ledger/sellos'
import { ejecutarCron } from '#billing/jobs'
import { CUENTAS } from '#ledger/plan_cuentas'
import { errorDe, prepararEmpresas } from '#tests/contabilidad/ayudas_contabilidad'

/**
 * Cadena de hash del libro (contrato de localización fiscal §10.10): el sellador encadena los
 * asientos por empresa, `GET /libro/integridad` la recalcula y cualquier alteración hecha por
 * fuera de la aplicación (aun como dueño de las tablas) la rompe en ese sello.
 */

function ajuste(empresaId: number, fecha: string, descripcion: string, monto = '1.00'): EntradaAsiento {
    return {
        empresa_id: empresaId,
        fecha,
        descripcion,
        origen_tipo: 'ajuste',
        movimientos: [
            { cuenta: CUENTAS.GASTO_OTROS, debe: monto },
            { cuenta: CUENTAS.BANCO_PRINCIPAL, haber: monto },
        ],
    }
}

async function sellos(empresaId: number) {
    return (await db
        .from('ledger.asientos_sellos')
        .where('empresa_id', empresaId)
        .orderBy('sello')
        .select('asiento_id', 'sello', 'hash_anterior', 'hash', 'version')) as Array<{
        asiento_id: number
        sello: number
        hash_anterior: string
        hash: string
        version: string
    }>
}

/** Altera una fila del libro como dueño de las tablas, saltándose el trigger de inmutabilidad. */
async function alterarComoDueno(sql: string, tabla: 'asientos' | 'movimientos') {
    const trx = await db.transaction()
    await trx.rawQuery(`ALTER TABLE ledger.${tabla} DISABLE TRIGGER ${tabla}_inmutable`)
    await trx.rawQuery(sql)
    await trx.rawQuery(`ALTER TABLE ledger.${tabla} ENABLE TRIGGER ${tabla}_inmutable`)
    await trx.commit()
}

test.group('ledger · cadena de hash', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('el sellador encadena por empresa en orden de id y no vuelve a sellar', async ({ assert }) => {
        const e = await prepararEmpresas()
        const a1 = await new RegistrarAsiento().execute(ajuste(e.B, '2026-10-02', 'uno'), e.ctx)
        const a2 = await new RegistrarAsiento().execute(ajuste(e.B, '2026-09-20', 'dos', '2.50'), e.ctx)
        await new RegistrarAsiento().execute(ajuste(e.C, '2026-10-02', 'otra empresa'), e.ctx)

        const salida = await new SellarAsientos().execute({ empresa_id: e.B }, e.ctx)
        assert.equal(salida.empresas.length, 1)
        const cadena = await sellos(e.B)
        assert.deepEqual(
            cadena.map((s) => s.sello),
            cadena.map((_, i) => i + 1),
        )
        assert.equal(cadena[0]!.hash_anterior, HASH_INICIAL)
        for (let i = 1; i < cadena.length; i++) assert.equal(cadena[i]!.hash_anterior, cadena[i - 1]!.hash)
        assert.isTrue(cadena.every((s) => s.version === 'v1'))
        const ids = cadena.map((s) => Number(s.asiento_id))
        assert.deepEqual(
            ids,
            [...ids].sort((x, y) => x - y),
        )
        assert.includeMembers(ids, [a1.id, a2.id])
        // la otra empresa tiene su propia cadena y no se selló en esta corrida
        assert.lengthOf(await sellos(e.C), 0)

        // el hash es SHA-256(anterior ‖ JSON canónico v1)
        const canonicos = await asientosCanonicos(db.connection(), [a2.id])
        const canonico = canonicos.get(a2.id)!
        assert.containSubset(canonico, {
            empresa_id: e.B,
            asiento_id: a2.id,
            fecha: '2026-09-20',
            diario: 'VAR',
            origen_tipo: 'ajuste',
            descripcion: 'dos',
            reversa_de: null,
        })
        assert.deepEqual(canonico.movimientos[0], {
            cuenta_codigo: CUENTAS.GASTO_OTROS,
            debe: '2.50',
            haber: '0.00',
            cliente_id: null,
            proveedor_id: null,
            impuesto_codigo: null,
            cuadricula: null,
        })
        assert.match(
            jsonCanonico(canonico),
            /^\{"asiento_id":\d+,"descripcion":"dos","diario":"VAR","empresa_id":/,
        )
        const selloA2 = cadena.find((s) => Number(s.asiento_id) === a2.id)!
        assert.equal(calcularHash(selloA2.hash_anterior, canonico), selloA2.hash)

        // otra corrida no agrega nada; un asiento nuevo recibe el sello siguiente
        const repetida = await new SellarAsientos().execute({ empresa_id: e.B }, e.ctx)
        assert.deepEqual(repetida.empresas, [])
        const a3 = await new RegistrarAsiento().execute(ajuste(e.B, '2026-08-01', 'tarde'), e.ctx)
        await new SellarAsientos().execute({ empresa_id: e.B }, e.ctx)
        const despues = await sellos(e.B)
        assert.deepEqual(despues.slice(0, cadena.length), cadena)
        assert.equal(Number(despues.at(-1)!.asiento_id), a3.id)
        assert.equal(despues.at(-1)!.sello, cadena.length + 1)

        const verificada = await verificarCadena(e.B)
        assert.containSubset(verificada, {
            verificado: true,
            sellos: despues.length,
            verificados: despues.length,
            sin_sellar: 0,
            primer_sello: 1,
            ultimo_sello: despues.length,
            primer_hash: despues[0]!.hash,
            ultimo_hash: despues.at(-1)!.hash,
            ruptura: null,
        })
    })

    test('la base rechaza editar, borrar o bifurcar la cadena', async ({ assert }) => {
        const e = await prepararEmpresas()
        const a1 = await new RegistrarAsiento().execute(ajuste(e.B, '2026-10-02', 'uno'), e.ctx)
        const a2 = await new RegistrarAsiento().execute(ajuste(e.B, '2026-10-02', 'dos'), e.ctx)
        await new SellarAsientos().execute({ empresa_id: e.B, limite: 1 }, e.ctx)
        const [primero] = await sellos(e.B)
        const pendiente = [a1.id, a2.id].find((id) => id !== Number(primero!.asiento_id)) ?? a2.id
        for (const sql of [
            `UPDATE ledger.asientos_sellos SET hash = repeat('a', 64) WHERE empresa_id = ${e.B}`,
            `DELETE FROM ledger.asientos_sellos WHERE empresa_id = ${e.B}`,
            // no encadena con el último sello
            `INSERT INTO ledger.asientos_sellos (asiento_id, empresa_id, sello, hash_anterior, hash)
             VALUES (${pendiente}, ${e.B}, 2, repeat('0', 64), repeat('b', 64))`,
            // salta un sello
            `INSERT INTO ledger.asientos_sellos (asiento_id, empresa_id, sello, hash_anterior, hash)
             VALUES (${pendiente}, ${e.B}, 3, '${primero!.hash}', repeat('b', 64))`,
            // asiento de otra empresa
            `INSERT INTO ledger.asientos_sellos (asiento_id, empresa_id, sello, hash_anterior, hash)
             VALUES (${pendiente}, ${e.C}, 1, repeat('0', 64), repeat('b', 64))`,
        ]) {
            const trx = await db.transaction()
            await assert.rejects(() => trx.rawQuery(sql))
            await trx.rollback()
        }
    })

    test('alterar un asiento o un movimiento como dueño rompe la cadena en ese sello; avisa una vez y el cierre responde 409', async ({
        assert,
        client,
    }) => {
        const e = await prepararEmpresas()
        const viejo = await new RegistrarAsiento().execute(ajuste(e.B, '2026-07-10', 'julio'), e.ctx)
        const ultimo = await new RegistrarAsiento().execute(ajuste(e.B, '2026-07-12', 'julio dos'), e.ctx)
        await new SellarAsientos().execute({ empresa_id: e.B }, e.ctx)
        const cadena = await sellos(e.B)
        const selloViejo = cadena.find((s) => Number(s.asiento_id) === viejo.id)!
        const selloUltimo = cadena.find((s) => Number(s.asiento_id) === ultimo.id)!

        // la descripción del asiento
        await alterarComoDueno(
            `UPDATE ledger.asientos SET descripcion = 'alterado' WHERE id = ${viejo.id}`,
            'asientos',
        )
        const rota = await verificarCadena(e.B)
        assert.isFalse(rota.verificado)
        assert.containSubset(rota.ruptura, {
            sello: selloViejo.sello,
            asiento_id: viejo.id,
            motivo: 'hash_distinto',
            esperado: selloViejo.hash,
        })
        assert.notEqual(rota.ruptura!.obtenido, selloViejo.hash)

        // por la API: la primera ruptura, en la sección de la empresa
        const respuesta = await estado(
            client.get('/api/v1/libro/integridad').bearerToken(e.token).header('X-Empresa-Id', String(e.B)),
            200,
        )
        const [seccion] = respuesta.body().data
        assert.containSubset(seccion, {
            empresa_id: e.B,
            verificado: false,
            ruptura: { sello: selloViejo.sello, motivo: 'hash_distinto' },
        })
        // con un rango que no incluye el asiento alterado, el resto verifica
        const otroMes = await estado(
            client
                .get('/api/v1/libro/integridad')
                .qs({ desde: '2026-07-11', hasta: '2026-07-31' })
                .bearerToken(e.token)
                .header('X-Empresa-Id', String(e.B)),
            200,
        )
        assert.containSubset(otroMes.body().data[0], { verificado: true, ultimo_hash: selloUltimo.hash })

        // el cierre del mes no se hace con la cadena rota
        const cierre = await errorDe(
            new CerrarPeriodo().execute({ empresa_id: e.B, anio: 2026, mes: 7 }, e.ctx),
        )
        assert.equal(cierre.status, 409)
        assert.equal(cierre.codigo, 'integridad_rota')

        // la verificación diaria avisa una vez por sello
        const marca = (await db.from('audit.outbox').max('id as id').first()) as { id: number }
        await new VerificarIntegridad().execute({ empresa_id: e.B }, e.ctx)
        await new VerificarIntegridad().execute({ empresa_id: e.B }, e.ctx)
        const avisos = await db
            .from('audit.outbox')
            .where('evento', 'libro.integridad_rota')
            .where('id', '>', marca.id ?? 0)
        assert.lengthOf(avisos, 1)
        assert.deepEqual(avisos[0].payload, {
            empresa_id: e.B,
            sello: selloViejo.sello,
            asiento_id: viejo.id,
            esperado: selloViejo.hash,
            obtenido: rota.ruptura!.obtenido,
        })

        // se restaura la fila: la cadena vuelve a verificar
        await alterarComoDueno(
            `UPDATE ledger.asientos SET descripcion = 'julio' WHERE id = ${viejo.id}`,
            'asientos',
        )
        assert.isTrue(await verificarCadena(e.B).then((r) => r.verificado))

        // un monto del último asiento: el sellador lo detecta al encadenar y avisa
        await alterarComoDueno(
            `UPDATE ledger.movimientos SET debe = debe + 1 WHERE asiento_id = ${ultimo.id} AND debe > 0`,
            'movimientos',
        )
        await alterarComoDueno(
            `UPDATE ledger.movimientos SET haber = haber + 1 WHERE asiento_id = ${ultimo.id} AND haber > 0`,
            'movimientos',
        )
        await new RegistrarAsiento().execute(ajuste(e.B, '2026-07-20', 'siguiente'), e.ctx)
        const sellador = await new SellarAsientos().execute({ empresa_id: e.B }, e.ctx)
        assert.containSubset(sellador.rupturas, [
            { empresa_id: e.B, sello: selloUltimo.sello, motivo: 'hash_distinto' },
        ])
        assert.containSubset(await verificarCadena(e.B).then((r) => r.ruptura), { sello: selloUltimo.sello })
        const avisoUltimo = await db
            .from('audit.outbox')
            .where('evento', 'libro.integridad_rota')
            .whereRaw(`(payload->>'sello')::int = ? AND (payload->>'empresa_id')::bigint = ?`, [
                selloUltimo.sello,
                e.B,
            ])
        assert.lengthOf(avisoUltimo, 1)

        await alterarComoDueno(
            `UPDATE ledger.movimientos SET debe = debe - 1 WHERE asiento_id = ${ultimo.id} AND debe > 0`,
            'movimientos',
        )
        await alterarComoDueno(
            `UPDATE ledger.movimientos SET haber = haber - 1 WHERE asiento_id = ${ultimo.id} AND haber > 0`,
            'movimientos',
        )
        assert.isTrue(await verificarCadena(e.B).then((r) => r.verificado))
    })

    test('cerrar el mes sella lo pendiente y guarda el último hash; el cron sella todo lo pendiente', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        await new RegistrarAsiento().execute(ajuste(e.B, '2026-06-03', 'junio'), e.ctx)
        await new RegistrarAsiento().execute(ajuste(e.B, '2026-06-28', 'junio dos'), e.ctx)
        const cierre = await new CerrarPeriodo().execute({ empresa_id: e.B, anio: 2026, mes: 6 }, e.ctx)
        const cadena = await sellos(e.B)
        assert.isAbove(cadena.length, 0)
        assert.equal(cierre.ultimo_sello, cadena.at(-1)!.sello)
        assert.equal(cierre.ultimo_hash, cadena.at(-1)!.hash)
        assert.equal(await verificarCadena(e.B).then((r) => r.sin_sellar), 0)

        await new RegistrarAsiento().execute(ajuste(e.C, '2026-10-01', 'cron'), e.ctx)
        const corrida = (await ejecutarCron('sellar')) as {
            omitido: boolean
            resultado?: { sellados: number }
        }
        assert.isFalse(corrida.omitido)
        assert.isAbove(corrida.resultado!.sellados, 0)
        const pendientes = await db.rawQuery(
            `SELECT count(*)::int AS n FROM ledger.asientos a
              WHERE NOT EXISTS (SELECT 1 FROM ledger.asientos_sellos s WHERE s.asiento_id = a.id)`,
        )
        assert.equal(pendientes.rows[0].n, 0)
        assert.isTrue(await verificarCadena(e.C).then((r) => r.verificado))
    })

    test('H10: un asiento insertado como dueño en un mes cerrado se sella después y rompe la cadena (asiento_en_mes_cerrado); reabrir y volver a cerrar es legítimo', async ({
        assert,
        client,
    }) => {
        const e = await prepararEmpresas()
        await new RegistrarAsiento().execute(ajuste(e.B, '2026-05-10', 'mayo'), e.ctx)
        const cierre = await new CerrarPeriodo().execute({ empresa_id: e.B, anio: 2026, mes: 5 }, e.ctx)
        await new RegistrarAsiento().execute(ajuste(e.B, '2026-10-02', 'octubre'), e.ctx)

        // como dueño de las tablas: un asiento de mayo (cerrado), saltándose los triggers del periodo
        const trx = await db.transaction()
        try {
            await trx.rawQuery(`ALTER TABLE ledger.asientos DISABLE TRIGGER asientos_validar`)
            await trx.rawQuery(`ALTER TABLE ledger.movimientos DISABLE TRIGGER movimientos_validar`)
            const { rows } = (await trx.rawQuery(
                `INSERT INTO ledger.asientos (empresa_id, fecha, descripcion, origen_tipo)
                 VALUES (?, '2026-05-20', 'inventado en mayo', 'ajuste') RETURNING id`,
                [e.B],
            )) as { rows: Array<{ id: number }> }
            const cuentas = (await trx
                .from('ledger.cuentas')
                .whereIn('codigo', [CUENTAS.GASTO_OTROS, CUENTAS.BANCO_PRINCIPAL])
                .where('pais', 'GT')
                .orderBy('codigo')
                .select('id', 'codigo')) as Array<{ id: number; codigo: string }>
            await trx.rawQuery(
                `INSERT INTO ledger.movimientos (asiento_id, cuenta_id, debe, haber) VALUES (?, ?, 7, 0), (?, ?, 0, 7)`,
                [rows[0]!.id, cuentas[0]!.id, rows[0]!.id, cuentas[1]!.id],
            )
            const sellado = await new SellarAsientos().execute({ empresa_id: e.B }, e.ctx, { trx })
            assert.containSubset(sellado.rupturas, [
                { empresa_id: e.B, asiento_id: rows[0]!.id, motivo: 'asiento_en_mes_cerrado' },
            ])
            const rota = await verificarCadena(e.B, {}, trx)
            assert.isFalse(rota.verificado)
            assert.containSubset(rota.ruptura, { asiento_id: rows[0]!.id, motivo: 'asiento_en_mes_cerrado' })
            const aviso = await trx
                .from('audit.outbox')
                .where('evento', 'libro.integridad_rota')
                .whereRaw(`(payload->>'asiento_id')::bigint = ?`, [rows[0]!.id])
            assert.lengthOf(aviso, 1)
            // el rango por sello: hasta el último sello del cierre la cadena verifica
            const hastaCierre = await verificarCadena(e.B, { hasta_sello: cierre.ultimo_sello }, trx)
            assert.isTrue(hastaCierre.verificado)
            assert.equal(hastaCierre.ultimo_sello, cierre.ultimo_sello)
        } finally {
            await trx.rollback()
        }

        // reabrir mayo, agregar un asiento y volver a cerrar: no es una inserción en el pasado
        await new ReabrirPeriodo().execute({ empresa_id: e.B, anio: 2026, mes: 5, motivo: 'ajuste' }, e.ctx)
        await new RegistrarAsiento().execute(ajuste(e.B, '2026-05-25', 'mayo reabierto'), e.ctx)
        await new CerrarPeriodo().execute({ empresa_id: e.B, anio: 2026, mes: 5 }, e.ctx)
        assert.isTrue(await verificarCadena(e.B).then((r) => r.verificado))

        const porSello = await estado(
            client
                .get('/api/v1/libro/integridad')
                .qs({ desde_sello: 2, hasta_sello: 3 })
                .bearerToken(e.token)
                .header('X-Empresa-Id', String(e.B)),
            200,
        )
        assert.containSubset(porSello.body().data[0], { verificado: true, primer_sello: 2, ultimo_sello: 3 })
    })
})
