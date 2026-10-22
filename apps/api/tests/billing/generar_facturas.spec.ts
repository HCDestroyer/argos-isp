import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { crearEmpresaFila } from '#tests/core/fabricas'
import { afirmarLibroCuadrado, saldoTexto } from '#tests/ledger/ayudas_libro'
import { lineaConIva } from '#billing/facturas'
import { periodosHasta } from '#billing/periodos'
import {
    asientoDe,
    escenario,
    estadoServicio,
    eventosDe,
    facturasDe,
    generar,
} from '#tests/billing/ayudas_billing'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
import VencerFacturas from '#billing/actions/vencer_facturas'

test.group('billing · periodos', () => {
    test('día fijo con prorrateo: primer periodo parcial desde la instalación, luego ciclos completos', ({
        assert,
    }) => {
        const periodos = periodosHasta(
            { ciclo: 'dia_fijo', dia: 1, prorrateo: true },
            '2026-09-16',
            '2026-11-01',
        )
        assert.deepEqual(
            periodos.map((p) => [p.periodo, p.fin, p.dias, p.dias_ciclo]),
            [
                ['2026-09-16', '2026-10-01', 15, 30],
                ['2026-10-01', '2026-11-01', 31, 31],
                ['2026-11-01', '2026-12-01', 30, 30],
            ],
        )
        assert.equal(periodos[0]!.factor, '0.5')
    })

    test('sin prorrateo el primer periodo se cobra completo; aniversario usa el día de instalación', ({
        assert,
    }) => {
        const fijo = periodosHasta(
            { ciclo: 'dia_fijo', dia: 5, prorrateo: false },
            '2026-09-20',
            '2026-10-04',
        )
        assert.deepEqual(
            fijo.map((p) => [p.periodo, p.fin, p.factor]),
            [['2026-09-20', '2026-10-05', '1']],
        )
        const aniversario = periodosHasta(
            { ciclo: 'aniversario', dia: null, prorrateo: true },
            '2026-08-20',
            '2026-10-20',
        )
        assert.deepEqual(
            aniversario.map((p) => [p.periodo, p.factor]),
            [
                ['2026-08-20', '1'],
                ['2026-09-20', '1'],
                ['2026-10-20', '1'],
            ],
        )
        assert.deepEqual(
            periodosHasta({ ciclo: 'dia_fijo', dia: 1, prorrateo: true }, '2026-11-02', '2026-11-01'),
            [],
        )
    })

    test('IVA incluido desglosado por línea con redondeo al final', ({ assert }) => {
        assert.containSubset(
            lineaConIva({ concepto: 'x', tipo: 'servicio', cantidad: '1', gravable: true, total: '150' }),
            {
                total: '150.00',
                iva: '16.07',
                precio_unitario: '150.00',
            },
        )
        assert.containSubset(
            lineaConIva({ concepto: 'x', tipo: 'servicio', cantidad: '1', gravable: true, total: '75' }),
            {
                iva: '8.04',
            },
        )
        assert.containSubset(
            lineaConIva({ concepto: 'x', tipo: 'mora', cantidad: '1', gravable: false, total: '25' }),
            {
                iva: '0.00',
            },
        )
    })
})

test.group('billing · generarFacturas', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('emite todo lo pendiente con prorrateo, asiento CxC / Ingresos + IVA y factura.emitida; repetir no duplica', async ({
        assert,
    }) => {
        const { servicioId, clienteId } = await escenario({ fecha_instalacion: '2026-09-16' })

        const primera = await generar(servicioId, '2026-10-15')
        assert.equal(primera.generadas, 2)
        assert.equal(primera.errores, 0)
        await afirmarLibroCuadrado(assert)

        const facturas = await facturasDe(servicioId)
        assert.deepEqual(
            facturas.map((f) => [f.periodo, f.vence_en, f.total, f.iva, f.subtotal, f.estado, f.tipo]),
            [
                ['2026-09-16', '2026-09-21', '75.00', '8.04', '66.96', 'emitida', 'servicio'],
                ['2026-10-01', '2026-10-06', '150.00', '16.07', '133.93', 'emitida', 'servicio'],
            ],
        )
        const [prorrateada] = facturas
        const fila = await db.from('billing.facturas').where('id', prorrateada!.id).firstOrFail()
        assert.equal(fila.clave_unica, `${servicioId}-2026-09-16`)
        assert.equal(fila.reglas_snapshot.facturas_para_cortar, 2)
        assert.equal(fila.reglas_snapshot.precio, '150.00')
        const lineas = await db.from('billing.facturas_lineas').where('factura_id', prorrateada!.id)
        assert.lengthOf(lineas, 1)
        assert.include(lineas[0].concepto, 'prorrateo 15/30 días')
        const asientoProrrateada = await asientoDe('factura', prorrateada!.id)

        assert.deepEqual(
            asientoProrrateada.map((m) => [m.codigo, m.debe, m.haber, m.cliente_id]),
            [
                ['1.1.03', '75.00', '0.00', clienteId],
                ['4.1.01', '0.00', '66.96', null],
                ['2.1.02', '0.00', '8.04', null],
            ],
        )
        const eventos = await eventosDe('factura.emitida', 'servicio_id', servicioId)
        assert.lengthOf(eventos, 2)
        assert.deepEqual(eventos[0].payload, {
            empresa_id: 1,
            factura_id: prorrateada!.id,
            servicio_id: servicioId,
            cliente_id: clienteId,
            total: '75.00',
            vence: '2026-09-21',
        })
        assert.equal(await saldoTexto(clienteId), '225.00')

        const segunda = await generar(servicioId, '2026-10-15')
        assert.deepEqual(segunda, {
            generadas: 0,
            omitidas: 2,
            facturas: [],
            bonificadas: 0,
            bonificaciones: [],
            errores: 0,
            bloqueados: 0,
            bloqueos: [],
        })
        assert.lengthOf(await facturasDe(servicioId), 2)
        assert.equal(await saldoTexto(clienteId), '225.00')
        await afirmarLibroCuadrado(assert)
    })

    test('conceptos recurrentes y costo_override: línea aparte a Otros ingresos', async ({ assert }) => {
        const { servicioId } = await escenario({
            fecha_instalacion: '2026-10-01',
            servicio: { costo_override: '200.00' },
        })
        await db.table('billing.conceptos_recurrentes').insert([
            { servicio_id: servicioId, nombre: 'Renta de router', monto: '25.00' },
            { servicio_id: servicioId, nombre: 'Inactivo', monto: '99.00', activo: false },
        ])
        const { facturas } = await generar(servicioId, '2026-10-01')
        assert.lengthOf(facturas, 1)
        const [factura] = await facturasDe(servicioId)
        assert.equal(factura!.total, '225.00')
        const asientoFactura = await asientoDe('factura', factura!.id)
        assert.equal(factura!.iva, '24.11')
        const lineas = await db.from('billing.facturas_lineas').where('factura_id', factura!.id).orderBy('id')
        assert.deepEqual(
            lineas.map((l) => [l.tipo, l.total, l.iva]),
            [
                ['servicio', '200.00', '21.43'],
                ['otro', '25.00', '2.68'],
            ],
        )
        assert.deepEqual(
            asientoFactura.map((m) => [m.codigo, m.debe, m.haber]),
            [
                ['1.1.03', '225.00', '0.00'],
                ['4.1.01', '0.00', '178.57'],
                ['4.1.03', '0.00', '22.32'],
                ['2.1.02', '0.00', '24.11'],
            ],
        )
        await afirmarLibroCuadrado(assert)
    })

    test('servicios retirados o sin plantilla no se facturan; POST /facturas/generar factura el resto', async ({
        client,
        assert,
    }) => {
        // empresa propia: el POST recorre solo la empresa activa (X-Empresa-Id), no los servicios que
        // dejaron las demás suites en la principal (por eso tardaba más de 30 s según el orden)
        const empresaId = await crearEmpresaFila()
        const retirado = await escenario({ servicio: { estado: 'retirado', empresa_id: empresaId } })
        const sinPlantilla = await escenario({
            servicio: { plantilla_facturacion_id: null, empresa_id: empresaId },
        })
        const normal = await escenario({
            fecha_instalacion: '2026-10-01',
            servicio: { empresa_id: empresaId },
        })

        const deRetirado = await generar(retirado.servicioId, '2026-10-15')
        assert.equal(deRetirado.generadas, 0)

        const { token } = await usuarioConRoles(['contabilidad'])
        const respuesta = await estado(
            client
                .post('/api/v1/facturas/generar')
                .bearerToken(token)
                .header('X-Empresa-Id', String(empresaId))
                .json({ hasta: '2026-10-15' }),
            200,
        )
        const [factura] = await facturasDe(normal.servicioId)
        // solo los servicios de la empresa: el normal con su factura de octubre
        assert.deepEqual(respuesta.body().facturas, [factura!.id])
        assert.include(respuesta.body(), { generadas: 1, omitidas: 0, errores: 0 })
        assert.lengthOf(await facturasDe(retirado.servicioId), 0)
        assert.lengthOf(await facturasDe(sinPlantilla.servicioId), 0)
        await afirmarLibroCuadrado(assert)

        const lista = await estado(
            client.get('/api/v1/facturas').qs({ servicio_id: normal.servicioId }).bearerToken(token),
            200,
        )
        assert.lengthOf(lista.body().data, 1)
        assert.containSubset(lista.body().data[0], {
            id: factura!.id,
            periodo: '2026-10-01',
            vence_en: '2026-10-06',
            total: '150.00',
            estado: 'emitida',
            tipo: 'servicio',
        })
        const detalle = await estado(client.get(`/api/v1/facturas/${factura!.id}`).bearerToken(token), 200)
        assert.lengthOf(detalle.body().lineas, 1)
        assert.equal(detalle.body().lineas[0].iva, '16.07')
        assert.equal(detalle.body().reglas_snapshot.plantilla_id, normal.plantillaId)
        await estado(client.get('/api/v1/facturas/999999999').bearerToken(token), 404)
    })

    test('multiempresa: POST /facturas/generar, /facturas/vencer y /facturas/corte recorren solo las empresas del usuario', async ({
        client,
        assert,
    }) => {
        const B = await crearEmpresaFila()
        const C = await crearEmpresaFila()
        const enB = await escenario({ servicio: { empresa_id: B } })
        const enC = await escenario({ servicio: { empresa_id: C } })
        // usuario acotado a la empresa C (sin alcance global)
        const { usuario, token } = await usuarioConRoles(['contabilidad'])
        await db.from('core.usuarios').where('id', usuario.id).update({ alcance_global: false })
        await db.table('core.usuarios_empresas').insert({ usuario_id: usuario.id, empresa_id: C })

        const generada = await estado(
            client.post('/api/v1/facturas/generar').bearerToken(token).json({ hasta: '2026-10-15' }),
            200,
        )
        const deC = await facturasDe(enC.servicioId)
        assert.lengthOf(deC, 2)
        assert.sameMembers(
            generada.body().facturas,
            deC.map((f) => f.id),
        )
        assert.lengthOf(await facturasDe(enB.servicioId), 0, 'la empresa B no es del usuario')

        // vencer: igual, solo la empresa del usuario
        await generar(enB.servicioId, '2026-10-15')
        const vencidas = await estado(
            client.post('/api/v1/facturas/vencer').bearerToken(token).json({ hasta: '2026-10-15' }),
            200,
        )
        // las dos de C (septiembre y octubre) pasan a vencida; las de B no se tocan
        assert.equal(vencidas.body().vencidas, 2)
        const facturasB = await facturasDe(enB.servicioId)
        const facturasC = await facturasDe(enC.servicioId)
        assert.deepEqual(
            facturasB.map((f) => f.estado),
            ['emitida', 'emitida'],
        )
        assert.deepEqual(
            facturasC.map((f) => f.estado),
            ['vencida', 'vencida'],
        )

        // corte: B también tiene dos vencidas (por el sistema), pero el usuario de C solo evalúa C
        await new VencerFacturas().execute(
            { servicio_id: enB.servicioId, hasta: '2026-10-15' },
            contextoPrueba(),
        )
        const corte = await estado(
            client.post('/api/v1/facturas/corte').bearerToken(token).json({ ignorar_hora: true }),
            200,
        )
        assert.equal(corte.body().evaluados, 1)
        assert.equal(await estadoServicio(enC.servicioId), 'suspendido')
        assert.equal(await estadoServicio(enB.servicioId), 'activo', 'la empresa B no es del usuario')
        await afirmarLibro(assert, [B, C])
    })
})
