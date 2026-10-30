import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import { unicoBd } from '#tests/billing/ayudas_billing'
import { prepararEmpresas, servicioEn, servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro, verificarLibro } from '#tests/contabilidad/verificar_libro'
import ImportarFacturaPendiente from '#billing/actions/importar_factura_pendiente'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import AnularFactura from '#billing/actions/anular_factura'
import RegistrarPago from '#billing/actions/registrar_pago'
import EditarCliente from '#core/actions/editar_cliente'
import EmitirLibro from '#fiscal/actions/emitir_libro'
import { construirLibro, finDeMes } from '#fiscal/libros_legales'
import { CERO, aTexto, dec } from '#ledger/dinero'
import { hoyGuatemala, inicioDeMes } from '#ledger/fechas'
import {
    cerrarYBloquear,
    empresasSinFel,
    habilitar,
    mesConMovimiento,
    neto,
} from '#tests/contabilidad/ayudas_libros'
import { haceMeses } from '#tests/ledger/ayudas_compras'
import { cola, configurarModo, datosNit, empresasFel, servicioFel } from '#tests/fiscal/ayudas_fel'
import SolicitarCertificacion from '#fiscal/actions/solicitar_certificacion'
import EditarParametro from '#fiscal/actions/editar_parametro'
import VencerFactura from '#billing/actions/vencer_factura'
import { crearClienteFila } from '#tests/core/fabricas'

/**
 * Auditor contable · hallazgos abiertos de la fase 6. Cada uno con su `.fails` mientras exista; su
 * invariante está en `HALLAZGOS_ABIERTOS` y no lo revisan las demás pruebas.
 *
 * H27 (lo destapó el generativo en fase 6 PR B; arreglado por A3 en b4ffb08, decisión del líder): una
 * factura importada guarda su IVA desglosado (`iva` > 0) pero su asiento es CxC / 2.9.01 sin IVA; la
 * nota de crédito por su total se guardaba con IVA 0. Ahora lleva el IVA proporcional (`2.1.02` al
 * debe) y la base va a la cuenta de ingreso de la línea (H50, decisión del líder: rebaja de ventas). Queda como
 * prueba normal; el inv. 9.nota_sobre_importada_con_iva_residual ya lo revisan todas.
 *
 * H28–H30 (fase 6 PR D, libros con folio): el libro de ventas de un mes cerrado, bloqueado y ya
 * emitido cambiaba con hechos posteriores (anulación, dato fiscal del cliente, retención recibida).
 * Arreglados por A3 en 8814035: quedan como pruebas normales (el inv. 20.libro_emitido_cambio los vigila).
 *
 * H31 (arreglado por A3 en b42c35d): una factura sin FEL que sale como interna en el libro de su mes
 * y se certifica en un mes posterior volvía a sumar como DTE en el libro del mes de la certificación.
 * Ahora el DTE sale como fila informativa sin montos (`certificado_posterior`).
 *
 * H32 (arreglado por A3 en 0c5f602): la mora con IVA sin FEL (asiento `mora`, IVA a 2.1.02) no salía en el
 * libro de ventas; ahora es la fila interna `MORA`.
 *
 * H33 (arreglado por A3 en 4393daa): el DTE de un aviso llevaba sus montos en el mes de su
 * `fecha_emision` aunque la reclasificación 2.1.11 → 2.1.02 cayera en el mes de la certificación;
 * ahora los montos van al mes de la reclasificación y el DTE sale informativo en el suyo.
 */

test.group('Auditor contable · hallazgos de la fase 6', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('H27 (arreglado en b4ffb08, base a ingresos por H50 en 28ee679): la nota de crédito por el total de una factura importada con IVA lleva el IVA de la factura, debita 2.1.02 y la base al ingreso de la línea', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await servicioEn(e.B)
        const importada = await new ImportarFacturaPendiente().execute(
            {
                origen: 'auditoria',
                id_externo: await unicoBd('f'),
                cliente_id: s.clienteId,
                empresa_id: e.B,
                cargo_unico: true,
                emitida_en: '2026-09-05',
                total: '43.98',
            },
            e.ctx,
        )
        const factura = await db.from('billing.facturas').where('id', importada.factura_id!).firstOrFail()
        assert.notEqual(factura.iva, '0.00', 'la importada desglosa su IVA')
        const nota = await new EmitirNotaCredito().execute(
            { factura_id: importada.factura_id!, monto: '43.98', motivo: 'auditoría: acredita el total' },
            e.ctx,
        )
        const fila = await db.from('billing.notas_credito').where('id', nota.id).firstOrFail()
        assert.deepEqual(
            { iva: fila.iva, subtotal: fila.subtotal },
            { iva: factura.iva, subtotal: aTexto(dec(factura.total).minus(factura.iva)) },
        )
        // asiento: 2.1.02 al debe por el IVA, la base al ingreso de la línea (H50), CxC al haber; 2.9.01 no se toca
        const movimientos = (await db
            .from('ledger.movimientos as m')
            .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
            .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
            .where('a.origen_tipo', 'nota_credito')
            .where('a.origen_id', nota.id)
            .orderBy('c.codigo')
            .select('c.codigo', 'c.tipo', 'm.debe', 'm.haber')) as Array<{
            tipo: string
            codigo: string
            debe: string
            haber: string
        }>
        assert.deepEqual(
            movimientos.map((m) => [
                m.codigo === '1.1.03' || m.codigo === '2.1.02' ? m.codigo : m.tipo,
                m.debe,
                m.haber,
            ]),
            [
                ['1.1.03', '0.00', '43.98'],
                ['2.1.02', factura.iva, '0.00'],
                ['ingreso', aTexto(dec(factura.total).minus(factura.iva)), '0.00'],
            ],
        )
        const violaciones = await verificarLibro([e.B, e.C], { incluirHallazgosAbiertos: true })
        assert.deepEqual(
            violaciones.map((v) => v.invariante.split(' ')[0]),
            [],
        )
    })

    test('H28 (arreglado en 8814035): anular en un mes abierto una factura de un mes con el libro de ventas emitido no cambia ese libro y la anulación sale en negativo en su mes', async ({
        assert,
    }) => {
        const e = await empresasSinFel()
        const desde = haceMeses(1)
        const s = await mesConMovimiento(e, e.B, desde)
        await habilitar(e, e.B, 'ventas', 1, 50)
        const emision = await new EmitirLibro().execute({ empresa_id: e.B, libro: 'ventas', desde }, e.ctx)
        assert.equal(emision.totales.iva, s.facturas[0]!.iva)
        // la factura del mes cerrado se anula hoy: el reverso cae en el mes abierto
        await new AnularFactura().execute(
            { factura_id: s.facturas[0]!.id, motivo: 'auditoría: anular después del libro' },
            e.ctx,
        )
        const hoy = hoyGuatemala()
        const ventasHoy = await construirLibro('ventas', e.B, {
            desde: inicioDeMes(hoy),
            hasta: finDeMes(hoy),
        })
        // un libro de los dos meses: la original vigente y la anulación en negativo, neto = 2.1.02
        const dosMeses = await construirLibro('ventas', e.B, { desde, hasta: finDeMes(hoy) })
        assert.deepEqual(
            dosMeses.reporte.filas.map((f) => [f.estado, f.iva]),
            [
                ['vigente', s.facturas[0]!.iva],
                ['anulacion', aTexto(CERO.minus(s.facturas[0]!.iva))],
            ],
        )
        assert.equal(
            dosMeses.reporte.totales.iva,
            aTexto(CERO.minus(await neto(e.B, '2.1.02', desde, finDeMes(hoy)))),
        )
        const encontradas = await verificarLibro([e.B, e.C], { incluirHallazgosAbiertos: true })
        const violaciones = encontradas.map((v) => v.invariante.split(' ')[0])
        assert.deepEqual(
            {
                violaciones,
                // el mes de la anulación: su libro de ventas = 2.1.02 del mes
                iva_mes_anulacion: ventasHoy.reporte.totales.iva,
            },
            {
                violaciones: [],
                iva_mes_anulacion: aTexto(
                    CERO.minus(await neto(e.B, '2.1.02', inicioDeMes(hoy), finDeMes(hoy))),
                ),
            },
        )
    })

    test('H29 (arreglado en 8814035): editar al cliente no cambia el libro de ventas ya emitido; el receptor de la factura no se reescribe', async ({
        assert,
    }) => {
        const e = await empresasSinFel()
        const desde = haceMeses(1)
        const s = await mesConMovimiento(e, e.B, desde)
        await habilitar(e, e.B, 'ventas', 1, 50)
        await new EmitirLibro().execute({ empresa_id: e.B, libro: 'ventas', desde }, e.ctx)
        const antes = await construirLibro('ventas', e.B, { desde, hasta: finDeMes(desde) })
        assert.deepEqual(
            antes.reporte.filas.map((f) => f.nit),
            ['CF'],
        )
        const cliente = await db.from('core.clientes').where('id', s.clienteId).firstOrFail()
        await new EditarCliente().execute(
            { id: s.clienteId, version: cliente.version, ...datosNit(), tipo_documento_fiscal: 'nit' },
            e.ctx,
        )
        const despues = await construirLibro('ventas', e.B, { desde, hasta: finDeMes(desde) })
        assert.deepEqual(despues.reporte.filas, antes.reporte.filas)
        // el receptor guardado no se cambia (trigger), tampoco por el dueño de la tabla
        await assert.rejects(
            () =>
                db.rawQuery(
                    `UPDATE billing.facturas SET receptor = '{"tipo":"nit","id":"1","nombre":"x"}'::jsonb WHERE id = ?`,
                    [s.facturas[0]!.id],
                ),
            /no se cambia/,
        )
    })

    test('H30 (arreglado en 8814035): una retención recibida después del libro emitido no cambia ese mes', async ({
        assert,
    }) => {
        const e = await empresasSinFel()
        const desde = haceMeses(1)
        const s = await mesConMovimiento(e, e.B, desde, { clienteId: await crearClienteFila(datosNit()) })
        await habilitar(e, e.B, 'ventas', 1, 50)
        const emision = await new EmitirLibro().execute({ empresa_id: e.B, libro: 'ventas', desde }, e.ctx)
        assert.equal(emision.totales.retenciones, '0.00')
        await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'caja',
                monto: '102.00',
                empresa_id: e.B,
                retenciones: [{ codigo: 'RET_ISR_OPC', numero: `CT-H30-${s.clienteId}`, monto: '10.00' }],
            },
            e.ctx,
        )
        const encontradas = await verificarLibro([e.B, e.C], { incluirHallazgosAbiertos: true })
        const violaciones = encontradas.map((v) => v.invariante.split(' ')[0])
        assert.deepEqual(violaciones, [])
    })

    test('H31 (arreglado en b42c35d): una factura sin FEL que se certifica en un mes posterior suma su IVA una sola vez; el DTE sale informativo', async ({
        assert,
    }) => {
        const e = await empresasSinFel()
        const desde = haceMeses(1)
        const s = await mesConMovimiento(e, e.B, desde, { clienteId: await crearClienteFila(datosNit()) })
        await habilitar(e, e.B, 'ventas', 1, 50)
        const septiembre = await new EmitirLibro().execute({ empresa_id: e.B, libro: 'ventas', desde }, e.ctx)
        assert.equal(septiembre.totales.iva, s.facturas[0]!.iva)
        // la empresa activa la FEL (opcional) y certifica a mano la factura vieja: su DTE nace hoy
        await configurarModo(e, e.B, 'opcional')
        await new SolicitarCertificacion().execute({ factura_id: s.facturas[0]!.id }, e.ctx)
        await cola(e)
        const dte = await db
            .from('fiscal.dte')
            .where({ documento_tipo: 'factura', documento_id: s.facturas[0]!.id })
            .whereNotNull('autorizacion')
            .first()
        assert.isNotNull(dte, 'la factura quedó certificada')
        const hoy = hoyGuatemala()
        const mes = { desde: inicioDeMes(hoy), hasta: finDeMes(hoy) }
        const octubre = await construirLibro('ventas', e.B, mes)
        // Σ IVA de los libros de ventas del año = IVA débito del año (cada venta una sola vez)
        assert.deepEqual(
            {
                septiembre: septiembre.totales.iva,
                octubre: octubre.reporte.totales.iva,
            },
            {
                septiembre: s.facturas[0]!.iva,
                octubre: aTexto(CERO.minus(await neto(e.B, '2.1.02', mes.desde, mes.hasta))),
            },
        )
        const informativo = octubre.reporte.filas.find((f) => f.origen === 'dte')
        assert.include(informativo, { estado: 'certificado_posterior', iva: '0.00', total: '0.00' })
        // el libro de los dos meses suma el IVA una sola vez
        const dosMeses = await construirLibro('ventas', e.B, { desde, hasta: mes.hasta })
        assert.equal(dosMeses.reporte.totales.iva, s.facturas[0]!.iva)
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('H32 (arreglado en 0c5f602): la mora con IVA de una empresa sin FEL sale en el libro de ventas (su IVA está en 2.1.02)', async ({
        assert,
    }) => {
        const e = await empresasSinFel()
        await new EditarParametro().execute(
            {
                clave: 'mora_con_iva',
                valor: true,
                vigente_desde: '2026-01-01',
                motivo: 'contador',
                empresa_id: e.B,
            },
            { ...e.ctx, empresaId: e.B },
        )
        const hoy = hoyGuatemala()
        const d = await servicioFacturado(e.B, inicioDeMes(hoy), {
            precio: '150.00',
            instalacion: inicioDeMes(hoy),
            plantilla: { certificar_al: 'nunca', mora_tipo: 'fija', mora_valor: '22.40', dias_gracia: 0 },
        })
        const vencida = await new VencerFactura().execute({ factura_id: d.facturas[0]!.id, hoy }, e.ctx)
        const mora = await db.from('billing.facturas').where('id', vencida.moras[0]!).firstOrFail()
        assert.containSubset(mora, { tipo: 'mora', aviso_cobro: false, iva: '2.40' })
        const mes = { desde: inicioDeMes(hoy), hasta: finDeMes(hoy) }
        const ventas = await construirLibro('ventas', e.B, mes)
        assert.equal(
            ventas.reporte.totales.iva,
            aTexto(CERO.minus(await neto(e.B, '2.1.02', mes.desde, mes.hasta))),
        )
        // la mora sin IVA (empresa C, sin mora_con_iva) no es documento fiscal ni mueve 2.1.02: no sale
        const c = await servicioFacturado(e.C, inicioDeMes(hoy), {
            precio: '150.00',
            instalacion: inicioDeMes(hoy),
            plantilla: { certificar_al: 'nunca', mora_tipo: 'fija', mora_valor: '20.00', dias_gracia: 0 },
        })
        const sinIva = await new VencerFactura().execute({ factura_id: c.facturas[0]!.id, hoy }, e.ctx)
        assert.lengthOf(sinIva.moras, 1)
        const ventasC = await construirLibro('ventas', e.C, mes)
        assert.deepEqual(
            ventasC.reporte.filas.map((f) => f.tipo),
            ['FACTURA'],
        )
    })

    test('H33 (arreglado en 4393daa): aviso cuyo DTE nace a fin de mes y se certifica en el mes siguiente: el IVA va al mes de la reclasificación y el DTE sale informativo en su mes', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const s = await servicioFel(e, 'pagar', '112.00', await crearClienteFila(datosNit()))
        await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '112.00', empresa_id: e.B },
            e.ctx,
        )
        await cola(e)
        const dte = await db
            .from('fiscal.dte')
            .where({ documento_tipo: 'factura', documento_id: s.facturas[0]!.id })
            .whereNotNull('autorizacion')
            .firstOrFail()
        // el DTE se pidió (pago del 30) el mes anterior y el certificador lo devolvió hoy: la
        // reclasificación queda con la fecha de la certificación
        await db.rawQuery(
            `UPDATE fiscal.dte SET fecha_emision = fecha_emision - interval '1 month' WHERE id = ?`,
            [dte.id],
        )
        const desde = haceMeses(1)
        await cerrarYBloquear(e, e.B, desde)
        await habilitar(e, e.B, 'ventas', 1, 50)
        const emision = await new EmitirLibro().execute({ empresa_id: e.B, libro: 'ventas', desde }, e.ctx)
        assert.deepEqual(
            {
                iva_libro: emision.totales.iva,
                iva_debito: aTexto(CERO.minus(await neto(e.B, '2.1.02', desde, finDeMes(desde)))),
            },
            { iva_libro: '0.00', iva_debito: '0.00' },
        )
        const septiembre = await construirLibro('ventas', e.B, { desde, hasta: finDeMes(desde) })
        assert.deepEqual(
            septiembre.reporte.filas.map((f) => [f.origen, f.estado, f.iva]),
            [['dte', 'reclasificado_posterior', '0.00']],
        )
        const hoy = hoyGuatemala()
        const mes = { desde: inicioDeMes(hoy), hasta: finDeMes(hoy) }
        const octubre = await construirLibro('ventas', e.B, mes)
        assert.include(
            octubre.reporte.filas.map((f) => `${f.origen}:${f.estado}:${f.iva}`),
            `dte:vigente:${s.facturas[0]!.iva}`,
        )
        assert.equal(
            octubre.reporte.totales.iva,
            aTexto(CERO.minus(await neto(e.B, '2.1.02', mes.desde, mes.hasta))),
        )
        await afirmarLibro(assert, [e.B, e.C])
    })
})
