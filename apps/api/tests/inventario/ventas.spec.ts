import { test } from '@japa/runner'
import { unicoBd } from '#tests/billing/ayudas_billing'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { errorDe, servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { partidas } from '#tests/ledger/ayudas_compras'
import { afirmarCuadre, bodegaEn, productoEn, saldoInventario } from '#tests/inventario/ayudas_inventario'
import EmitirCargoUnico from '#billing/actions/emitir_cargo_unico'
import AnularFactura from '#billing/actions/anular_factura'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import CargarSaldoInicial from '#inventario/actions/cargar_saldo_inicial'

/**
 * Inventario interno, fase C (`contratos/inventario.md` §10): caso 4 (venta por cargo único de un
 * router de serie con su costo específico; anular la factura lo reingresa) y la venta por cantidad con
 * su nota de crédito por línea.
 */

async function conceptoEquipo(empresaId: number): Promise<number> {
    await db.rawQuery('SELECT billing.sembrar_catalogos_cargo(?)', [empresaId])
    const fila = await db
        .from('billing.conceptos_cargo')
        .where({ empresa_id: empresaId, nombre: 'Equipo' })
        .select('id')
        .firstOrFail()
    return Number(fila.id)
}

async function ventaDeLaFactura(facturaId: number) {
    return db
        .from('inventario.movimientos')
        .where({ origen_tipo: 'factura', origen_id: facturaId })
        .orderBy('id')
}

test.group('Inventario · fase C · venta', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('4. venta por cargo único de un router de serie: costo de ventas por su costo específico; anular la factura lo reingresa al mismo costo', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const router = await productoEn(e.B, e.ctx, {
            nombre: 'Router',
            tipo: 'equipo',
            seguimiento: 'serie',
        })
        const bodega = await bodegaEn(e.B, e.ctx)
        const inicial = await new CargarSaldoInicial().execute(
            {
                producto_id: router.id,
                bodega_id: bodega.id,
                unidad: { serie: await unicoBd('RT') },
                costo_total: '250.00',
            },
            e.ctx,
        )
        const unidadId = inicial.unidad_id!
        const { servicioId } = await servicioEn(e.B)
        const concepto = await conceptoEquipo(e.B)
        const cargo = await new EmitirCargoUnico().execute(
            {
                servicio_id: servicioId,
                lineas: [
                    {
                        concepto_id: concepto,
                        precio_unitario: '448.00',
                        producto_id: router.id,
                        bodega_id: bodega.id,
                        unidad_id: unidadId,
                    },
                ],
            },
            e.ctx,
        )
        assert.equal(cargo.documento, 'factura')
        const [venta] = await ventaDeLaFactura(cargo.id)
        assert.equal(venta.tipo, 'venta')
        assert.equal(venta.costo_total, '-250.00')
        assert.equal(Number(venta.unidad_id), unidadId)
        assert.deepEqual(await partidas('inventario', Number(venta.id)), [
            [CUENTAS_GT.COSTO_EQUIPO_VENDIDO, '250.00', '0.00', null],
            [CUENTAS_GT.INVENTARIOS, '0.00', '250.00', null],
        ])
        const vendida = await db.from('inventario.unidades').where('id', unidadId).first()
        assert.equal(vendida.estado, 'vendida')
        assert.deepEqual(await saldoInventario(router.id, bodega.id), ['0.000', '0.00'])
        // ya vendida: no se vende otra vez
        const otraVez = await errorDe(
            new EmitirCargoUnico().execute(
                {
                    servicio_id: servicioId,
                    lineas: [
                        {
                            concepto_id: concepto,
                            precio_unitario: '448.00',
                            producto_id: router.id,
                            bodega_id: bodega.id,
                            unidad_id: unidadId,
                        },
                    ],
                },
                e.ctx,
            ),
        )
        assert.equal(otraVez.status, 409)
        await afirmarCuadre(assert, e.B)

        await new AnularFactura().execute({ factura_id: cargo.id, motivo: 'se canceló la venta' }, e.ctx)
        const movimientos = await ventaDeLaFactura(cargo.id)
        assert.deepEqual(
            movimientos.map((m) => [m.tipo, m.costo_total]),
            [
                ['venta', '-250.00'],
                ['reverso_venta', '250.00'],
            ],
        )
        const vuelve = await db.from('inventario.unidades').where('id', unidadId).first()
        assert.equal(vuelve.estado, 'disponible')
        assert.equal(Number(vuelve.bodega_id), bodega.id)
        assert.deepEqual(await saldoInventario(router.id, bodega.id), ['1.000', '250.00'])
        await afirmarCuadre(assert, e.B)
    })

    test('venta por cantidad al promedio; una nota de crédito por toda la línea la reingresa; sin existencia 409; un cargo en Q0 con producto 422', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const cable = await productoEn(e.B, e.ctx)
        const bodega = await bodegaEn(e.B, e.ctx)
        await new CargarSaldoInicial().execute(
            { producto_id: cable.id, bodega_id: bodega.id, cantidad: '3', costo_total: '10.00' },
            e.ctx,
        )
        const { servicioId } = await servicioEn(e.B)
        const concepto = await conceptoEquipo(e.B)
        const sinExistencia = await errorDe(
            new EmitirCargoUnico().execute(
                {
                    servicio_id: servicioId,
                    lineas: [
                        {
                            concepto_id: concepto,
                            cantidad: '4',
                            precio_unitario: '11.20',
                            producto_id: cable.id,
                            bodega_id: bodega.id,
                        },
                    ],
                },
                e.ctx,
            ),
        )
        assert.equal(sinExistencia.codigo, 'existencia_insuficiente')
        const cargo = await new EmitirCargoUnico().execute(
            {
                servicio_id: servicioId,
                lineas: [
                    {
                        concepto_id: concepto,
                        cantidad: '1',
                        precio_unitario: '11.20',
                        producto_id: cable.id,
                        bodega_id: bodega.id,
                    },
                ],
            },
            e.ctx,
        )
        const [venta] = await ventaDeLaFactura(cargo.id)
        assert.equal(venta.costo_total, '-3.33')
        assert.deepEqual(await saldoInventario(cable.id, bodega.id), ['2.000', '6.67'])
        const linea = await db
            .from('billing.facturas_lineas')
            .where('factura_id', cargo.id)
            .whereNotNull('producto_id')
            .firstOrFail()
        assert.equal(Number(linea.producto_id), cable.id)
        await new EmitirNotaCredito().execute(
            {
                factura_id: cargo.id,
                motivo: 'devolución del material',
                lineas: [{ linea_id: Number(linea.id), monto: '11.20' }],
            },
            e.ctx,
        )
        const reverso = await db
            .from('inventario.movimientos')
            .where({ factura_linea_id: Number(linea.id), tipo: 'reverso_venta' })
            .firstOrFail()
        assert.equal(reverso.costo_total, '3.33')
        assert.equal(reverso.origen_tipo, 'nota_credito')
        assert.deepEqual(await saldoInventario(cable.id, bodega.id), ['3.000', '10.00'])

        const motivo = await db.from('billing.motivos_sin_costo').where({ empresa_id: e.B }).firstOrFail()
        const gratis = await errorDe(
            new EmitirCargoUnico().execute(
                {
                    servicio_id: servicioId,
                    motivo_sin_costo_id: Number(motivo.id),
                    motivo_sin_costo_texto: 'cortesía',
                    lineas: [
                        {
                            concepto_id: concepto,
                            precio_unitario: '11.20',
                            descuentos: [{ concepto: 'cortesía', monto: '11.20' }],
                            producto_id: cable.id,
                            bodega_id: bodega.id,
                        },
                    ],
                },
                e.ctx,
            ),
        )
        assert.include(gratis.reglas, 'producto_sin_costo')
        await afirmarCuadre(assert, e.B)
    })
})
