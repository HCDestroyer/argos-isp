import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { prepararEmpresas, servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { verificarLibro } from '#tests/contabilidad/verificar_libro'
import ImportarFacturaPendiente from '#billing/actions/importar_factura_pendiente'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import AnularFactura from '#billing/actions/anular_factura'
import RegistrarPago from '#billing/actions/registrar_pago'
import EditarCliente from '#core/actions/editar_cliente'
import EmitirLibro from '#fiscal/actions/emitir_libro'
import { construirLibro, finDeMes } from '#fiscal/libros_legales'
import { CERO, aTexto } from '#ledger/dinero'
import { hoyGuatemala, inicioDeMes } from '#ledger/fechas'
import { empresasSinFel, habilitar, mesConMovimiento, neto } from '#tests/contabilidad/ayudas_libros'
import { haceMeses } from '#tests/ledger/ayudas_compras'
import { datosNit } from '#tests/fiscal/ayudas_fel'
import { crearClienteFila } from '#tests/core/fabricas'

/**
 * Auditor contable · hallazgos abiertos de la fase 6. Cada uno con su `.fails` mientras exista; su
 * invariante está en `HALLAZGOS_ABIERTOS` y no lo revisan las demás pruebas.
 *
 * H27 (lo destapó el generativo en fase 6 PR B, y está en main): una factura importada guarda su IVA
 * desglosado (`iva` > 0) pero su asiento es CxC / 2.9.01 sin IVA; una nota de crédito por su total se
 * guarda con IVA 0. Σ IVA de las notas ≠ IVA de la factura acreditada completa. Qué IVA debe llevar
 * esa nota (o si la importada debe guardar `iva` 0) lo decide el PM. Sigue abierto: en Japa un
 * `.fails` que falla como se espera sale en el resumen como «regression» (no es que pase).
 *
 * H28–H30 (fase 6 PR D, libros con folio): el libro de ventas de un mes cerrado, bloqueado y ya
 * emitido cambia con hechos posteriores (anulación, dato fiscal del cliente, retención recibida). El
 * inv. 20.libro_emitido_cambio lo detecta (H28, H30); H29 compara las filas.
 */

test.group('Auditor contable · hallazgos de la fase 6', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('H27: la nota de crédito por el total de una factura importada con IVA deja IVA residual', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await servicioEn(e.B)
        const importada = await new ImportarFacturaPendiente().execute(
            {
                origen: 'auditoria',
                id_externo: unico('f'),
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
        await new EmitirNotaCredito().execute(
            { factura_id: importada.factura_id!, monto: '43.98', motivo: 'auditoría: acredita el total' },
            e.ctx,
        )
        const violaciones = await verificarLibro([e.B, e.C], { incluirHallazgosAbiertos: true })
        assert.deepEqual(
            violaciones.map((v) => v.invariante.split(' ')[0]),
            [],
        )
    }).fails('H27: nota de crédito sobre una factura importada con IVA (decisión del PM pendiente)')

    test('H28: anular en un mes abierto una factura de un mes con el libro de ventas emitido cambia ese libro (y el anulado no sale en el mes de la anulación)', async ({
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
    }).fails(
        'H28: el libro de ventas pone en cero el anulado en el mes del documento aunque ese mes ya tenga libro emitido',
    )

    test('H29: el libro de ventas sin FEL toma el NIT actual del cliente: editar al cliente cambia el libro ya emitido', async ({
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
    }).fails(
        'H29: el receptor de una factura sin DTE es el dato fiscal actual del cliente, no el de la fecha de la factura',
    )

    test('H30: una retención recibida después del libro emitido cambia la columna de retenciones de ese mes', async ({
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
    }).fails('H30: las retenciones del libro de ventas se leen al día de hoy, no al cierre del mes emitido')
})
