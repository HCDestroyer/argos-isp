import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, unico } from '#tests/ayudas'
import { afirmarLibroCuadrado, saldoTexto } from '#tests/ledger/ayudas_libro'
import { Problema } from '#shared/errores'
import ImportarFacturaPendiente from '#billing/actions/importar_factura_pendiente'
import RegistrarPagoHistorico from '#billing/actions/registrar_pago_historico'
import RegistrarSaldoInicial from '#billing/actions/registrar_saldo_inicial'
import AnularSaldoInicial from '#billing/actions/anular_saldo_inicial'
import { claveImportacion } from '#billing/importacion'
import { verFactura } from '#billing/facturas'
import { escenario } from '#tests/billing/ayudas_billing'

/**
 * Importación neutral respecto al origen (decisión del PM, semana 3): `origen` es texto libre
 * (`mikrowisp`, `smartisp`, `csv`…) y el `id_externo` es único **por origen** en facturas, pagos
 * históricos y saldos iniciales.
 */

async function problemaDe(promesa: Promise<unknown>): Promise<Problema> {
    try {
        await promesa
    } catch (error) {
        if (error instanceof Problema) return error
        throw error
    }
    throw new Error('Se esperaba un error')
}

test.group('billing · importación por origen', () => {
    test('claveImportacion: origen libre normalizado, prefijo como respaldo, 422 si es inválido', async ({
        assert,
    }) => {
        assert.deepEqual(claveImportacion({ origen: ' SmartISP ', id_externo: '123' }), {
            origen: 'smartisp',
            id_externo: '123',
        })
        assert.deepEqual(claveImportacion({ clave_externa: 'mikrowisp:pago:9' }), {
            origen: 'mikrowisp',
            id_externo: 'mikrowisp:pago:9',
        })
        assert.deepEqual(claveImportacion({ id_externo: 'FILA-7' }), {
            origen: 'externo',
            id_externo: 'FILA-7',
        })
        const invalido = await problemaDe(
            Promise.resolve().then(() => claveImportacion({ origen: 'Smart ISP!', id_externo: '1' })),
        )
        assert.equal(invalido.status, 422)
        assert.equal(invalido.errores?.[0]?.field, 'origen')
    })

    test('el mismo id_externo en dos orígenes son dos registros; en el mismo origen es idempotente', async ({
        assert,
    }) => {
        const { servicioId, clienteId } = await escenario({ fecha_instalacion: '2026-07-01' })
        const id = unico('123')

        // facturas: mismo id, distinto origen y periodo → dos facturas
        const deSmart = await new ImportarFacturaPendiente().execute(
            {
                origen: 'smartisp',
                id_externo: id,
                servicio_id: servicioId,
                periodo: '2026-07-01',
                total: '100.00',
            },
            contextoPrueba(),
        )
        const deCsv = await new ImportarFacturaPendiente().execute(
            {
                origen: 'csv',
                id_externo: id,
                servicio_id: servicioId,
                periodo: '2026-08-01',
                total: '100.00',
            },
            contextoPrueba(),
        )
        assert.notEqual(deSmart.factura_id, deCsv.factura_id)
        const otraVez = await new ImportarFacturaPendiente().execute(
            {
                origen: 'smartisp',
                id_externo: id,
                servicio_id: servicioId,
                periodo: '2026-07-01',
                total: '100.00',
            },
            contextoPrueba(),
        )
        assert.deepEqual([otraVez.factura_id, otraVez.creada], [deSmart.factura_id, false])
        const conflicto = await problemaDe(
            new ImportarFacturaPendiente().execute(
                {
                    origen: 'smartisp',
                    id_externo: id,
                    servicio_id: servicioId,
                    periodo: '2026-07-01',
                    total: '99.00',
                },
                contextoPrueba(),
            ),
        )
        assert.equal(conflicto.status, 409)
        assert.match(conflicto.message, new RegExp(`smartisp:${id}`))
        const factura = await verFactura(deSmart.factura_id)
        assert.equal(factura.origen, 'smartisp')
        assert.equal(factura.id_externo, id)

        // pagos históricos: mismo id en dos orígenes
        const pagoSmart = await new RegistrarPagoHistorico().execute(
            {
                historico: true,
                origen: 'smartisp',
                id_externo: id,
                cliente_id: clienteId,
                metodo: 'deposito',
                monto: '100.00',
                fecha: '2026-07-15',
                facturas: [deSmart.factura_id],
            },
            contextoPrueba(),
        )
        const pagoCsv = await new RegistrarPagoHistorico().execute(
            {
                historico: true,
                origen: 'csv',
                id_externo: id,
                cliente_id: clienteId,
                metodo: 'deposito',
                monto: '100.00',
                fecha: '2026-08-15',
                facturas: [deCsv.factura_id],
            },
            contextoPrueba(),
        )
        assert.notEqual(pagoSmart.id, pagoCsv.id)
        assert.deepEqual([pagoSmart.origen, pagoSmart.id_externo], ['smartisp', id])
        const pagoRepetido = await new RegistrarPagoHistorico().execute(
            {
                historico: true,
                origen: 'SMARTISP',
                id_externo: id,
                cliente_id: clienteId,
                metodo: 'deposito',
                monto: '100.00',
                fecha: '2026-07-15',
            },
            contextoPrueba(),
        )
        assert.deepEqual([pagoRepetido.id, pagoRepetido.creado], [pagoSmart.id, false])

        // saldos iniciales: mismo id en dos orígenes; anular por origen + id
        const saldoSmart = await new RegistrarSaldoInicial().execute(
            {
                origen: 'smartisp',
                id_externo: id,
                cliente_id: clienteId,
                monto: '40.00',
                fecha: '2026-07-01',
            },
            contextoPrueba(),
        )
        const saldoCsv = await new RegistrarSaldoInicial().execute(
            { origen: 'csv', id_externo: id, cliente_id: clienteId, monto: '25.00', fecha: '2026-07-01' },
            contextoPrueba(),
        )
        assert.notEqual(saldoSmart.saldo_inicial_id, saldoCsv.saldo_inicial_id)
        const apertura = await verFactura(saldoSmart.factura_id!)
        assert.equal(apertura.origen, 'smartisp')
        assert.equal(await saldoTexto(clienteId), '65.00')

        const anulado = await new AnularSaldoInicial().execute(
            { origen: 'csv', id_externo: id, motivo: 'monto equivocado' },
            contextoPrueba(),
        )
        assert.deepEqual(
            [anulado.saldo_inicial_id, anulado.origen, anulado.id_externo],
            [saldoCsv.saldo_inicial_id, 'csv', id],
        )
        assert.equal(await saldoTexto(clienteId), '40.00')
        const sigue = await db
            .from('billing.saldos_iniciales')
            .where('id', saldoSmart.saldo_inicial_id)
            .firstOrFail()
        assert.isNull(sigue.anulado_en)
        await afirmarLibroCuadrado(assert)
    })

    test('la base exige origen con id_externo y unicidad por (origen, id_externo)', async ({ assert }) => {
        const { clienteId } = await escenario()
        const id = unico('dup')
        const pago = (origen: string | null, clave: string) => ({
            cliente_id: clienteId,
            metodo: 'deposito',
            monto: '1.00',
            historico: true,
            origen,
            clave_externa: clave,
        })
        // todo dentro de una transacción que se revierte: no deja pagos sin asiento
        const trx = await db.transaction()
        try {
            await trx.table('billing.pagos').insert(pago('a', id))
            await trx.table('billing.pagos').insert(pago('b', id))
            await assert.rejects(() =>
                trx.transaction((sp) => sp.table('billing.pagos').insert(pago('a', id))),
            )
            await assert.rejects(() =>
                trx.transaction((sp) => sp.table('billing.pagos').insert(pago(null, unico('sin-origen')))),
            )
            await assert.rejects(() =>
                trx.transaction((sp) => sp.table('billing.pagos').insert(pago('Con Espacio', unico('x')))),
            )
        } finally {
            await trx.rollback()
        }
    })
})
