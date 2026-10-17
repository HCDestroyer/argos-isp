import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, unico } from '#tests/ayudas'
import { afirmarLibroCuadrado, cerrarMes, crearCliente, saldoTexto } from '#tests/ledger/ayudas_libro'
import { Problema } from '#shared/errores'
import ImportarFacturaPendiente, {
    type EntradaImportarFactura,
} from '#billing/actions/importar_factura_pendiente'
import ImportarPromesa, { type EntradaImportarPromesa } from '#billing/actions/importar_promesa'
import RegistrarPagoHistorico from '#billing/actions/registrar_pago_historico'
import EvaluarEstadoServicio from '#billing/actions/evaluar_estado_servicio'
import { avanceDePromesa } from '#billing/promesas'
import { verFactura } from '#billing/facturas'
import { estadoCuenta } from '#billing/estado_cuenta'
import {
    asientoDe,
    escenario,
    estadoServicio,
    eventosDe,
    facturasDe,
    generar,
    lineasAsiento,
    servicioCortado,
} from '#tests/billing/ayudas_billing'

/**
 * Importación completa (decisión del PM, 17 oct: "se debe traer todo"): cargos únicos, segunda
 * factura del periodo, deuda de clientes retirados sin servicios, facturas sin cargo, facturas
 * saldadas sin pago en el origen y promesas vigentes. Contrato: `contratos/importacion.md`.
 */

async function problemaDe(operacion: Promise<unknown>): Promise<Problema> {
    try {
        await operacion
    } catch (error) {
        if (error instanceof Problema) return error
        throw error
    }
    throw new Error('Se esperaba un error')
}

function importar(entrada: Omit<EntradaImportarFactura, 'origen'> & { origen?: string }) {
    return new ImportarFacturaPendiente().execute(
        { origen: 'mikrowisp', hoy: '2026-10-17', ...entrada },
        contextoPrueba(),
    )
}

function promesa(entrada: Partial<EntradaImportarPromesa>) {
    return new ImportarPromesa().execute(
        {
            origen: 'mikrowisp',
            id_externo: unico('promesa'),
            vence: '2026-10-20',
            creada_en: '2026-10-05',
            ahora: new Date('2026-10-08T15:00:00Z'),
            ...entrada,
        },
        contextoPrueba(),
    )
}

test.group('billing · importación completa · facturas', () => {
    test('cliente retirado sin servicios: cada factura es deuda real con su fecha y concepto', async ({
        assert,
    }) => {
        const clienteId = await crearCliente()
        const id = unico('fac')
        const r = await importar({
            id_externo: id,
            cliente_id: clienteId,
            emitida_en: '2025-03-10',
            total: '250.00',
            concepto: 'Servicio de internet marzo 2025',
        })
        assert.deepEqual([r.creada, r.estado, r.cargo_unico], [true, 'vencida', true])

        const factura = await verFactura(r.factura_id)
        assert.isNull(factura.servicio_id)
        assert.equal(factura.cliente_id, clienteId)
        assert.equal(factura.periodo, '2025-03-01')
        assert.equal(factura.vence_en, '2025-03-10')
        assert.equal(factura.clave_unica, `importada-mikrowisp:${id}`)
        assert.equal(
            new Date(factura.emitida_en as unknown as string).toISOString(),
            '2025-03-10T18:00:00.000Z',
        )
        const linea = await db.from('billing.facturas_lineas').where('factura_id', r.factura_id).firstOrFail()
        assert.equal(linea.concepto, 'Servicio de internet marzo 2025')
        assert.equal(linea.total, '250.00')

        // asiento con la fecha de emisión: el estado de cuenta la muestra en su lugar
        const asiento = await asientoDe('factura', r.factura_id)
        const fecha = await db
            .from('ledger.asientos')
            .where('id', asiento[0]!.asiento_id)
            .select(db.raw(`to_char(fecha, 'YYYY-MM-DD') as fecha`))
            .firstOrFail()
        assert.equal(fecha.fecha, '2025-03-10')
        assert.deepEqual(await lineasAsiento('factura', r.factura_id), [
            ['1.1.03', '250.00', '0.00', clienteId],
            ['2.9.01', '0.00', '250.00', null],
        ])
        assert.equal(await saldoTexto(clienteId), '250.00')
        const cuenta = await estadoCuenta(clienteId)
        assert.deepEqual(
            cuenta.movimientos.map((m) => [m.fecha, m.tipo, m.cargo]),
            [['2025-03-10', 'factura', '250.00']],
        )
        assert.deepEqual(
            cuenta.facturas_pendientes.map((f) => f.id),
            [r.factura_id],
        )

        // idempotente; conflicto con otros datos
        const otraVez = await importar({
            id_externo: id,
            cliente_id: clienteId,
            emitida_en: '2025-03-10',
            total: '250.00',
        })
        assert.deepEqual([otraVez.factura_id, otraVez.creada], [r.factura_id, false])
        const conflicto = await problemaDe(
            importar({ id_externo: id, cliente_id: clienteId, emitida_en: '2025-03-10', total: '25.00' }),
        )
        assert.equal(conflicto.status, 409)
        assert.equal(conflicto.tipo, 'urn:argosisp:problema:clave_externa_conflicto')
        assert.equal(await saldoTexto(clienteId), '250.00')
        assert.lengthOf(await eventosDe('factura.emitida', 'factura_id', r.factura_id), 0)
        await afirmarLibroCuadrado(assert)
    })

    test('sin servicio exige cliente_id; sin periodo exige emitida_en; no futura ni con mora', async ({
        assert,
    }) => {
        const sinCliente = await problemaDe(importar({ id_externo: unico('x'), total: '10.00' }))
        assert.equal(sinCliente.status, 422)
        assert.sameMembers(
            sinCliente.errores!.map((e) => e.field),
            ['cliente_id', 'emitida_en'],
        )
        const clienteId = await crearCliente()
        const futura = await problemaDe(
            importar({
                id_externo: unico('x'),
                cliente_id: clienteId,
                emitida_en: '2026-11-01',
                total: '1.00',
            }),
        )
        assert.equal(futura.errores?.[0]?.field, 'emitida_en')
        const mora = await problemaDe(
            importar({
                id_externo: unico('x'),
                cliente_id: clienteId,
                emitida_en: '2026-01-01',
                total: '1.00',
                aplicar_mora: true,
            }),
        )
        assert.equal(mora.errores?.[0]?.field, 'aplicar_mora')
        const negativo = await problemaDe(
            importar({
                id_externo: unico('x'),
                cliente_id: clienteId,
                emitida_en: '2026-01-01',
                total: '-1.00',
            }),
        )
        assert.equal(negativo.errores?.[0]?.field, 'total')
        const ajeno = await crearCliente()
        const { servicioId } = await escenario()
        const otroDueno = await problemaDe(
            importar({
                id_externo: unico('x'),
                servicio_id: servicioId,
                cliente_id: ajeno,
                periodo: '2026-09-01',
                total: '1.00',
            }),
        )
        assert.equal(otroDueno.errores?.[0]?.field, 'cliente_id')
    })

    test('segunda factura del mismo periodo y cargos únicos: no ocupan servicio+periodo, sí cortan', async ({
        assert,
    }) => {
        const { servicioId, clienteId } = await escenario({
            fecha_instalacion: '2026-08-01',
            plantilla: { hora_corte: '00:00', facturas_para_limitar: 1, facturas_para_cortar: 3 },
        })
        const primera = await importar({
            id_externo: unico('f1'),
            servicio_id: servicioId,
            periodo: '2026-08-01',
            total: '150.00',
        })
        assert.isFalse(primera.cargo_unico)
        // sin cargo_unico choca con la clave del periodo, con un mensaje que dice qué hacer
        const choque = await problemaDe(
            importar({
                id_externo: unico('f2'),
                servicio_id: servicioId,
                periodo: '2026-08-01',
                total: '150.00',
            }),
        )
        assert.equal(choque.status, 409)
        assert.match(choque.message, /cargo_unico: true/)

        const segunda = await importar({
            id_externo: unico('f2'),
            servicio_id: servicioId,
            periodo: '2026-08-01',
            cargo_unico: true,
            emitida_en: '2026-08-15',
            total: '150.00',
        })
        assert.isTrue(segunda.cargo_unico)
        const instalacion = await importar({
            id_externo: unico('inst'),
            servicio_id: servicioId,
            emitida_en: '2026-08-01',
            total: '300.00',
            concepto: 'INSTALACION',
        })
        assert.isTrue(instalacion.cargo_unico)
        const fila = await verFactura(instalacion.factura_id)
        assert.equal(fila.periodo, '2026-08-01')
        assert.equal(fila.vence_en, '2026-08-06')
        const lineaInst = await db
            .from('billing.facturas_lineas')
            .where('factura_id', instalacion.factura_id)
            .firstOrFail()
        assert.deepEqual([lineaInst.tipo, lineaInst.concepto], ['otro', 'INSTALACION'])

        // el cron no duplica agosto (la de periodo lo ocupa) y emite septiembre y octubre
        await generar(servicioId, '2026-10-01')
        await generar(servicioId, '2026-10-01')
        const todas = await facturasDe(servicioId)
        const periodos = todas.map((f) => f.periodo)
        assert.deepEqual(periodos, ['2026-08-01', '2026-08-01', '2026-08-01', '2026-09-01', '2026-10-01'])

        // las tres importadas están vencidas y cuentan para el corte (3 ≥ facturas_para_cortar)
        const r = await new EvaluarEstadoServicio().execute({ servicio_id: servicioId }, contextoPrueba())
        assert.equal(r.vencidas, 3)
        assert.equal(await estadoServicio(servicioId), 'suspendido')
        assert.equal(await saldoTexto(clienteId), '900.00')
        await afirmarLibroCuadrado(assert)
    })

    test('total 0 (sin cargo) y saldada en el origen: pagadas, sin asiento ni pago, saldo intacto', async ({
        assert,
    }) => {
        const { servicioId, clienteId } = await escenario({ fecha_instalacion: '2026-07-01' })
        const cero = await importar({
            origen: 'smartisp',
            id_externo: unico('cero'),
            servicio_id: servicioId,
            periodo: '2026-07-01',
            emitida_en: '2026-07-01',
            total: '0.00',
        })
        assert.deepEqual([cero.creada, cero.estado], [true, 'pagada'])
        const filaCero = await verFactura(cero.factura_id)
        assert.deepEqual([filaCero.total, filaCero.pagado, filaCero.iva], ['0.00', '0.00', '0.00'])
        assert.lengthOf(await asientoDe('factura', cero.factura_id), 0)
        const repetida = await importar({
            origen: 'smartisp',
            id_externo: filaCero.id_externo as string,
            servicio_id: servicioId,
            periodo: '2026-07-01',
            emitida_en: '2026-07-01',
            total: '0.00',
        })
        assert.deepEqual([repetida.factura_id, repetida.creada], [cero.factura_id, false])

        const saldada = await importar({
            origen: 'smartisp',
            id_externo: unico('saldada'),
            servicio_id: servicioId,
            periodo: '2026-08-01',
            emitida_en: '2026-08-01',
            total: '150.00',
            saldada_en_origen: true,
        })
        assert.equal(saldada.estado, 'pagada')
        const filaSaldada = await verFactura(saldada.factura_id)
        assert.deepEqual([filaSaldada.total, filaSaldada.pagado], ['150.00', '150.00'])
        assert.lengthOf(await asientoDe('factura', saldada.factura_id), 0)
        const aplicaciones = await db
            .from('billing.pagos_aplicaciones')
            .where('factura_id', saldada.factura_id)
        assert.lengthOf(aplicaciones, 0)
        assert.equal(await saldoTexto(clienteId), '0.00')

        // ninguna cuenta para el corte; el cron ya no factura julio ni agosto
        await generar(servicioId, '2026-08-01')
        assert.lengthOf(await facturasDe(servicioId), 2)
        await afirmarLibroCuadrado(assert)
    })

    test('emitida_en en un mes cerrado → 422 periodo_cerrado sin escribir', async ({ assert }) => {
        await cerrarMes('2016-03-01')
        const clienteId = await crearCliente()
        const id = unico('cerrada')
        const error = await problemaDe(
            importar({ id_externo: id, cliente_id: clienteId, emitida_en: '2016-03-15', total: '80.00' }),
        )
        assert.equal(error.status, 422)
        assert.equal(error.tipo, 'urn:argosisp:problema:periodo_cerrado')
        assert.match(error.message, new RegExp(id))
        const filas = await db.from('billing.facturas').where('clave_externa', id)
        assert.lengthOf(filas, 0)
        // sin cargo no escribe en el libro: se acepta aunque el mes esté cerrado
        const historial = await importar({
            id_externo: unico('cerrada-cero'),
            cliente_id: clienteId,
            emitida_en: '2016-03-15',
            total: '0.00',
        })
        assert.equal(historial.estado, 'pagada')
    })
})

test.group('billing · importación completa · promesas', () => {
    test('promesa vigente: activa, sin eventos ni reevaluación; el corte la respeta', async ({ assert }) => {
        const { servicioId, clienteId } = await servicioCortado()
        assert.equal(await estadoServicio(servicioId), 'suspendido')
        const emitidas = await facturasDe(servicioId)
        const facturas = emitidas.filter((f) => f.tipo === 'servicio')
        const id = unico('prom')
        const p = await promesa({ id_externo: id, facturas: facturas.map((f) => f.id) })
        assert.deepEqual(
            [p.creada, p.estado, p.servicio_id, p.cliente_id],
            [true, 'activa', servicioId, clienteId],
        )
        assert.equal(p.monto, '300.00')
        assert.equal(p.origen, 'mikrowisp')
        assert.equal(new Date(p.created_at).toISOString(), '2026-10-05T18:00:00.000Z')
        assert.equal(new Date(p.vence_en).toISOString(), '2026-10-21T05:59:59.000Z')
        assert.equal((p.resultado_evaluacion as { resultado: string }).resultado, 'aprobada')
        assert.lengthOf(await eventosDe('promesa.creada', 'promesa_id', p.id), 0)
        assert.equal(await estadoServicio(servicioId), 'suspendido')

        // el siguiente corte la ve activa y reactiva
        await new EvaluarEstadoServicio().execute(
            { servicio_id: servicioId, ahora: new Date('2026-10-08T15:00:00Z') },
            contextoPrueba(),
        )
        assert.equal(await estadoServicio(servicioId), 'activo')

        // idempotente; conflicto con otro monto; otra promesa del servicio → 409
        const otraVez = await promesa({ id_externo: id, facturas: facturas.map((f) => f.id) })
        assert.deepEqual([otraVez.id, otraVez.creada], [p.id, false])
        const conflicto = await problemaDe(
            promesa({ id_externo: id, servicio_id: servicioId, monto: '10.00' }),
        )
        assert.equal(conflicto.tipo, 'urn:argosisp:problema:clave_externa_conflicto')
        const abierta = await problemaDe(promesa({ servicio_id: servicioId }))
        assert.equal(abierta.tipo, 'urn:argosisp:problema:promesa_abierta')

        // un pago histórico anterior a la promesa no la cumple; uno posterior sí cuenta
        await new RegistrarPagoHistorico().execute(
            {
                historico: true,
                origen: 'mikrowisp',
                id_externo: unico('pago-antes'),
                cliente_id: clienteId,
                metodo: 'deposito',
                monto: '100.00',
                fecha: '2026-10-02',
                hoy: '2026-10-17',
            },
            contextoPrueba(),
        )
        const fila = await db.from('billing.promesas').where('id', p.id).firstOrFail()
        const antes = await avanceDePromesa(db.connection(), fila)
        assert.equal(antes.pagado.toFixed(2), '0.00')
        await new RegistrarPagoHistorico().execute(
            {
                historico: true,
                origen: 'mikrowisp',
                id_externo: unico('pago-despues'),
                cliente_id: clienteId,
                metodo: 'deposito',
                monto: '50.00',
                fecha: '2026-10-07',
                hoy: '2026-10-17',
            },
            contextoPrueba(),
        )
        const despues = await avanceDePromesa(db.connection(), fila)
        assert.equal(despues.pagado.toFixed(2), '50.00')
        await afirmarLibroCuadrado(assert)
    })

    test('vencida → 422 promesa_vencida; factura sin servicio → 422; sin deuda → 422', async ({ assert }) => {
        const { servicioId } = await servicioCortado()
        const vencida = await problemaDe(promesa({ servicio_id: servicioId, vence: '2026-10-07' }))
        assert.equal(vencida.status, 422)
        assert.equal(vencida.tipo, 'urn:argosisp:problema:promesa_vencida')

        const clienteId = await crearCliente()
        const sinServicio = await importar({
            id_externo: unico('ret'),
            cliente_id: clienteId,
            emitida_en: '2025-01-10',
            total: '100.00',
        })
        const error = await problemaDe(promesa({ facturas: [sinServicio.factura_id] }))
        assert.equal(error.status, 422)
        assert.equal(error.errores?.[0]?.field, 'facturas.0')
        const falta = await problemaDe(promesa({}))
        assert.equal(falta.errores?.[0]?.field, 'servicio_id')

        const alDia = await escenario()
        const sinDeuda = await problemaDe(promesa({ servicio_id: alDia.servicioId }))
        assert.equal(sinDeuda.tipo, 'urn:argosisp:problema:sin_deuda')
        const filas = await db.from('billing.promesas').whereIn('servicio_id', [servicioId, alDia.servicioId])
        assert.lengthOf(filas, 0)
    })
})
