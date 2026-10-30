import { test } from '@japa/runner'
import { unicoBd } from '#tests/billing/ayudas_billing'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { errorDe } from '#tests/contabilidad/ayudas_contabilidad'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { partidas } from '#tests/ledger/ayudas_compras'
import { afirmarCuadre, bodegaEn, productoEn, saldoInventario } from '#tests/inventario/ayudas_inventario'
import CargarSaldoInicial from '#inventario/actions/cargar_saldo_inicial'
import AbrirConteo from '#inventario/actions/abrir_conteo'
import ContarInventario from '#inventario/actions/contar_inventario'
import CerrarConteo from '#inventario/actions/cerrar_conteo'
import CancelarConteo from '#inventario/actions/cancelar_conteo'
import { verConteo } from '#inventario/conteos'
import ConsumirInventario from '#inventario/actions/consumir_inventario'

/**
 * Inventario interno, fase C (`contratos/inventario.md` §10): caso 5, conteo físico con faltante y
 * sobrante; un conteo cerrado no se vuelve a cerrar.
 */

async function movimientosDelConteo(conteoId: number) {
    return db
        .from('inventario.movimientos')
        .where({ origen_tipo: 'conteo', origen_id: conteoId })
        .orderBy('id')
}

test.group('Inventario · fase C · conteos', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('5. conteo con faltante y sobrante: asientos a 5.6.02 y 4.2.04; cerrado no se vuelve a cerrar', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const bodega = await bodegaEn(e.B, e.ctx)
        const cable = await productoEn(e.B, e.ctx)
        const conector = await productoEn(e.B, e.ctx, { nombre: 'Conector RJ45', unidad: 'unidad' })
        const intacto = await productoEn(e.B, e.ctx, { nombre: 'Grapas' })
        const onu = await productoEn(e.B, e.ctx, { nombre: 'ONU', tipo: 'equipo', seguimiento: 'serie' })
        await new CargarSaldoInicial().execute(
            { producto_id: cable.id, bodega_id: bodega.id, cantidad: '100', costo_total: '250.00' },
            e.ctx,
        )
        await new CargarSaldoInicial().execute(
            { producto_id: conector.id, bodega_id: bodega.id, cantidad: '10', costo_total: '15.00' },
            e.ctx,
        )
        await new CargarSaldoInicial().execute(
            { producto_id: intacto.id, bodega_id: bodega.id, cantidad: '5', costo_total: '5.00' },
            e.ctx,
        )
        const serieA = await unicoBd('ONU-A')
        const serieB = await unicoBd('ONU-B')
        const a = await new CargarSaldoInicial().execute(
            { producto_id: onu.id, bodega_id: bodega.id, unidad: { serie: serieA }, costo_total: '300.00' },
            e.ctx,
        )
        const b = await new CargarSaldoInicial().execute(
            { producto_id: onu.id, bodega_id: bodega.id, unidad: { serie: serieB }, costo_total: '310.00' },
            e.ctx,
        )

        const conteo = await new AbrirConteo().execute(
            { bodega_id: bodega.id, motivo: 'cierre de mes' },
            e.ctx,
        )
        assert.equal(conteo.estado, 'abierto')
        const otro = await errorDe(new AbrirConteo().execute({ bodega_id: bodega.id }, e.ctx))
        assert.equal(otro.codigo, 'conteo_abierto')

        // por cantidad: faltan 4 metros de cable; sobran 2 conectores
        await new ContarInventario().execute(
            { conteo_id: conteo.id, producto_id: cable.id, contado: '90' },
            e.ctx,
        )
        // la captura se reemplaza
        await new ContarInventario().execute(
            { conteo_id: conteo.id, producto_id: cable.id, contado: '96' },
            e.ctx,
        )
        await new ContarInventario().execute(
            { conteo_id: conteo.id, producto_id: conector.id, contado: '12' },
            e.ctx,
        )
        // por serie: la A sí, la B no está, y aparece una C que no era de la bodega
        const serieC = await unicoBd('ONU-C')
        await new ContarInventario().execute(
            {
                conteo_id: conteo.id,
                producto_id: onu.id,
                series: [serieA.toLowerCase(), serieC],
                costo_unitario: '280',
            },
            e.ctx,
        )
        const sinSeries = await errorDe(
            new ContarInventario().execute(
                { conteo_id: conteo.id, producto_id: onu.id, contado: '2' },
                e.ctx,
            ),
        )
        assert.include(sinSeries.reglas, 'requiere_unidades')

        // vista previa, sin tocar nada
        const previa = await verConteo(conteo.id)
        assert.deepEqual(
            previa.lineas!.map((l) => [l.producto_id, l.esperado, l.diferencia, l.valor_diferencia]),
            [
                [cable.id, '100.000', '-4.000', '-10.00'],
                [conector.id, '10.000', '2.000', '3.00'],
                [onu.id, '2.000', '0.000', '-5.00'],
            ].sort((x, y) => Number(x[0]) - Number(y[0])),
        )
        assert.deepEqual(await saldoInventario(cable.id, bodega.id), ['100.000', '250.00'])

        const cerrado = await new CerrarConteo().execute({ id: conteo.id, version: previa.version }, e.ctx)
        assert.equal(cerrado.estado, 'cerrado')
        // faltante: 10.00 de cable + 310.00 de la ONU B; sobrante: 3.00 de conectores + la ONU C al
        // promedio de lo que había en la bodega (610 / 2 = 305; el costo_unitario pedido se ignora)
        assert.equal(cerrado.faltante, '320.00')
        assert.equal(cerrado.sobrante, '308.00')

        const movimientos = await movimientosDelConteo(conteo.id)
        assert.deepEqual(
            movimientos.map((m) => [Number(m.producto_id), m.tipo, m.cantidad, m.costo_total]),
            [
                [cable.id, 'ajuste_conteo', '-4.000', '-10.00'],
                [conector.id, 'ajuste_conteo', '2.000', '3.00'],
                [onu.id, 'ajuste_conteo', '-1.000', '-310.00'],
                [onu.id, 'ajuste_conteo', '1.000', '305.00'],
            ].sort((x, y) => Number(x[0]) - Number(y[0])),
        )
        const faltaCable = movimientos.find((m) => Number(m.producto_id) === cable.id)!
        assert.deepEqual(await partidas('inventario', Number(faltaCable.id)), [
            [CUENTAS_GT.MERMAS_INVENTARIO, '10.00', '0.00', null],
            [CUENTAS_GT.INVENTARIOS, '0.00', '10.00', null],
        ])
        const sobraConector = movimientos.find((m) => Number(m.producto_id) === conector.id)!
        assert.deepEqual(await partidas('inventario', Number(sobraConector.id)), [
            [CUENTAS_GT.INVENTARIOS, '3.00', '0.00', null],
            [CUENTAS_GT.SOBRANTES_INVENTARIO, '0.00', '3.00', null],
        ])
        assert.deepEqual(await saldoInventario(cable.id, bodega.id), ['96.000', '240.00'])
        assert.deepEqual(await saldoInventario(conector.id, bodega.id), ['12.000', '18.00'])
        // lo no contado no se toca
        assert.deepEqual(await saldoInventario(intacto.id, bodega.id), ['5.000', '5.00'])
        assert.deepEqual(await saldoInventario(onu.id, bodega.id), ['2.000', '605.00'])
        const unidadB = await db.from('inventario.unidades').where('id', b.unidad_id!).first()
        assert.equal(unidadB.estado, 'dada_de_baja')
        const unidadA = await db.from('inventario.unidades').where('id', a.unidad_id!).first()
        assert.equal(unidadA.estado, 'disponible')
        const unidadC = await db
            .from('inventario.unidades')
            .where({ producto_id: onu.id, serie: serieC.toUpperCase() })
            .first()
        assert.equal(unidadC.estado, 'disponible')
        assert.equal(unidadC.condicion, 'usado')
        assert.equal(unidadC.costo, '305.00')

        // lo guardado al cerrar
        const visto = await verConteo(conteo.id)
        assert.deepEqual(
            visto.lineas!.map((l) => [l.producto_id, l.esperado, l.diferencia, l.valor_diferencia]),
            [
                [cable.id, '100.000', '-4.000', '-10.00'],
                [conector.id, '10.000', '2.000', '3.00'],
                [onu.id, '2.000', '0.000', '-5.00'],
            ].sort((x, y) => Number(x[0]) - Number(y[0])),
        )
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'inventario.conteo_cerrado')
            .whereRaw(`(payload->>'conteo_id')::bigint = ?`, [conteo.id])
            .first()
        assert.equal(evento.payload.faltante, '320.00')
        assert.equal(evento.payload.lineas, 3)

        const otraVez = await errorDe(new CerrarConteo().execute({ id: conteo.id }, e.ctx))
        assert.equal(otraVez.status, 409)
        assert.equal(otraVez.codigo, 'conteo_no_abierto')
        const contarCerrado = await errorDe(
            new ContarInventario().execute(
                { conteo_id: conteo.id, producto_id: cable.id, contado: '1' },
                e.ctx,
            ),
        )
        assert.equal(contarCerrado.codigo, 'conteo_no_abierto')
        assert.lengthOf(await movimientosDelConteo(conteo.id), 4)
        await afirmarCuadre(assert, e.B)

        // se puede abrir otro y cancelarlo sin ajustar
        const segundo = await new AbrirConteo().execute({ bodega_id: bodega.id }, e.ctx)
        await new ContarInventario().execute(
            { conteo_id: segundo.id, producto_id: cable.id, contado: '0' },
            e.ctx,
        )
        const cancelado = await new CancelarConteo().execute(
            { id: segundo.id, motivo: 'se repite mañana' },
            e.ctx,
        )
        assert.equal(cancelado.estado, 'cancelado')
        assert.lengthOf(await movimientosDelConteo(segundo.id), 0)
        assert.deepEqual(await saldoInventario(cable.id, bodega.id), ['96.000', '240.00'])
    })

    test('sobrante sin existencia sin costo conocido 422; rutas y permisos (técnico cuenta, no cierra)', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const cabecera = { 'X-Empresa-Id': String(e.B) }
        const bodega = await bodegaEn(e.B, e.ctx)
        const nuevo = await productoEn(e.B, e.ctx, { nombre: 'Material sin historia' })
        const abierto = await estado(
            client
                .post('/api/v1/inventario/conteos')
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ bodega_id: bodega.id }),
            201,
        )
        const conteoId = abierto.body().id as number
        const tecnico = await usuarioConRoles(['tecnico'])
        await estado(
            client
                .post(`/api/v1/inventario/conteos/${conteoId}/lineas`)
                .bearerToken(tecnico.token)
                .headers(cabecera)
                .json({ producto_id: nuevo.id, contado: '3' }),
            200,
        )
        await estado(
            client
                .post(`/api/v1/inventario/conteos/${conteoId}/cerrar`)
                .bearerToken(tecnico.token)
                .headers(cabecera)
                .json({}),
            403,
        )
        const sinCosto = await estado(
            client
                .post(`/api/v1/inventario/conteos/${conteoId}/cerrar`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json({}),
            422,
        )
        assert.equal(sinCosto.body().errors[0].rule, 'costo_requerido')
        // con su costo, entra
        await estado(
            client
                .post(`/api/v1/inventario/conteos/${conteoId}/lineas`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ producto_id: nuevo.id, contado: '3', costo_unitario: '2.5' }),
            200,
        )
        const cerrado = await estado(
            client
                .post(`/api/v1/inventario/conteos/${conteoId}/cerrar`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json({}),
            200,
        )
        assert.equal(cerrado.body().sobrante, '7.50')
        const lista = await estado(
            client
                .get('/api/v1/inventario/conteos')
                .bearerToken(e.token)
                .headers(cabecera)
                .qs({ bodega_id: bodega.id }),
            200,
        )
        assert.deepEqual(
            lista.body().data.map((c: { id: number; estado: string }) => [c.id, c.estado]),
            [[conteoId, 'cerrado']],
        )
        await afirmarCuadre(assert, e.B)
    })

    test('H56: lo esperado es lo de la captura; lo movido después no es diferencia y se muestra; capturar otra vez lo vuelve a tomar', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const bodega = await bodegaEn(e.B, e.ctx)
        const cable = await productoEn(e.B, e.ctx)
        const grapas = await productoEn(e.B, e.ctx, { nombre: 'Grapas' })
        for (const p of [cable, grapas]) {
            await new CargarSaldoInicial().execute(
                { producto_id: p.id, bodega_id: bodega.id, cantidad: '10', costo_total: '50.00' },
                e.ctx,
            )
        }
        const conteo = await new AbrirConteo().execute({ bodega_id: bodega.id }, e.ctx)
        // cable: se cuentan los 10 y después se consumen 2; grapas: se cuentan 9 (falta 1) y se consumen 2
        await new ContarInventario().execute(
            { conteo_id: conteo.id, producto_id: cable.id, contado: '10' },
            e.ctx,
        )
        await new ContarInventario().execute(
            { conteo_id: conteo.id, producto_id: grapas.id, contado: '9' },
            e.ctx,
        )
        for (const p of [cable, grapas]) {
            await new ConsumirInventario().execute(
                { producto_id: p.id, bodega_id: bodega.id, cantidad: '2' },
                e.ctx,
            )
        }
        const previa = await verConteo(conteo.id)
        assert.deepEqual(
            previa.lineas!.map((l) => [
                l.producto_id,
                l.esperado,
                l.diferencia,
                l.valor_diferencia,
                l.esperado_captura,
                l.valor_captura,
                l.movimientos_desde_captura,
            ]),
            [
                [cable.id, '10.000', '0.000', '0.00', '10.000', '50.00', 1],
                [grapas.id, '10.000', '-1.000', '-5.00', '10.000', '50.00', 1],
            ].sort((x, y) => Number(x[0]) - Number(y[0])),
        )
        const cerrado = await new CerrarConteo().execute({ id: conteo.id }, e.ctx)
        assert.equal(cerrado.sobrante, '0.00')
        assert.equal(cerrado.faltante, '5.00')
        assert.deepEqual(await saldoInventario(cable.id, bodega.id), ['8.000', '40.00'])
        assert.deepEqual(await saldoInventario(grapas.id, bodega.id), ['7.000', '35.00'])
        assert.lengthOf(await movimientosDelConteo(conteo.id), 1)
        // cerrado: lo movido después de la captura sigue a la vista, sin contar los ajustes del cierre
        const visto = await verConteo(conteo.id)
        assert.deepEqual(
            visto.lineas!.map((l) => l.movimientos_desde_captura),
            [1, 1],
        )
        await afirmarCuadre(assert, e.B)

        // capturar otra vez toma de nuevo lo esperado
        const otro = await new AbrirConteo().execute({ bodega_id: bodega.id }, e.ctx)
        await new ContarInventario().execute(
            { conteo_id: otro.id, producto_id: cable.id, contado: '8' },
            e.ctx,
        )
        await new ConsumirInventario().execute(
            { producto_id: cable.id, bodega_id: bodega.id, cantidad: '1' },
            e.ctx,
        )
        const recapturado = await new ContarInventario().execute(
            { conteo_id: otro.id, producto_id: cable.id, contado: '7' },
            e.ctx,
        )
        assert.deepEqual(
            [recapturado.lineas![0]!.esperado_captura, recapturado.lineas![0]!.movimientos_desde_captura],
            ['7.000', 0],
        )
        const sinAjuste = await new CerrarConteo().execute({ id: otro.id }, e.ctx)
        assert.deepEqual([sinAjuste.faltante, sinAjuste.sobrante], ['0.00', '0.00'])
        await afirmarCuadre(assert, e.B)
    })
})
