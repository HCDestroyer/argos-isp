import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, unico } from '#tests/ayudas'
import { afirmarLibroCuadrado, saldoTexto } from '#tests/ledger/ayudas_libro'
import RegistrarSaldoInicial from '#billing/actions/registrar_saldo_inicial'
import ImportarFacturaPendiente from '#billing/actions/importar_factura_pendiente'
import RegistrarPago from '#billing/actions/registrar_pago'
import { escenario, facturasDe, generar, lineasAsiento } from '#tests/billing/ayudas_billing'

/**
 * Tarea 4 (fila de A6): acciones del importador, idempotentes por clave externa y por el libro.
 */

const importar = (servicioId: number, clave: string, extra: Record<string, unknown> = {}) =>
    new ImportarFacturaPendiente().execute(
        {
            clave_externa: clave,
            servicio_id: servicioId,
            periodo: '2026-08-01',
            total: '150.00',
            hoy: '2026-10-16',
            ...extra,
        },
        contextoPrueba(),
    )

test.group('billing · importación', () => {
    test('importarFacturaPendiente: idempotente, ocupa el periodo, sin mora ni eventos, asiento de apertura', async ({
        assert,
    }) => {
        const { servicioId, clienteId } = await escenario({ fecha_instalacion: '2026-08-01' })
        const clave = unico('mw-fact')
        const r = await importar(servicioId, clave)
        assert.containSubset(r, { creada: true, estado: 'vencida' })
        const repetida = await importar(servicioId, clave)
        assert.deepEqual(repetida, { factura_id: r.factura_id, creada: false, estado: 'vencida' })
        await assert.rejects(() => importar(servicioId, clave, { total: '151.00' }), /ya se importó/)

        const factura = await db.from('billing.facturas').where('id', r.factura_id).firstOrFail()
        assert.containSubset(factura, {
            clave_unica: `${servicioId}-2026-08-01`,
            clave_externa: clave,
            total: '150.00',
            iva: '16.07',
            subtotal: '133.93',
        })
        assert.equal(factura.reglas_snapshot.mora_tipo, 'ninguna')
        assert.deepEqual(await lineasAsiento('factura', r.factura_id), [
            ['1.1.03', '150.00', '0.00', clienteId],
            ['2.9.01', '0.00', '150.00', null],
        ])
        const eventos = await db
            .from('audit.outbox')
            .whereRaw(`(payload->>'factura_id')::bigint = ?`, [r.factura_id])
        assert.lengthOf(eventos, 0)
        const auditoria = await db
            .from('audit.acciones')
            .where('accion', 'facturas.importar_pendiente')
            .where('entidad_id', r.factura_id)
        assert.isAtLeast(auditoria.length, 1)

        // generarFacturas no duplica el periodo importado
        const gen = await generar(servicioId, '2026-09-01')
        assert.equal(gen.generadas, 1)
        const delServicio = await facturasDe(servicioId)
        assert.deepEqual(
            delServicio.map((f) => f.periodo),
            ['2026-08-01', '2026-09-01'],
        )
        // otra clave para un periodo ya facturado → 409
        await assert.rejects(
            () => importar(servicioId, unico('mw-fact'), { periodo: '2026-09-01' }),
            /ya tiene la factura/,
        )
        // vigente: vence después de hoy
        const vigente = await importar(servicioId, unico('mw-fact'), {
            periodo: '2026-10-01',
            vence_en: '2026-10-20',
        })
        assert.equal(vigente.estado, 'emitida')
        assert.equal(await saldoTexto(clienteId), '450.00')
        await afirmarLibroCuadrado(assert)
    })

    test('registrarSaldoInicial: deuda como factura de apertura y saldo a favor que se aplica', async ({
        assert,
    }) => {
        const { servicioId, clienteId } = await escenario({ fecha_instalacion: '2026-10-01' })
        const deuda = unico('mw-saldo')
        const r = await new RegistrarSaldoInicial().execute(
            { clave_externa: deuda, cliente_id: clienteId, monto: '80.00', fecha: '2026-10-01' },
            contextoPrueba(),
        )
        assert.isTrue(r.creado)
        assert.isNotNull(r.factura_id)
        const otra = await new RegistrarSaldoInicial().execute(
            { clave_externa: deuda, cliente_id: clienteId, monto: '80.00' },
            contextoPrueba(),
        )
        assert.deepEqual(otra, { ...r, creado: false })
        await assert.rejects(
            () =>
                new RegistrarSaldoInicial().execute(
                    { clave_externa: deuda, cliente_id: clienteId, monto: '81.00' },
                    contextoPrueba(),
                ),
            /ya se usó/,
        )
        assert.equal(await saldoTexto(clienteId), '80.00')
        assert.deepEqual(await lineasAsiento('factura', r.factura_id!), [
            ['1.1.03', '80.00', '0.00', clienteId],
            ['2.9.01', '0.00', '80.00', null],
        ])
        // se cobra como cualquier factura
        const pago = await new RegistrarPago().execute(
            { cliente_id: clienteId, metodo: 'caja', monto: '80.00' },
            contextoPrueba(),
        )
        assert.deepEqual(
            pago.aplicaciones.map((a) => a.factura_id),
            [r.factura_id],
        )
        assert.equal(await saldoTexto(clienteId), '0.00')

        // saldo a favor: se aplica a la próxima factura
        const favor = await new RegistrarSaldoInicial().execute(
            { clave_externa: unico('mw-favor'), cliente_id: clienteId, monto: '-50.00', fecha: '2026-10-01' },
            contextoPrueba(),
        )
        assert.isNull(favor.factura_id)
        await generar(servicioId, '2026-10-01')
        const [octubre] = await facturasDe(servicioId)
        assert.containSubset(octubre, { estado: 'parcial', pagado: '50.00' })
        const aplicacion = await db
            .from('billing.saldos_iniciales_aplicaciones')
            .where('saldo_inicial_id', favor.saldo_inicial_id)
            .firstOrFail()
        assert.equal(aplicacion.monto, '50.00')
        assert.equal(await saldoTexto(clienteId), '100.00')
        await afirmarLibroCuadrado(assert)
    })
})
