import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { productoEn } from '#tests/inventario/ayudas_inventario'

/**
 * Fase D, pedidos 2 y 3 (`contratos/inventario.md` D.2 y D.3): tipos de producto editables por empresa
 * o globales, con su seguimiento y modalidad por defecto, sin romper la API (`tipo` sigue siendo el
 * código), y la modalidad de cada producto.
 */

function codigo() {
    return unico('t')
        .toLowerCase()
        .replaceAll(/[^a-z0-9_]/g, '_')
        .slice(0, 40)
}

test.group('Inventario · tipos de producto y modalidad (fase D)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('semillas globales, tipo de la empresa con sus valores por defecto y la API de siempre', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const cabecera = { 'X-Empresa-Id': String(e.B) }
        const lista = await estado(
            client.get('/api/v1/inventario/tipos-producto?limit=100').bearerToken(e.token).headers(cabecera),
            200,
        )
        const globales = lista.body().data.filter((t: { empresa_id: number | null }) => t.empresa_id === null)
        assert.includeMembers(
            globales.map((t: { codigo: string }) => t.codigo),
            ['equipo', 'material', 'otro'],
        )
        const equipo = globales.find((t: { codigo: string }) => t.codigo === 'equipo')
        assert.equal(equipo.seguimiento_defecto, 'serie')
        assert.equal(equipo.modalidad_defecto, 'comodato')

        // un tipo de la empresa
        const cod = codigo()
        const creado = await estado(
            client.post('/api/v1/inventario/tipos-producto').bearerToken(e.token).headers(cabecera).json({
                codigo: cod.toUpperCase(),
                nombre: 'Accesorios cobrados',
                seguimiento_defecto: 'cantidad',
                modalidad_defecto: 'consumible_cobro',
            }),
            201,
        )
        const tipo = creado.body()
        assert.equal(tipo.codigo, cod)
        assert.equal(tipo.empresa_id, e.B)
        // no repite un código global ni uno propio
        await estado(
            client.post('/api/v1/inventario/tipos-producto').bearerToken(e.token).headers(cabecera).json({
                codigo: 'material',
                nombre: 'Otro material',
                seguimiento_defecto: 'cantidad',
                modalidad_defecto: 'consumible_gasto',
            }),
            409,
        )
        // modalidad incompatible con el seguimiento
        const incompatible = await estado(
            client.post('/api/v1/inventario/tipos-producto').bearerToken(e.token).headers(cabecera).json({
                codigo: codigo(),
                nombre: 'Malo',
                seguimiento_defecto: 'cantidad',
                modalidad_defecto: 'comodato',
            }),
            422,
        )
        assert.equal(incompatible.body().errors[0].field, 'modalidad_defecto')

        // un producto con el tipo nuevo toma su seguimiento y su modalidad
        const accesorio = await estado(
            client
                .post('/api/v1/productos')
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ sku: unico('ACC'), nombre: 'Conector RJ45 cobrado', tipo: cod }),
            201,
        )
        assert.equal(accesorio.body().tipo, cod)
        assert.equal(accesorio.body().tipo_id, tipo.id)
        assert.equal(accesorio.body().tipo_nombre, 'Accesorios cobrados')
        assert.equal(accesorio.body().seguimiento, 'cantidad')
        assert.equal(accesorio.body().modalidad, 'consumible_cobro')

        // la API de antes: equipo + cantidad sigue valiendo (gasto); equipo sin seguimiento → serie y comodato
        const equipoCantidad = await productoEn(e.B, e.ctx, { tipo: 'equipo', seguimiento: 'cantidad' })
        assert.equal(equipoCantidad.modalidad, 'consumible_gasto')
        const router = await productoEn(e.B, e.ctx, { tipo: 'equipo', seguimiento: undefined })
        assert.equal(router.seguimiento, 'serie')
        assert.equal(router.modalidad, 'comodato')
        assert.equal(router.clase_activo, 'equipo_red')
        // un tipo que no existe
        await estado(
            client
                .post('/api/v1/productos')
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ sku: unico('X'), nombre: 'Producto raro', tipo: 'no_existe' }),
            422,
        )
        // el tipo de la empresa B no existe para la C
        await estado(
            client
                .post('/api/v1/productos')
                .bearerToken(e.token)
                .headers({ 'X-Empresa-Id': String(e.C) })
                .json({ sku: unico('X'), nombre: 'En la otra empresa', tipo: cod }),
            422,
        )

        // editar con version y desactivar
        await estado(
            client
                .post(`/api/v1/inventario/tipos-producto/${tipo.id}/editar`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ version: 99, nombre: 'Equis' }),
            409,
        )
        const editado = await estado(
            client
                .post(`/api/v1/inventario/tipos-producto/${tipo.id}/editar`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ version: 1, nombre: 'Accesorios', seguimiento_defecto: 'serie' }),
            200,
        )
        assert.equal(editado.body().version, 2)
        assert.equal(editado.body().modalidad_defecto, 'consumible_cobro')
        await estado(
            client
                .post(`/api/v1/inventario/tipos-producto/${tipo.id}/desactivar`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ version: 2 }),
            200,
        )
        const inactivo = await estado(
            client
                .post('/api/v1/productos')
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ sku: unico('ACC'), nombre: 'Otro accesorio', tipo: cod }),
            422,
        )
        assert.equal(inactivo.body().errors[0].rule, 'tipo_inactivo')
        // el producto que ya lo usaba sigue igual
        const sigue = await estado(
            client.get(`/api/v1/productos/${accesorio.body().id}`).bearerToken(e.token).headers(cabecera),
            200,
        )
        assert.equal(sigue.body().modalidad, 'consumible_cobro')
        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'tipo_producto', entidad_id: tipo.id })
            .select('campo')
        assert.includeMembers(
            cambios.map((c) => c.campo),
            ['codigo', 'nombre', 'seguimiento_defecto', 'activo'],
        )
    })

    test('modalidad del producto: compatible con su seguimiento, editable y con audit.cambios', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const cabecera = { 'X-Empresa-Id': String(e.B) }
        const router = await productoEn(e.B, e.ctx, { tipo: 'equipo', seguimiento: 'serie' })
        assert.equal(router.modalidad, 'comodato')
        const gasto = await estado(
            client
                .post(`/api/v1/productos/${router.id}/editar`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ version: router.version, modalidad: 'consumible_gasto' }),
            422,
        )
        assert.equal(gasto.body().errors[0].field, 'modalidad')
        const venta = await estado(
            client
                .post(`/api/v1/productos/${router.id}/editar`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ version: router.version, modalidad: 'consumible_cobro', precio_venta: '450.00' }),
            200,
        )
        assert.equal(venta.body().modalidad, 'consumible_cobro')
        // sin movimientos, pasar a cantidad deja la modalidad que va (consumible_cobro sigue valiendo)
        const cantidad = await estado(
            client
                .post(`/api/v1/productos/${router.id}/editar`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ version: venta.body().version, seguimiento: 'cantidad', tipo: 'material' }),
            200,
        )
        assert.equal(cantidad.body().modalidad, 'consumible_cobro')
        assert.equal(cantidad.body().tipo, 'material')
        // un comodato que pasa a cantidad sin decir modalidad queda en consumible_gasto
        const onu = await productoEn(e.B, e.ctx, { tipo: 'equipo', seguimiento: 'serie' })
        const aCantidad = await estado(
            client
                .post(`/api/v1/productos/${onu.id}/editar`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ version: onu.version, seguimiento: 'cantidad' }),
            200,
        )
        assert.equal(aCantidad.body().modalidad, 'consumible_gasto')
        const filtro = await estado(
            client.get('/api/v1/productos?modalidad=consumible_cobro').bearerToken(e.token).headers(cabecera),
            200,
        )
        assert.include(
            filtro.body().data.map((p: { id: number }) => p.id),
            router.id,
        )
        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'producto', entidad_id: router.id, campo: 'modalidad' })
            .first()
        assert.exists(cambios)
    })
})
