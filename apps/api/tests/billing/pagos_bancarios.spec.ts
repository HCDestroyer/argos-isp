import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado } from '#tests/ledger/ayudas_libro'
import {
    bancoId,
    cuentaBancariaPrueba,
    escenario,
    generar,
    lineasAsiento,
    unicoBd,
} from '#tests/billing/ayudas_billing'

/**
 * Métodos bancarios (decisión del PM 2026-10-16): depósito, transferencia, ACH y remesa con
 * cuentas bancarias propias (cada una con su subcuenta de Bancos) y catálogo de bancos.
 */

test.group('billing · bancos y cuentas bancarias', () => {
    test('GET /bancos: catálogo de Guatemala sin duplicados, "Otro" al final', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['cajero'])
        const respuesta = await estado(client.get('/api/v1/bancos').bearerToken(token), 200)
        const nombres = respuesta.body().map((b: { nombre: string }) => b.nombre)
        assert.includeMembers(nombres, [
            'Banrural',
            'Banco Industrial',
            'Banco G&T Continental',
            'BAM',
            'BAC Credomatic',
            'Bantrab',
            'Crédito Hipotecario Nacional',
            'Banco Nexa',
        ])
        assert.equal(nombres.at(-1), 'Otro')
        assert.equal(new Set(nombres).size, nombres.length)
    })

    test('crear y editar cuentas bancarias: subcuenta de Bancos, auditoría, permisos y versión', async ({
        client,
        assert,
    }) => {
        const { token: contador } = await usuarioConRoles(['contabilidad'])
        const { token: cajero } = await usuarioConRoles(['cajero'])
        const numero = await unicoBd('3011')
        const cuerpo = { banco_id: await bancoId('Banco Industrial'), numero, alias: 'Recaudación' }

        await estado(client.post('/api/v1/cuentas-bancarias').bearerToken(cajero).json(cuerpo), 403)
        const creada = await estado(
            client.post('/api/v1/cuentas-bancarias').bearerToken(contador).json(cuerpo),
            201,
        )
        assert.containSubset(creada.body(), {
            banco_nombre: 'Banco Industrial',
            numero,
            alias: 'Recaudación',
            moneda: 'GTQ',
            activa: true,
            version: 1,
        })
        assert.match(creada.body().cuenta_codigo, /^1\.1\.02\.\d{2,}$/)
        const cuenta = await db.from('ledger.cuentas').where('id', creada.body().cuenta_id).firstOrFail()
        assert.equal(cuenta.nombre, `Banco Industrial · Recaudación (****${numero.slice(-4)})`)
        assert.isTrue(cuenta.imputable)
        await estado(client.post('/api/v1/cuentas-bancarias').bearerToken(contador).json(cuerpo), 409)

        // el cajero las lista para elegir el destino del cobro
        const lista = await estado(client.get('/api/v1/cuentas-bancarias').bearerToken(cajero), 200)
        assert.include(
            lista.body().map((c: { id: number }) => c.id),
            creada.body().id,
        )

        const editada = await estado(
            client
                .put(`/api/v1/cuentas-bancarias/${creada.body().id}`)
                .bearerToken(contador)
                .json({ version: 1, alias: 'Depósitos', activa: false }),
            200,
        )
        assert.containSubset(editada.body(), { alias: 'Depósitos', activa: false, version: 2 })
        await estado(
            client
                .put(`/api/v1/cuentas-bancarias/${creada.body().id}`)
                .bearerToken(contador)
                .json({ version: 1, alias: 'Otra' }),
            409,
        )
        const inactivas = await estado(
            client.get('/api/v1/cuentas-bancarias').qs({ activa: false }).bearerToken(cajero),
            200,
        )
        assert.include(
            inactivas.body().map((c: { id: number }) => c.id),
            creada.body().id,
        )
        const cambios = await db
            .from('audit.cambios')
            .where('entidad_tipo', 'cuenta_bancaria')
            .where('entidad_id', creada.body().id)
            .where('campo', 'alias')
            .orderBy('id', 'asc')
            .select('antes', 'despues')
        assert.deepEqual(
            cambios.map((c) => c.despues),
            ['Recaudación', 'Depósitos'],
        )
    })
})

test.group('billing · pagos bancarios', () => {
    test('un pago de cada método va a la subcuenta de la cuenta de destino', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['cajero'])
        const { clienteId, servicioId } = await escenario({ precio: '400.00' })
        await generar(servicioId, '2026-09-01')
        const cuenta = await cuentaBancariaPrueba()
        const otra = await cuentaBancariaPrueba('BAM')
        const origen = await bancoId('Banco G&T Continental')

        const casos = [
            { metodo: 'deposito', cuenta_bancaria_id: cuenta.id, referencia: await unicoBd('boleta') },
            {
                metodo: 'transferencia',
                cuenta_bancaria_id: cuenta.id,
                banco_origen_id: origen,
                referencia: await unicoBd('trf'),
            },
            {
                metodo: 'ach',
                cuenta_bancaria_id: otra.id,
                banco_origen_id: origen,
                referencia: await unicoBd('ach'),
            },
            { metodo: 'remesa', cuenta_bancaria_id: otra.id, referencia: await unicoBd('MTCN') },
        ]
        for (const caso of casos) {
            const respuesta = await estado(
                client
                    .post('/api/v1/pagos')
                    .bearerToken(token)
                    .header('Idempotency-Key', unico('pago'))
                    .json({ cliente_id: clienteId, monto: '100.00', ...caso }),
                201,
            )
            const pago = respuesta.body()
            const destino = caso.cuenta_bancaria_id === cuenta.id ? cuenta : otra
            assert.containSubset(pago, {
                metodo: caso.metodo,
                cuenta_bancaria_id: destino.id,
                cuenta_bancaria_nombre: `${destino.banco_nombre} · ${destino.alias}`,
                banco_origen_id: caso.banco_origen_id ?? null,
                banco_origen_nombre: caso.banco_origen_id ? 'Banco G&T Continental' : null,
                caja_id: null,
            })
            assert.deepEqual(await lineasAsiento('pago', pago.id), [
                [destino.cuenta_codigo, '100.00', '0.00', null],
                ['1.1.03', '0.00', '100.00', clienteId],
            ])
            const [evento] = await db
                .from('audit.outbox')
                .where('evento', 'pago.registrado')
                .whereRaw(`(payload->>'pago_id')::bigint = ?`, [pago.id])
                .orderBy('id', 'asc')
            assert.equal(evento.payload.metodo, caso.metodo)
            await afirmarLibroCuadrado(assert)
        }

        const filtrados = await estado(
            client.get('/api/v1/pagos').qs({ metodo: 'remesa', cliente_id: clienteId }).bearerToken(token),
            200,
        )
        assert.lengthOf(filtrados.body().data, 1)
    })

    test('faltan datos → 422 por campo; referencia repetida en la misma cuenta y método → 409', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['cajero'])
        const { clienteId } = await escenario()
        const cuenta = await cuentaBancariaPrueba()
        const otra = await cuentaBancariaPrueba()
        const origen = await bancoId()
        const pagar = (cuerpo: Record<string, unknown>) =>
            client
                .post('/api/v1/pagos')
                .bearerToken(token)
                .json({ cliente_id: clienteId, monto: '10.00', ...cuerpo })

        const faltan = await estado(pagar({ metodo: 'transferencia' }), 422)
        assert.sameMembers(
            faltan.body().errors.map((e: { field: string }) => e.field),
            ['banco_origen_id', 'cuenta_bancaria_id', 'referencia'],
        )
        const remesa = await estado(pagar({ metodo: 'remesa', referencia: 'X-1' }), 422)
        assert.deepEqual(
            remesa.body().errors.map((e: { field: string; rule: string }) => [e.field, e.rule]),
            [['cuenta_bancaria_id', 'required']],
        )
        const deposito = await estado(pagar({ metodo: 'deposito', cuenta_bancaria_id: cuenta.id }), 422)
        assert.deepEqual(
            deposito.body().errors.map((e: { field: string }) => e.field),
            ['referencia'],
        )
        const noAplica = await estado(pagar({ metodo: 'caja', cuenta_bancaria_id: cuenta.id }), 422)
        assert.containSubset(noAplica.body().errors, [{ field: 'cuenta_bancaria_id', rule: 'no_aplica' }])
        const inexistente = await estado(
            pagar({ metodo: 'ach', cuenta_bancaria_id: 999_999, banco_origen_id: 999_999, referencia: 'A' }),
            422,
        )
        assert.sameMembers(
            inexistente.body().errors.map((e: { field: string }) => e.field),
            ['cuenta_bancaria_id', 'banco_origen_id'],
        )

        const referencia = await unicoBd('trf')
        const base = { metodo: 'transferencia', banco_origen_id: origen, referencia }
        await estado(pagar({ ...base, cuenta_bancaria_id: cuenta.id }), 201)
        const repetida = await estado(pagar({ ...base, cuenta_bancaria_id: cuenta.id }), 409)
        assert.equal(repetida.body().type, 'urn:argosisp:problema:referencia_duplicada')
        // misma referencia en otra cuenta o con otro método: es otro pago
        await estado(pagar({ ...base, cuenta_bancaria_id: otra.id }), 201)
        await estado(
            pagar({ metodo: 'ach', banco_origen_id: origen, referencia, cuenta_bancaria_id: cuenta.id }),
            201,
        )
        // la base de datos también lo impide (índice único con NULLS NOT DISTINCT)
        await assert.rejects(() =>
            db.table('billing.pagos').insert({
                cliente_id: clienteId,
                metodo: 'transferencia',
                monto: '1.00',
                referencia,
                cuenta_bancaria_id: cuenta.id,
                banco_origen_id: origen,
            }),
        )
        await afirmarLibroCuadrado(assert)
    })
})
