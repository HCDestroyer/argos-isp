import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba } from '#tests/ayudas'
import { afirmarLibroCuadrado, cerrarMes, saldoTexto } from '#tests/ledger/ayudas_libro'
import RegistrarSaldoInicial from '#billing/actions/registrar_saldo_inicial'
import AnularSaldoInicial from '#billing/actions/anular_saldo_inicial'
import RegistrarPagoHistorico, { type EntradaPagoHistorico } from '#billing/actions/registrar_pago_historico'
import ImportarFacturaPendiente from '#billing/actions/importar_factura_pendiente'
import RegistrarPago from '#billing/actions/registrar_pago'
import AnularPago from '#billing/actions/anular_pago'
import { escenario, estadoServicio, eventosDe, lineasAsiento, unicoBd } from '#tests/billing/ayudas_billing'

/**
 * Semana 3 · tarea 7: pago histórico y reverso del saldo inicial para el importador (A6).
 * Contrato: `.claude/integration/contratos/importacion.md`.
 */

const importarFactura = async (servicioId: number, periodo: string, total = '150.00') =>
    new ImportarFacturaPendiente().execute(
        {
            clave_externa: await unicoBd('mw-fact'),
            servicio_id: servicioId,
            periodo,
            total,
            hoy: '2026-10-16',
        },
        contextoPrueba(),
    )

const pagoHistorico = async (
    datos: Partial<EntradaPagoHistorico> & Pick<EntradaPagoHistorico, 'cliente_id'>,
) =>
    new RegistrarPagoHistorico().execute(
        {
            historico: true,
            id_externo: await unicoBd('mw-pago'),
            metodo: 'deposito',
            monto: '300.00',
            fecha: '2026-09-10',
            hoy: '2026-10-16',
            ...datos,
        } as EntradaPagoHistorico,
        contextoPrueba(),
    )

async function errorDe(
    promesa: Promise<unknown>,
): Promise<{ status: number; codigo?: string; detalle: string }> {
    try {
        await promesa
    } catch (error) {
        const e = error as { status: number; tipo?: string; detalle?: string; message: string }
        return { status: e.status, codigo: e.tipo, detalle: e.detalle ?? e.message }
    }
    throw new Error('Se esperaba un error')
}

async function statusDe(promesa: Promise<unknown>): Promise<number> {
    const { status } = await errorDe(promesa)
    return status
}

async function cuentasDeAsientos(origenTipo: string, origenId: number) {
    const filas = await db
        .from('ledger.movimientos as m')
        .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
        .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
        .where('a.origen_tipo', origenTipo)
        .where('a.origen_id', origenId)
        .distinct('c.codigo')
    return filas.map((f) => f.codigo as string).sort()
}

test.group('billing · importación histórica', () => {
    test('pago histórico: 2.9.01 / CxC con su fecha, sin caja, sin evento ni reevaluación, idempotente', async ({
        assert,
    }) => {
        const { servicioId, clienteId } = await escenario({ fecha_instalacion: '2026-07-01' })
        const agosto = await importarFactura(servicioId, '2026-08-01')
        const septiembre = await importarFactura(servicioId, '2026-09-01')
        assert.equal(await saldoTexto(clienteId), '300.00')
        const estadoAntes = await estadoServicio(servicioId)

        const idExterno = await unicoBd('mw-pago')
        const pago = await pagoHistorico({
            cliente_id: clienteId,
            id_externo: idExterno,
            referencia: 'BOL-1',
        })
        assert.isTrue(pago.creado)
        assert.isTrue(pago.historico)
        assert.equal(pago.estado, 'registrado')
        assert.isNull(pago.caja_id)
        assert.deepEqual(
            pago.aplicaciones.map((a) => [a.factura_id, a.monto]),
            [
                [agosto.factura_id, '150.00'],
                [septiembre.factura_id, '150.00'],
            ],
        )
        assert.equal(await saldoTexto(clienteId), '0.00')
        assert.deepEqual(await lineasAsiento('pago', pago.id), [
            ['2.9.01', '300.00', '0.00', null],
            ['1.1.03', '0.00', '300.00', clienteId],
        ])
        const asiento = await db
            .from('ledger.asientos')
            .where('origen_tipo', 'pago')
            .where('origen_id', pago.id)
            .select(db.raw(`to_char(fecha, 'YYYY-MM-DD') as fecha`))
            .firstOrFail()
        assert.equal(asiento.fecha, '2026-09-10')
        const fila = await db
            .from('billing.pagos')
            .where('id', pago.id)
            .select(db.raw(`to_char(created_at AT TIME ZONE 'America/Guatemala', 'YYYY-MM-DD') as dia`))
            .firstOrFail()
        assert.equal(fila.dia, '2026-09-10')

        // no notifica ni reevalúa
        assert.lengthOf(await eventosDe('pago.registrado', 'pago_id', pago.id), 0)
        assert.equal(await estadoServicio(servicioId), estadoAntes)
        const auditoria = await db
            .from('audit.acciones')
            .where('accion', 'pagos.registrar_historico')
            .where('entidad_id', pago.id)
            .select('entrada')
            .firstOrFail()
        assert.isTrue(auditoria.entrada.historico)

        // idempotente por id_externo (también con el alias clave_externa); otros datos → 409
        const repetido = await pagoHistorico({
            cliente_id: clienteId,
            clave_externa: idExterno,
            id_externo: undefined,
        })
        assert.isFalse(repetido.creado)
        assert.equal(repetido.id, pago.id)
        const conflicto = await errorDe(
            pagoHistorico({ cliente_id: clienteId, id_externo: idExterno, monto: '1.00' }),
        )
        assert.equal(conflicto.status, 409)

        // la referencia del origen se puede repetir; sin facturas el pago va a Anticipos
        const otro = await pagoHistorico({ cliente_id: clienteId, referencia: 'BOL-1', monto: '20.00' })
        assert.deepEqual(otro.aplicaciones, [])
        assert.deepEqual(await lineasAsiento('pago', otro.id), [
            ['2.9.01', '20.00', '0.00', null],
            ['2.1.01', '0.00', '20.00', clienteId],
        ])

        // validaciones
        assert.equal(await statusDe(pagoHistorico({ cliente_id: clienteId, fecha: '2026-10-17' })), 422)
        assert.equal(
            await statusDe(pagoHistorico({ cliente_id: clienteId, historico: false as unknown as true })),
            422,
        )

        // se anula como cualquier pago: reverso del mismo asiento
        await new AnularPago().execute({ pago_id: pago.id, motivo: 'importado dos veces' }, contextoPrueba())
        // vuelven los 300 de deuda y se aplica el anticipo histórico de 20
        assert.equal(await saldoTexto(clienteId), '280.00')
        await afirmarLibroCuadrado(assert)
    })

    test('periodo cerrado: pago histórico y saldo inicial responden 422 periodo_cerrado sin escribir', async ({
        assert,
    }) => {
        await cerrarMes('2017-04-01')
        const { clienteId } = await escenario()
        const idPago = await unicoBd('mw-pago')
        const pago = await errorDe(
            pagoHistorico({ cliente_id: clienteId, id_externo: idPago, fecha: '2017-04-15' }),
        )
        assert.equal(pago.status, 422)
        assert.match(pago.detalle, /2017-04.*cerrado/)
        assert.match(pago.detalle, new RegExp(idPago))
        const idSaldo = await unicoBd('mw-saldo')
        const saldo = await errorDe(
            new RegistrarSaldoInicial().execute(
                { id_externo: idSaldo, cliente_id: clienteId, monto: '80.00', fecha: '2017-04-30' },
                contextoPrueba(),
            ),
        )
        assert.equal(saldo.status, 422)
        assert.match(saldo.detalle, /periodo 2017-04/)
        assert.isNull(await db.from('billing.pagos').where('clave_externa', idPago).first())
        assert.isNull(await db.from('billing.saldos_iniciales').where('clave_externa', idSaldo).first())
        assert.equal(await saldoTexto(clienteId), '0.00')
    })

    test('anular saldo inicial deudor: revierte CxC / 2.9.01 y anula la factura de apertura', async ({
        assert,
    }) => {
        const { clienteId } = await escenario()
        const id = await unicoBd('mw-saldo')
        const saldo = await new RegistrarSaldoInicial().execute(
            { id_externo: id, cliente_id: clienteId, monto: '80.00', fecha: '2026-10-01' },
            contextoPrueba(),
        )
        assert.equal(await saldoTexto(clienteId), '80.00')

        const anulado = await new AnularSaldoInicial().execute(
            { id_externo: id, motivo: 'monto equivocado en el origen' },
            contextoPrueba(),
        )
        assert.lengthOf(anulado.reversos, 1)
        assert.equal(await saldoTexto(clienteId), '0.00')
        const factura = await db.from('billing.facturas').where('id', saldo.factura_id!).firstOrFail()
        assert.equal(factura.estado, 'anulada')
        assert.deepEqual(await lineasAsiento('factura', saldo.factura_id!), [
            ['1.1.03', '80.00', '0.00', clienteId],
            ['2.9.01', '0.00', '80.00', null],
            ['1.1.03', '0.00', '80.00', clienteId],
            ['2.9.01', '80.00', '0.00', null],
        ])

        const otraVez = new AnularSaldoInicial().execute(
            { id_externo: id, motivo: 'otra vez' },
            contextoPrueba(),
        )
        assert.equal(await statusDe(otraVez), 409)
        const reusar = await errorDe(
            new RegistrarSaldoInicial().execute(
                { id_externo: id, cliente_id: clienteId, monto: '80.00', fecha: '2026-10-01' },
                contextoPrueba(),
            ),
        )
        assert.equal(reusar.status, 409)
        assert.match(reusar.detalle, /anuló/)
        await afirmarLibroCuadrado(assert)
    })

    test('anular saldo deudor con pagos → 409 saldo_con_pagos', async ({ assert }) => {
        const { clienteId } = await escenario()
        const id = await unicoBd('mw-saldo')
        await new RegistrarSaldoInicial().execute(
            { id_externo: id, cliente_id: clienteId, monto: '80.00' },
            contextoPrueba(),
        )
        await new RegistrarPago().execute(
            { cliente_id: clienteId, metodo: 'agente', monto: '30.00' },
            contextoPrueba(),
        )
        const error = await errorDe(
            new AnularSaldoInicial().execute({ id_externo: id, motivo: 'x' }, contextoPrueba()),
        )
        assert.equal(error.status, 409)
        assert.match(error.detalle, /anule primero/)
        assert.equal(await saldoTexto(clienteId), '50.00')
    })

    test('anular saldo a favor ya aplicado: devuelve la factura a pendiente y deja Anticipos en cero', async ({
        assert,
    }) => {
        const { servicioId, clienteId } = await escenario({ fecha_instalacion: '2026-07-01' })
        const factura = await importarFactura(servicioId, '2026-08-01')
        const id = await unicoBd('mw-saldo')
        await new RegistrarSaldoInicial().execute(
            { id_externo: id, cliente_id: clienteId, monto: '-50.00' },
            contextoPrueba(),
        )
        assert.equal(await saldoTexto(clienteId), '100.00')
        const antes = await db.from('billing.facturas').where('id', factura.factura_id).firstOrFail()
        assert.equal(antes.pagado, '50.00')

        const { saldo_inicial_id: saldoId } = await new AnularSaldoInicial().execute(
            { id_externo: id, motivo: 'el saldo a favor ya se devolvió en el origen' },
            contextoPrueba(),
        )
        const despues = await db.from('billing.facturas').where('id', factura.factura_id).firstOrFail()
        assert.equal(despues.pagado, '0.00')
        assert.equal(despues.estado, 'vencida')
        assert.equal(await saldoTexto(clienteId), '150.00')
        const anticipos = await db
            .from('ledger.movimientos as m')
            .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
            .where('c.codigo', '2.1.01')
            .where('m.cliente_id', clienteId)
            .select(db.raw('coalesce(sum(m.haber - m.debe), 0)::numeric(14,2)::text as saldo'))
            .firstOrFail()
        assert.equal(anticipos.saldo, '0.00')
        assert.deepEqual(await cuentasDeAsientos('ajuste', saldoId), ['1.1.03', '2.1.01', '2.9.01'])

        // un pago nuevo ya no usa el saldo anulado
        const pago = await new RegistrarPago().execute(
            { cliente_id: clienteId, metodo: 'agente', monto: '150.00' },
            contextoPrueba(),
        )
        assert.deepEqual(
            pago.aplicaciones.map((a) => a.monto),
            ['150.00'],
        )
        assert.equal(await saldoTexto(clienteId), '0.00')
        await afirmarLibroCuadrado(assert)
    })
})
