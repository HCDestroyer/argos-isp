import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { estado, soloEmpresaPrincipal } from '#tests/ayudas'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { bodegaEn, productoEn } from '#tests/inventario/ayudas_inventario'
import { hoyGuatemala } from '#ledger/fechas'
import CargarSaldoInicial from '#inventario/actions/cargar_saldo_inicial'
import ConsumirInventario from '#inventario/actions/consumir_inventario'
import AjustarInventario from '#inventario/actions/ajustar_inventario'

/** Inventario interno, fase C: reporte valorizado a una fecha con su cuadre contra 1.1.14. */

const diasAtras = (n: number) =>
    DateTime.fromISO(hoyGuatemala(), { zone: 'utc' }).minus({ days: n }).toISODate()!

test.group('Inventario · fase C · reporte valorizado', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('existencias y valor a una fecha desde el kardex; el cuadre contra 1.1.14 a la misma fecha', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const cabecera = { 'X-Empresa-Id': String(e.B) }
        const bodega = await bodegaEn(e.B, e.ctx)
        const otra = await bodegaEn(e.B, e.ctx)
        const cable = await productoEn(e.B, e.ctx)
        await new CargarSaldoInicial().execute(
            {
                producto_id: cable.id,
                bodega_id: bodega.id,
                cantidad: '10',
                costo_total: '20.00',
                fecha: diasAtras(10),
            },
            e.ctx,
        )
        await new CargarSaldoInicial().execute(
            {
                producto_id: cable.id,
                bodega_id: otra.id,
                cantidad: '1',
                costo_total: '3.00',
                fecha: diasAtras(10),
            },
            e.ctx,
        )
        await new ConsumirInventario().execute(
            { producto_id: cable.id, bodega_id: bodega.id, cantidad: '8', fecha: diasAtras(4) },
            e.ctx,
        )
        await new AjustarInventario().execute(
            { producto_id: cable.id, bodega_id: bodega.id, cantidad: '6', motivo: 'sobrante' },
            e.ctx,
        )
        const a = async (qs: Record<string, unknown>) =>
            (
                await estado(
                    client
                        .get('/api/v1/reportes/inventario-valorizado')
                        .bearerToken(e.token)
                        .headers(cabecera)
                        .qs(qs),
                    200,
                )
            ).body()
        const filas = (r: { data: Array<{ bodega_id: number; cantidad: string; valor: string }> }) =>
            r.data.map((f) => [f.bodega_id, f.cantidad, f.valor])

        const antes = await a({ fecha: diasAtras(11) })
        assert.deepEqual(antes.data, [])
        assert.deepEqual(antes.cuadre, [
            { empresa_id: e.B, valor_kardex: '0.00', saldo_libro: '0.00', diferencia: '0.00' },
        ])
        const hace5 = await a({ fecha: diasAtras(5) })
        assert.sameDeepMembers(filas(hace5), [
            [bodega.id, '10.000', '20.00'],
            [otra.id, '1.000', '3.00'],
        ])
        assert.equal(hace5.total, '23.00')
        assert.equal(hace5.cuadre[0].diferencia, '0.00')
        const hace3 = await a({ fecha: diasAtras(3), bodega_id: bodega.id })
        assert.deepEqual(filas(hace3), [[bodega.id, '2.000', '4.00']])
        assert.equal(hace3.data[0].costo_promedio, '2.000000')
        // el cuadre es de la empresa, sin el filtro de bodega
        assert.deepEqual(hace3.cuadre[0], {
            empresa_id: e.B,
            valor_kardex: '7.00',
            saldo_libro: '7.00',
            diferencia: '0.00',
        })
        const hoy = await a({})
        assert.equal(hoy.fecha, hoyGuatemala())
        assert.equal(hoy.total, '19.00')
        assert.equal(hoy.cuadre[0].saldo_libro, '19.00')
    })
})
