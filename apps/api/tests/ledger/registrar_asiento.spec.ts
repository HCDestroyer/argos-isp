import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Problema } from '#shared/errores'
import RegistrarAsiento, { type EntradaAsiento } from '#ledger/actions/registrar_asiento'
import RevertirAsiento from '#ledger/actions/revertir_asiento'
import { CUENTAS } from '#ledger/plan_cuentas'
import { hoyGuatemala } from '#ledger/fechas'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado, cerrarMes, crearCliente, saldoTexto } from '#tests/ledger/ayudas_libro'

/** Venta de Q112.00 con IVA incluido: CxC / Ingresos + IVA. */
function asientoFactura(clienteId: number, extra: Partial<EntradaAsiento> = {}): EntradaAsiento {
    return {
        fecha: '2026-10-19',
        descripcion: unico('Factura prueba'),
        origen_tipo: 'factura',
        origen_id: 1,
        movimientos: [
            { cuenta: CUENTAS.CXC_CLIENTES, debe: '112.00', cliente_id: clienteId },
            { cuenta: CUENTAS.INGRESOS_INTERNET, haber: '100.00' },
            { cuenta: CUENTAS.IVA_DEBITO, haber: '12.00' },
        ],
        ...extra,
    }
}

/** Espera un Problema con el status y el código (`type`) dados. */
async function problema(promesa: Promise<unknown>, status: number, codigo: string): Promise<Problema> {
    try {
        await promesa
    } catch (error) {
        if (!(error instanceof Problema)) throw error
        if (error.status !== status || !error.tipo.endsWith(`:${codigo}`)) {
            throw new Error(
                `Se esperaba ${status} ${codigo} y llegó ${error.status} ${error.tipo}: ${error.message}`,
            )
        }
        return error
    }
    throw new Error(`Se esperaba el error ${codigo} y la acción terminó bien`)
}

/** Igual que RegistrarAsiento pero sin la validación de cuadre en TypeScript. */
class RegistrarSinValidarCuadre extends RegistrarAsiento {
    protected validarCuadre() {
        return undefined as never
    }
}

/** Acción externa que registra dos asientos anidados en la misma transacción. */
class DosAsientos extends DomainAction<{ clienteId: number; descripcion: string }, number[]> {
    readonly nombre = 'libro.registrar_asiento'
    protected async handle(input: { clienteId: number; descripcion: string }, t: Transaccion) {
        const ids: number[] = []
        for (let i = 0; i < 2; i++) {
            const asiento = await new RegistrarAsiento().execute(
                asientoFactura(input.clienteId, { descripcion: `${input.descripcion}-${i}` }),
                t.ctx,
                { trx: t.trx },
            )
            ids.push(asiento.id)
        }
        return ids
    }
}

test.group('registrarAsiento', () => {
    test('registra un asiento cuadrado con auditoría y el saldo del cliente sale del auxiliar CxC', async ({
        assert,
    }) => {
        const clienteId = await crearCliente()
        const ctx = contextoPrueba()
        const asiento = await new RegistrarAsiento().execute(asientoFactura(clienteId), ctx)

        assert.equal(asiento.total, '112.00')
        assert.equal(asiento.fecha, '2026-10-19')
        assert.lengthOf(asiento.movimientos, 3)
        assert.deepEqual(
            asiento.movimientos.map((m) => [m.cuenta_codigo, m.debe, m.haber, m.cliente_id]),
            [
                [CUENTAS.CXC_CLIENTES, '112.00', '0.00', clienteId],
                [CUENTAS.INGRESOS_INTERNET, '0.00', '100.00', null],
                [CUENTAS.IVA_DEBITO, '0.00', '12.00', null],
            ],
        )

        const auditoria = await db
            .from('audit.acciones')
            .where('request_id', ctx.requestId)
            .where('accion', 'libro.registrar_asiento')
            .firstOrFail()
        assert.equal(auditoria.resultado, 'ok')
        assert.equal(auditoria.entidad_tipo, 'asiento')
        assert.equal(auditoria.entidad_id, asiento.id)

        assert.equal(await saldoTexto(clienteId), '112.00')
        await afirmarLibroCuadrado(assert)
    })

    test('la fecha contable por defecto es hoy en Guatemala', async ({ assert }) => {
        const clienteId = await crearCliente()
        const sinFecha = asientoFactura(clienteId)
        delete sinFecha.fecha
        const asiento = await new RegistrarAsiento().execute(sinFecha, contextoPrueba())
        assert.equal(asiento.fecha, hoyGuatemala())
        assert.equal(hoyGuatemala(new Date('2026-11-01T05:30:00Z')), '2026-10-31')
    })

    test('descuadrado → 422 visible, no se escribe nada y el error queda auditado', async ({ assert }) => {
        const clienteId = await crearCliente()
        const ctx = contextoPrueba()
        const entrada = asientoFactura(clienteId, {
            movimientos: [
                { cuenta: CUENTAS.CXC_CLIENTES, debe: '112.00', cliente_id: clienteId },
                { cuenta: CUENTAS.INGRESOS_INTERNET, haber: '100.00' },
                { cuenta: CUENTAS.IVA_DEBITO, haber: '11.99' },
            ],
        })
        const error = await problema(new RegistrarAsiento().execute(entrada, ctx), 422, 'asiento_descuadrado')
        assert.match(error.message, /debe 112\.00 <> haber 111\.99/)

        assert.isNull(await db.from('ledger.asientos').where('descripcion', entrada.descripcion).first())
        const auditoria = await db.from('audit.acciones').where('request_id', ctx.requestId).firstOrFail()
        assert.equal(auditoria.resultado, 'error')
        assert.match(auditoria.error, /descuadrado/)
        await afirmarLibroCuadrado(assert)
    })

    test('sin la validación en TypeScript, la base de datos rechaza el descuadre dentro de la acción', async ({
        assert,
    }) => {
        const clienteId = await crearCliente()
        const entrada = asientoFactura(clienteId, {
            movimientos: [
                { cuenta: CUENTAS.CXC_CLIENTES, debe: '100.00', cliente_id: clienteId },
                { cuenta: CUENTAS.INGRESOS_INTERNET, haber: '90.00' },
            ],
        })

        let error: unknown
        try {
            await new RegistrarSinValidarCuadre().execute(entrada, contextoPrueba())
        } catch (e) {
            error = e
        }
        assert.exists(error, 'el descuadre debió fallar con un error visible')
        assert.equal((error as { code?: string }).code, '23514')
        assert.match((error as Error).message, /descuadrado: debe 100\.00 <> haber 90\.00/)
        assert.isNull(await db.from('ledger.asientos').where('descripcion', entrada.descripcion).first())

        // anidada en otra acción: el error también sale (no se pierde en el COMMIT)
        const descripcion = unico('anidado')
        class Externa extends DomainAction<void, void> {
            readonly nombre = 'libro.registrar_asiento'
            protected async handle(_input: void, t: Transaccion) {
                await new RegistrarSinValidarCuadre().execute({ ...entrada, descripcion }, t.ctx, {
                    trx: t.trx,
                })
            }
        }
        await assert.rejects(() => new Externa().execute(undefined, contextoPrueba()), /descuadrado/)
        assert.isNull(await db.from('ledger.asientos').where('descripcion', descripcion).first())
        await afirmarLibroCuadrado(assert)
    })

    test('varios asientos anidados en la misma transacción', async ({ assert }) => {
        const clienteId = await crearCliente()
        const ids = await new DosAsientos().execute(
            { clienteId, descripcion: unico('doble') },
            contextoPrueba(),
        )
        assert.lengthOf(ids, 2)
        assert.equal(await saldoTexto(clienteId), '224.00')
        await afirmarLibroCuadrado(assert)
    })

    test('valida movimientos: mínimo 2, un solo lado, centavos, cuentas y auxiliar por cliente', async ({
        assert,
    }) => {
        const clienteId = await crearCliente()
        const ctx = contextoPrueba()
        const accion = new RegistrarAsiento()
        const con = (movimientos: EntradaAsiento['movimientos']) =>
            accion.execute(asientoFactura(clienteId, { movimientos }), ctx)

        await problema(
            con([{ cuenta: CUENTAS.CXC_CLIENTES, debe: '1.00', cliente_id: clienteId }]),
            422,
            'asiento_descuadrado',
        )

        const campos = async (promesa: Promise<unknown>) => {
            const error = await problema(promesa, 422, 'validacion')
            return (error.errores ?? []).map((e) => e.message).join(' | ')
        }

        assert.match(
            await campos(
                con([
                    { cuenta: CUENTAS.CXC_CLIENTES, debe: '10.00', haber: '10.00', cliente_id: clienteId },
                    { cuenta: CUENTAS.INGRESOS_INTERNET, haber: '0' },
                ]),
            ),
            /exactamente uno de debe o haber/,
        )
        assert.match(
            await campos(
                con([
                    { cuenta: CUENTAS.CXC_CLIENTES, debe: '10.005', cliente_id: clienteId },
                    { cuenta: CUENTAS.INGRESOS_INTERNET, haber: '10.005' },
                ]),
            ),
            /2 decimales/,
        )
        assert.match(
            await campos(
                con([
                    { cuenta: CUENTAS.CAJAS, debe: '10.00' },
                    { cuenta: CUENTAS.INGRESOS_INTERNET, haber: '10.00' },
                ]),
            ),
            /agrupación/,
        )
        assert.match(
            await campos(
                con([
                    { cuenta: CUENTAS.CXC_CLIENTES, debe: '10.00' },
                    { cuenta: CUENTAS.INGRESOS_INTERNET, haber: '10.00' },
                ]),
            ),
            /falta cliente_id/,
        )
        assert.match(
            await campos(
                con([
                    { cuenta: '9.9.9.no-existe', debe: '10.00' },
                    { cuenta: CUENTAS.INGRESOS_INTERNET, haber: '10.00' },
                ]),
            ),
            /no existe/,
        )
        const sinOrigen = await problema(
            accion.execute(asientoFactura(clienteId, { origen_id: null }), ctx),
            422,
            'validacion',
        )
        assert.equal(sinOrigen.errores?.[0]?.field, 'origen_id')
        await afirmarLibroCuadrado(assert)
    })

    test('la base de datos rechaza movimientos en cuentas de agrupación, inactivas o sin cliente en CxC', async ({
        assert,
    }) => {
        const cuentas = new Map(
            (
                (await db.from('ledger.cuentas').select('id', 'codigo')) as Array<{
                    id: number
                    codigo: string
                }>
            ).map((c) => [c.codigo, c.id]),
        )
        const [inactiva] = (await db
            .insertQuery()
            .table('ledger.cuentas')
            .insert({ codigo: unico('9.8'), nombre: 'Inactiva', tipo: 'activo', activa: false })
            .returning('id')) as Array<{ id: number }>

        const insertar = (cuentaId: number) =>
            db.transaction(async (trx) => {
                const [asiento] = (await trx
                    .insertQuery()
                    .table('ledger.asientos')
                    .insert({ fecha: '2026-10-19', descripcion: unico('raw'), origen_tipo: 'ajuste' })
                    .returning('id')) as Array<{ id: number }>
                await trx
                    .insertQuery()
                    .table('ledger.movimientos')
                    .multiInsert([
                        { asiento_id: asiento!.id, cuenta_id: cuentaId, debe: '5.00', haber: 0 },
                        {
                            asiento_id: asiento!.id,
                            cuenta_id: cuentas.get(CUENTAS.OTROS_INGRESOS)!,
                            debe: 0,
                            haber: '5.00',
                        },
                    ])
            })

        await assert.rejects(() => insertar(cuentas.get(CUENTAS.CAJAS)!), /agrupación/)
        await assert.rejects(() => insertar(inactiva!.id), /inactiva/)
        await assert.rejects(() => insertar(cuentas.get(CUENTAS.CXC_CLIENTES)!), /falta cliente_id/)
        await assert.rejects(
            () =>
                db
                    .insertQuery()
                    .table('ledger.asientos')
                    .insert({
                        fecha: '2026-10-19',
                        descripcion: unico('sin origen'),
                        origen_tipo: 'pago',
                    }),
            /asientos_origen_obligatorio/,
        )
    })

    test('periodo cerrado: la acción y la base de datos rechazan asientos con fecha en el mes cerrado', async ({
        assert,
    }) => {
        await cerrarMes('2020-01-01')
        const clienteId = await crearCliente()
        const error = await problema(
            new RegistrarAsiento().execute(
                asientoFactura(clienteId, { fecha: '2020-01-31' }),
                contextoPrueba(),
            ),
            422,
            'periodo_cerrado',
        )
        assert.match(error.message, /Periodo 2020-01 cerrado/)

        await assert.rejects(
            () =>
                db
                    .insertQuery()
                    .table('ledger.asientos')
                    .insert({
                        fecha: '2020-01-15',
                        descripcion: unico('raw'),
                        origen_tipo: 'ajuste',
                    }),
            /Periodo 2020-01 cerrado/,
        )

        const febrero = await new RegistrarAsiento().execute(
            asientoFactura(clienteId, { fecha: '2020-02-01' }),
            contextoPrueba(),
        )
        assert.equal(febrero.fecha, '2020-02-01')
        await afirmarLibroCuadrado(assert)
    })

    test('el rol de la app no tiene UPDATE, DELETE ni TRUNCATE sobre el libro (REVOKE)', async ({
        assert,
    }) => {
        const rol = await db.from('pg_roles').where('rolname', 'argosisp_app').first()
        if (!rol) {
            assert.isTrue(true, 'sin rol argosisp_app en este clúster')
            return
        }
        for (const tabla of ['ledger.asientos', 'ledger.movimientos']) {
            const resultado = await db.rawQuery(
                `SELECT has_table_privilege('argosisp_app', ?, 'INSERT') AS insertar,
                            has_table_privilege('argosisp_app', ?, 'SELECT') AS leer,
                            has_table_privilege('argosisp_app', ?, 'UPDATE') AS actualizar,
                            has_table_privilege('argosisp_app', ?, 'DELETE') AS borrar,
                            has_table_privilege('argosisp_app', ?, 'TRUNCATE') AS truncar`,
                [tabla, tabla, tabla, tabla, tabla],
            )
            const privilegios = resultado.rows[0]
            assert.deepEqual(
                privilegios,
                { insertar: true, leer: true, actualizar: false, borrar: false, truncar: false },
                tabla,
            )
        }
    })
})

test.group('revertirAsiento', () => {
    test('crea el asiento espejo, deja el saldo en cero y no permite revertir dos veces', async ({
        assert,
    }) => {
        const clienteId = await crearCliente()
        const original = await new RegistrarAsiento().execute(asientoFactura(clienteId), contextoPrueba())
        const reverso = await new RevertirAsiento().execute(
            { asiento_id: original.id, motivo: 'factura mal emitida', fecha: '2026-10-20' },
            contextoPrueba(),
        )

        assert.equal(reverso.reversa_de, original.id)
        assert.equal(reverso.origen_tipo, 'factura')
        assert.equal(reverso.origen_id, 1)
        assert.match(reverso.descripcion, /^Reverso del asiento \d+: factura mal emitida$/)
        assert.deepEqual(
            reverso.movimientos.map((m) => [m.cuenta_codigo, m.debe, m.haber, m.cliente_id]),
            original.movimientos.map((m) => [m.cuenta_codigo, m.haber, m.debe, m.cliente_id]),
        )
        assert.equal(await saldoTexto(clienteId), '0.00')

        await problema(
            new RevertirAsiento().execute({ asiento_id: original.id, motivo: 'otra vez' }, contextoPrueba()),
            422,
            'asiento_revertido',
        )
        await problema(
            new RevertirAsiento().execute(
                { asiento_id: reverso.id, motivo: 'revertir reverso' },
                contextoPrueba(),
            ),
            422,
            'asiento_es_reverso',
        )
        await problema(
            new RevertirAsiento().execute({ asiento_id: 999_999_999, motivo: 'no existe' }, contextoPrueba()),
            404,
            'no_encontrado',
        )
        await afirmarLibroCuadrado(assert)
    })

    test('un asiento de un mes cerrado se revierte con fecha de un mes abierto, nunca dentro del cerrado', async ({
        assert,
    }) => {
        const clienteId = await crearCliente()
        const original = await new RegistrarAsiento().execute(
            asientoFactura(clienteId, { fecha: '2020-03-10' }),
            contextoPrueba(),
        )
        await cerrarMes('2020-03-01')

        await problema(
            new RevertirAsiento().execute(
                { asiento_id: original.id, motivo: 'dentro del cerrado', fecha: '2020-03-31' },
                contextoPrueba(),
            ),
            422,
            'periodo_cerrado',
        )
        const reverso = await new RevertirAsiento().execute(
            { asiento_id: original.id, motivo: 'en mes abierto', fecha: '2020-04-01' },
            contextoPrueba(),
        )
        assert.equal(reverso.fecha, '2020-04-01')
        await afirmarLibroCuadrado(assert)
    })
})

test.group('Libro diario y mayor (API)', () => {
    test('GET /libro/diario devuelve asientos con movimientos y filtra por fecha y origen', async ({
        client,
        assert,
    }) => {
        const clienteId = await crearCliente()
        const asiento = await new RegistrarAsiento().execute(
            asientoFactura(clienteId, { fecha: '2021-05-05', origen_tipo: 'mora', origen_id: 7 }),
            contextoPrueba(),
        )
        const { token } = await usuarioConRoles(['contabilidad'])
        const respuesta = await estado(
            client
                .get('/api/v1/libro/diario')
                .qs({ desde: '2021-05-01', hasta: '2021-05-31', origen_tipo: 'mora' })
                .bearerToken(token),
            200,
        )
        const cuerpo = respuesta.body()
        const encontrado = cuerpo.data.find((a: { id: number }) => a.id === asiento.id)
        assert.exists(encontrado)
        assert.equal(encontrado.fecha, '2021-05-05')
        assert.equal(encontrado.reversa_de, null)
        assert.lengthOf(encontrado.movimientos, 3)
        assert.equal(encontrado.movimientos[0].cuenta_codigo, CUENTAS.CXC_CLIENTES)
        assert.isTrue(cuerpo.data.every((a: { origen_tipo: string }) => a.origen_tipo === 'mora'))
    })

    test('GET /libro/mayor: auxiliar del cliente con saldo acumulado consistente entre páginas', async ({
        client,
        assert,
    }) => {
        const clienteId = await crearCliente()
        const ctx = contextoPrueba()
        await new RegistrarAsiento().execute(asientoFactura(clienteId, { fecha: '2021-06-01' }), ctx)
        await new RegistrarAsiento().execute(asientoFactura(clienteId, { fecha: '2021-07-01' }), ctx)
        await new RegistrarAsiento().execute(
            {
                fecha: '2021-07-02',
                descripcion: unico('pago'),
                origen_tipo: 'pago',
                origen_id: 1,
                movimientos: [
                    { cuenta: CUENTAS.CAJA_PRINCIPAL, debe: '50.00' },
                    { cuenta: CUENTAS.CXC_CLIENTES, haber: '50.00', cliente_id: clienteId },
                ],
            },
            ctx,
        )
        const cxc = await db.from('ledger.cuentas').where('codigo', CUENTAS.CXC_CLIENTES).firstOrFail()
        const { token } = await usuarioConRoles(['contabilidad'])
        const mayor = async (qs: Record<string, unknown>) => {
            const respuesta = await estado(client.get('/api/v1/libro/mayor').qs(qs).bearerToken(token), 200)
            return respuesta.body()
        }

        const completo = await mayor({ cuenta_id: cxc.id, cliente_id: clienteId })
        assert.equal(completo.saldo_inicial, '0.00')
        assert.equal(completo.saldo_final, '174.00')
        assert.deepEqual(
            completo.data.map((l: { saldo: string }) => l.saldo),
            ['112.00', '224.00', '174.00'],
        )

        const desdeJulio = await mayor({
            cuenta_id: cxc.id,
            cliente_id: clienteId,
            desde: '2021-07-01',
            limit: 1,
        })
        assert.equal(desdeJulio.saldo_inicial, '112.00')
        assert.deepEqual(
            desdeJulio.data.map((l: { saldo: string }) => l.saldo),
            ['224.00'],
        )
        const segunda = await mayor({
            cuenta_id: cxc.id,
            cliente_id: clienteId,
            desde: '2021-07-01',
            limit: 1,
            cursor: desdeJulio.nextCursor,
        })
        assert.deepEqual(
            segunda.data.map((l: { saldo: string }) => l.saldo),
            ['174.00'],
        )
        assert.isNull(segunda.nextCursor)
    })
})
