import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { unicoBd } from '#tests/billing/ayudas_billing'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { partidas } from '#tests/ledger/ayudas_compras'
import { afirmarCuadre, bodegaEn, productoEn, saldoInventario } from '#tests/inventario/ayudas_inventario'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'

/**
 * Fase D, pedido 4 (`contratos/inventario.md` D.4): alta de productos por lotes, todo o nada, con
 * `errors[]` por fila y `Idempotency-Key`; la entrada opcional es un saldo inicial (1.1.14 / 2.9.01).
 */

async function contarProductos(empresaId: number) {
    const fila = await db.from('inventario.productos').where('empresa_id', empresaId).count('* as n').first()
    return Number(fila.n)
}

test.group('Inventario · productos por lotes (fase D)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('valida todas las filas antes de escribir y responde todos los errores por fila', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const cabecera = { 'X-Empresa-Id': String(e.B) }
        const existente = await productoEn(e.B, e.ctx)
        const bodega = await bodegaEn(e.B, e.ctx)
        const antes = await contarProductos(e.B)
        const sku = unico('L')
        // sin Idempotency-Key
        await estado(
            client
                .post('/api/v1/productos/lote')
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ productos: [{ sku, nombre: 'Uno', tipo: 'material' }] }),
            400,
        )
        const respuesta = await estado(
            client
                .post('/api/v1/productos/lote')
                .bearerToken(e.token)
                .headers(cabecera)
                .header('Idempotency-Key', unico('lote'))
                .json({
                    productos: [
                        { sku, nombre: 'Uno', tipo: 'material' },
                        { sku: sku.toLowerCase(), nombre: 'Repetido en el lote', tipo: 'material' },
                        { sku: existente.sku, nombre: 'Ya existe', tipo: 'material' },
                        { sku: unico('L'), nombre: 'Tipo raro', tipo: 'no_existe' },
                        {
                            sku: unico('L'),
                            nombre: 'Gasto por serie',
                            tipo: 'equipo',
                            modalidad: 'consumible_gasto',
                        },
                        {
                            sku: unico('L'),
                            nombre: 'Serie sin unidades',
                            tipo: 'equipo',
                            entrada: { bodega_id: bodega.id },
                        },
                        {
                            sku: unico('L'),
                            nombre: 'Cantidad sin costo',
                            tipo: 'material',
                            entrada: { bodega_id: bodega.id, cantidad: '5' },
                        },
                    ],
                }),
            422,
        )
        const campos = respuesta
            .body()
            .errors.map((x: { field: string; rule: string }) => `${x.field}:${x.rule}`)
        assert.includeMembers(campos, [
            'productos.1.sku:sku_duplicado',
            'productos.2.sku:sku_duplicado',
            'productos.3.tipo:tipo',
            'productos.4.modalidad:modalidad',
            'productos.5.entrada.unidades:requiere_unidades',
            'productos.6.entrada.costo_unitario:costo',
        ])
        assert.equal(await contarProductos(e.B), antes, 'nada se creó')
        // un técnico no tiene el permiso
        const tecnico = await usuarioConRoles(['tecnico'])
        await estado(
            client
                .post('/api/v1/productos/lote')
                .bearerToken(tecnico.token)
                .headers(cabecera)
                .header('Idempotency-Key', unico('lote'))
                .json({ productos: [{ sku: unico('L'), nombre: 'Uno', tipo: 'material' }] }),
            403,
        )
    })

    test('crea todo con su saldo inicial (1.1.14 / 2.9.01) y deshace todo si una fila falla al crear', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const cabecera = { 'X-Empresa-Id': String(e.B) }
        const bodega = await bodegaEn(e.B, e.ctx)
        const series = [await unicoBd('S'), await unicoBd('S')]
        const clave = unico('lote')
        const cuerpo = {
            productos: [
                {
                    sku: unico('CBL'),
                    nombre: 'Cable drop',
                    tipo: 'material',
                    unidad: 'metro',
                    entrada: { bodega_id: bodega.id, cantidad: '100', costo_unitario: '2.5' },
                },
                {
                    sku: unico('ONU'),
                    nombre: 'ONU XPON',
                    tipo: 'equipo',
                    entrada: {
                        bodega_id: bodega.id,
                        unidades: [
                            { serie: series[0], costo: '300.00' },
                            { serie: series[1], costo: '310.00' },
                        ],
                    },
                },
                {
                    sku: unico('GRP'),
                    nombre: 'Grapas',
                    tipo: 'material',
                    modalidad: 'consumible_cobro',
                    precio_venta: '1.12',
                },
            ],
        }
        const respuesta = await estado(
            client
                .post('/api/v1/productos/lote')
                .bearerToken(e.token)
                .headers(cabecera)
                .header('Idempotency-Key', clave)
                .json(cuerpo),
            201,
        )
        const r = respuesta.body()
        assert.lengthOf(r.data, 3)
        assert.equal(r.data[1].seguimiento, 'serie')
        assert.equal(r.data[1].modalidad, 'comodato')
        assert.equal(r.data[2].modalidad, 'consumible_cobro')
        assert.lengthOf(r.movimientos, 3)
        assert.deepEqual(
            r.movimientos.map((m: { tipo: string; costo_total: string }) => [m.tipo, m.costo_total]),
            [
                ['saldo_inicial', '250.00'],
                ['saldo_inicial', '300.00'],
                ['saldo_inicial', '310.00'],
            ],
        )
        const asiento = await partidas('inventario', r.movimientos[0].id)
        assert.deepEqual(
            asiento.map(([c, d, h]) => [c, d, h]),
            [
                [CUENTAS_GT.INVENTARIOS, '250.00', '0.00'],
                ['2.9.01', '0.00', '250.00'],
            ],
        )
        assert.deepEqual(await saldoInventario(r.data[1].id, bodega.id), ['2.000', '610.00'])
        // la misma clave: la misma respuesta, nada nuevo
        const antes = await contarProductos(e.B)
        const repetida = await estado(
            client
                .post('/api/v1/productos/lote')
                .bearerToken(e.token)
                .headers(cabecera)
                .header('Idempotency-Key', clave)
                .json(cuerpo),
            201,
        )
        assert.deepEqual(
            repetida.body().data.map((p: { id: number }) => p.id),
            r.data.map((p: { id: number }) => p.id),
        )
        assert.equal(await contarProductos(e.B), antes)

        // una serie que ya existe en la empresa falla al crear: nada queda, error de su fila
        const falla = await estado(
            client
                .post('/api/v1/productos/lote')
                .bearerToken(e.token)
                .headers(cabecera)
                .header('Idempotency-Key', unico('lote'))
                .json({
                    productos: [
                        { sku: unico('OK'), nombre: 'Este sí', tipo: 'material' },
                        {
                            sku: unico('RT'),
                            nombre: 'Router',
                            tipo: 'equipo',
                            entrada: {
                                bodega_id: bodega.id,
                                unidades: [{ serie: series[0], costo: '100.00' }],
                            },
                        },
                    ],
                }),
            422,
        )
        assert.match(falla.body().errors[0].field, /^productos\.1\./)
        assert.equal(await contarProductos(e.B), antes)
        await afirmarCuadre(assert, e.B)
    })
})
