import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado } from '#tests/ledger/ayudas_libro'
import {
    bancoId,
    cuentaBancariaPrueba,
    escenario,
    eventosDe,
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

/** Contrato Iris 0.8.0 (§7.8): `titular`, `tipo` y el evento `cuenta_bancaria.cambiada`. */
test.group('billing · cuentas bancarias · titular, tipo y cuenta_bancaria.cambiada (0.8.0)', () => {
    test('crear sin titular ni tipo (compatibilidad): null y evento con creada: true y todos los campos', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['contabilidad'])
        const creada = await estado(
            client
                .post('/api/v1/cuentas-bancarias')
                .bearerToken(token)
                .json({ banco_id: await bancoId('BAM'), numero: await unicoBd('3080'), alias: 'Vieja' }),
            201,
        )
        assert.containSubset(creada.body(), { titular: null, tipo: null })
        const eventos = await eventosDe('cuenta_bancaria.cambiada', 'cuenta_bancaria_id', creada.body().id)
        assert.lengthOf(eventos, 1)
        assert.deepEqual(eventos[0].payload, {
            cuenta_bancaria_id: creada.body().id,
            empresa_id: creada.body().empresa_id,
            campos: ['banco_id', 'numero', 'alias', 'titular', 'tipo', 'moneda', 'activa'],
            activa: true,
            creada: true,
        })
    })

    test('crear y editar titular y tipo: validación, diff en audit.cambios y evento solo con lo que cambió', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['contabilidad'])
        const base = { banco_id: await bancoId('Banrural'), numero: await unicoBd('3081'), alias: 'Cobros' }
        for (const [extra, campo, rule] of [
            [{ titular: 'X' }, 'titular', 'minLength'],
            [{ titular: 'x'.repeat(121) }, 'titular', 'maxLength'],
            [{ tipo: 'corriente' }, 'tipo', 'enum'],
        ] as const) {
            const r = await client
                .post('/api/v1/cuentas-bancarias')
                .bearerToken(token)
                .json({ ...base, ...extra })
            r.assertStatus(422)
            assert.equal(r.body().errors[0].field, campo)
            assert.equal(r.body().errors[0].rule, rule)
        }
        const creada = await estado(
            client
                .post('/api/v1/cuentas-bancarias')
                .bearerToken(token)
                .json({ ...base, titular: '  Servicios de Internet, S.A.  ', tipo: 'monetaria' }),
            201,
        )
        const id = creada.body().id as number
        assert.containSubset(creada.body(), { titular: 'Servicios de Internet, S.A.', tipo: 'monetaria' })
        const lista = await estado(client.get('/api/v1/cuentas-bancarias').bearerToken(token), 200)
        assert.containSubset(
            lista.body().find((c: { id: number }) => c.id === id),
            { titular: 'Servicios de Internet, S.A.', tipo: 'monetaria' },
        )

        // editar titular y tipo y desactivar
        const editada = await estado(
            client
                .put(`/api/v1/cuentas-bancarias/${id}`)
                .bearerToken(token)
                .json({ version: 1, titular: 'Otra Razón, S.A.', tipo: 'ahorro', activa: false }),
            200,
        )
        assert.containSubset(editada.body(), { titular: 'Otra Razón, S.A.', tipo: 'ahorro', activa: false })
        // ausente = sin cambio; solo el alias
        await estado(
            client
                .put(`/api/v1/cuentas-bancarias/${id}`)
                .bearerToken(token)
                .json({ version: 2, alias: 'Cobros 2' }),
            200,
        )
        // null borra el dato
        const borrada = await estado(
            client
                .put(`/api/v1/cuentas-bancarias/${id}`)
                .bearerToken(token)
                .json({ version: 3, titular: null }),
            200,
        )
        assert.containSubset(borrada.body(), { titular: null, tipo: 'ahorro', alias: 'Cobros 2' })
        // sin cambios: no hay evento
        await estado(
            client
                .put(`/api/v1/cuentas-bancarias/${id}`)
                .bearerToken(token)
                .json({ version: 4, tipo: 'ahorro' }),
            200,
        )

        const eventos = await eventosDe('cuenta_bancaria.cambiada', 'cuenta_bancaria_id', id)
        assert.deepEqual(
            eventos.map((e) => [e.payload.campos, e.payload.activa, e.payload.creada]),
            [
                [['banco_id', 'numero', 'alias', 'titular', 'tipo', 'moneda', 'activa'], true, true],
                [['titular', 'tipo', 'activa'], false, false],
                [['alias'], false, false],
                [['titular'], false, false],
            ],
        )
        for (const e of eventos) {
            assert.equal(e.payload.empresa_id, creada.body().empresa_id)
            assert.equal(e.payload.cuenta_bancaria_id, id)
        }

        const cambios = await db
            .from('audit.cambios')
            .where('entidad_tipo', 'cuenta_bancaria')
            .where('entidad_id', id)
            .whereIn('campo', ['titular', 'tipo'])
            .orderBy('id', 'asc')
            .select('campo', 'antes', 'despues')
        assert.sameDeepMembers(
            cambios.map((c) => [c.campo, c.antes, c.despues]),
            [
                ['titular', null, 'Servicios de Internet, S.A.'],
                ['tipo', null, 'monetaria'],
                ['titular', 'Servicios de Internet, S.A.', 'Otra Razón, S.A.'],
                ['tipo', 'monetaria', 'ahorro'],
                ['titular', 'Otra Razón, S.A.', null],
            ],
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
