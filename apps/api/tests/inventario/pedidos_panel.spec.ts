import { test } from '@japa/runner'
import { unicoBd } from '#tests/billing/ayudas_billing'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { haceMeses, proveedorEn } from '#tests/ledger/ayudas_compras'
import { bodegaEn, productoEn } from '#tests/inventario/ayudas_inventario'
import { Problema } from '#shared/errores'
import EditarProducto from '#inventario/actions/editar_producto'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import type { ContextoAccion } from '#shared/contexto'

/**
 * Pedidos de A4 sobre el inventario: precio de venta sugerido del producto (cargo único) y el 422 de
 * una compra con menos series que su cantidad.
 */

async function problemaDe(promesa: Promise<unknown>) {
    try {
        await promesa
    } catch (error) {
        if (error instanceof Problema) {
            return { status: error.status, tipo: error.tipo, errores: error.errores ?? [] }
        }
        throw error
    }
    throw new Error('Se esperaba un error de dominio')
}

async function compraDeSerie(
    ctx: ContextoAccion,
    datos: { proveedorId: number; producto_id: number; bodega_id: number; cantidad: number; series: number },
) {
    return new RegistrarCompra().execute(
        {
            proveedor_id: datos.proveedorId,
            tipo_documento: 'FACT',
            numero: await unicoBd('F'),
            fecha_documento: haceMeses(0),
            condicion: 'credito',
            lineas: [
                {
                    descripcion: 'Routers',
                    tipo: 'bien',
                    total: '1008.00',
                    cantidad: datos.cantidad,
                    producto_id: datos.producto_id,
                    bodega_id: datos.bodega_id,
                    unidades: await Promise.all(
                        Array.from({ length: datos.series }, async () => ({ serie: await unicoBd('SN') })),
                    ),
                },
            ],
        },
        ctx,
    )
}

test.group('Inventario · pedidos del panel (A4)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('precio_venta: opcional con 2 decimales, sale en la API, se edita con version y deja audit.cambios', async ({
        assert,
        client,
    }) => {
        const e = await prepararEmpresasGt()
        const sinPrecio = await productoEn(e.B, e.ctx)
        assert.isNull(sinPrecio.precio_venta)
        const router = await productoEn(e.B, e.ctx, {
            nombre: 'Router WiFi',
            unidad: 'unidad',
            tipo: 'equipo',
            seguimiento: 'serie',
            precio_venta: '450',
        })
        assert.equal(router.precio_venta, '450.00')

        const { token } = await usuarioConRoles(['admin'])
        const leido = await estado(
            client
                .get(`/api/v1/productos/${router.id}`)
                .bearerToken(token)
                .header('X-Empresa-Id', String(e.B)),
            200,
        )
        assert.equal(leido.body().precio_venta, '450.00')
        // el validador rechaza un precio negativo o con 3 decimales
        for (const precio of ['-1.00', '1.234']) {
            const r = await estado(
                client
                    .post(`/api/v1/productos/${router.id}/editar`)
                    .bearerToken(token)
                    .header('X-Empresa-Id', String(e.B))
                    .json({ version: router.version, precio_venta: precio }),
                422,
            )
            assert.equal(r.body().errors[0].field, 'precio_venta')
        }

        const editado = await new EditarProducto().execute(
            { id: router.id, version: router.version, precio_venta: '399.9' },
            e.ctx,
        )
        assert.include(editado, { precio_venta: '399.90', version: router.version + 1 })
        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'producto', entidad_id: router.id, campo: 'precio_venta' })
            .orderBy('id', 'desc')
            .firstOrFail()
        assert.deepEqual([cambio.antes, cambio.despues], ['450.00', '399.90'])

        const conflicto = await problemaDe(
            new EditarProducto().execute(
                { id: router.id, version: router.version, precio_venta: '1.00' },
                e.ctx,
            ),
        )
        assert.equal(conflicto.status, 409)
        const quitado = await new EditarProducto().execute(
            { id: router.id, version: editado.version, precio_venta: null },
            e.ctx,
        )
        assert.isNull(quitado.precio_venta)
        const accion = await problemaDe(
            new EditarProducto().execute(
                { id: router.id, version: quitado.version, precio_venta: '1.234' },
                e.ctx,
            ),
        )
        assert.equal(accion.status, 422)
        assert.deepEqual(
            accion.errores.map((x) => [x.field, x.rule]),
            [['precio_venta', 'monto']],
        )
    })

    test('compra de serie con menos series que su cantidad: 422 validacion, requiere_unidades en lineas.N.unidades; con más, cantidad', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const router = await productoEn(e.B, e.ctx, {
            nombre: 'Router WiFi',
            unidad: 'unidad',
            tipo: 'equipo',
            seguimiento: 'serie',
        })
        const bodega = await bodegaEn(e.B, e.ctx)
        const proveedor = await proveedorEn(e.B, e.ctx)
        const datos = { proveedorId: proveedor.id, producto_id: router.id, bodega_id: bodega.id, cantidad: 3 }
        for (const series of [0, 2]) {
            const r = await problemaDe(compraDeSerie(e.ctx, { ...datos, series }))
            assert.equal(r.status, 422)
            assert.match(r.tipo, /validacion$/)
            assert.deepEqual(
                r.errores.map((x) => [x.field, x.rule]),
                [['lineas.0.unidades', 'requiere_unidades']],
                `${series} series`,
            )
        }
        const mas = await problemaDe(compraDeSerie(e.ctx, { ...datos, series: 4 }))
        assert.deepEqual(
            mas.errores.map((x) => [x.field, x.rule]),
            [['lineas.0.cantidad', 'cantidad']],
        )
        const bien = await compraDeSerie(e.ctx, { ...datos, series: 3 })
        assert.isNumber(bien.id)
    })
})
