import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { partidas } from '#tests/ledger/ayudas_compras'
import {
    afirmarCuadre,
    bodegaEn,
    comprarInventario,
    contarMovimientos,
    productoEn,
    saldoInventario,
} from '#tests/inventario/ayudas_inventario'
import { comprarSeries, tecnicoConBodega } from '#tests/inventario/ayudas_fase_d'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'

/**
 * Fase D, pedidos 3 y 6 (`contratos/inventario.md` D.3 y D.6): el consumo a un servicio aplica la
 * modalidad de cada producto. Gasto (lo de siempre), cobro (cargo único al cliente con la venta del
 * kardex y su asiento de costo, y el ingreso con IVA de la factura) y comodato; el lote de una orden de
 * Iris, todo o nada, desde la bodega del técnico.
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

async function preparar() {
    const e = await prepararEmpresasGt()
    const cabecera = { 'X-Empresa-Id': String(e.B) }
    const concepto = await conceptoEquipo(e.B)
    const central = await bodegaEn(e.B, e.ctx)
    const cable = await productoEn(e.B, e.ctx)
    const conector = await productoEn(e.B, e.ctx, {
        nombre: 'Conector RJ45 cobrado',
        unidad: 'unidad',
        modalidad: 'consumible_cobro',
        precio_venta: '11.20',
        concepto_cargo_id: concepto,
    })
    const onu = await productoEn(e.B, e.ctx, {
        nombre: 'ONU',
        unidad: 'unidad',
        tipo: 'equipo',
        seguimiento: 'serie',
    })
    const router = await productoEn(e.B, e.ctx, {
        nombre: 'Router en venta',
        unidad: 'unidad',
        tipo: 'equipo',
        seguimiento: 'serie',
        modalidad: 'consumible_cobro',
        precio_venta: '560.00',
        concepto_cargo_id: concepto,
    })
    await comprarInventario(e.B, e.ctx, {
        producto_id: cable.id,
        bodega_id: central.id,
        cantidad: 100,
        total: '112.00',
    })
    await comprarInventario(e.B, e.ctx, {
        producto_id: conector.id,
        bodega_id: central.id,
        cantidad: 50,
        total: '112.00',
    })
    const onus = await comprarSeries(e.B, e.ctx, { producto_id: onu.id, bodega_id: central.id, n: 2 })
    const routers = await comprarSeries(e.B, e.ctx, { producto_id: router.id, bodega_id: central.id, n: 2 })
    const { servicioId, clienteId } = await servicioEn(e.B)
    return {
        e,
        cabecera,
        concepto,
        central,
        cable,
        conector,
        onu,
        router,
        onus,
        routers,
        servicioId,
        clienteId,
    }
}

test.group('Inventario · consumos según la modalidad (fase D)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('consumible_cobro: cargo único al cliente con la venta del kardex, costo 5.6.01 / 1.1.14 e ingreso con IVA', async ({
        client,
        assert,
    }) => {
        const { e, cabecera, central, conector, servicioId, clienteId } = await preparar()
        const orden = randomUUID()
        const respuesta = await estado(
            client
                .post('/api/v1/inventario/consumos')
                .bearerToken(e.token)
                .headers(cabecera)
                .header('Idempotency-Key', `iris:consumo:${orden}`)
                .json({
                    producto_id: conector.id,
                    bodega_id: central.id,
                    cantidad: '5',
                    servicio_id: servicioId,
                    origen_tipo: 'iris_orden',
                    origen_id: orden,
                }),
            201,
        )
        const mov = respuesta.body()
        assert.equal(mov.tipo, 'venta')
        assert.equal(mov.costo_total, '-10.00', '5 a Q2 (base sin IVA) cada uno')
        assert.equal(mov.origen_externo_id, orden)
        assert.isNumber(mov.factura_id)
        const factura = await db.from('billing.facturas').where('id', mov.factura_id).firstOrFail()
        assert.equal(factura.total, '56.00', '5 × Q11.20 con IVA')
        assert.equal(Number(factura.cliente_id), clienteId)
        assert.equal(Number(factura.servicio_id), servicioId)
        assert.equal(factura.origen_externo_id, orden)
        // costo: su asiento propio (origen inventario = el movimiento)
        const costoVenta = await partidas('inventario', mov.id)
        assert.deepEqual(
            costoVenta.map(([c, d, h]) => [c, d, h]),
            [
                [CUENTAS_GT.COSTO_EQUIPO_VENDIDO, '10.00', '0.00'],
                [CUENTAS_GT.INVENTARIOS, '0.00', '10.00'],
            ],
        )
        // ingreso e IVA: el asiento de la factura (50.00 + 6.00)
        const ingreso = await partidas('factura', mov.factura_id)
        const haber = ingreso.filter(([, , h]) => h !== '0.00').map(([, , h]) => h)
        assert.sameMembers(haber, ['50.00', '6.00'])
        assert.deepEqual(await saldoInventario(conector.id, central.id), ['45.000', '90.00'])
        // la auditoría deja las dos acciones con el mismo request
        const consumo = await db
            .from('audit.acciones')
            .where({ accion: 'inventario.consumir', resultado: 'ok', entidad_id: mov.id })
            .firstOrFail()
        const cargo = await db
            .from('audit.acciones')
            .where({ accion: 'facturas.emitir_cargo_unico', resultado: 'ok', request_id: consumo.request_id })
            .first()
        assert.exists(cargo)
        await afirmarCuadre(assert, e.B)
    })

    test('reglas por modalidad: precio y concepto, servicio, serie y gasto de siempre', async ({
        client,
        assert,
    }) => {
        const { e, cabecera, central, cable, conector, router, routers, servicioId } = await preparar()
        const sinNada = await contarMovimientos(e.B)
        // cobro sin servicio
        const sinServicio = await estado(
            client
                .post('/api/v1/inventario/consumos')
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ producto_id: conector.id, bodega_id: central.id, cantidad: '1' }),
            422,
        )
        assert.equal(sinServicio.body().errors[0].rule, 'servicio_requerido')
        // gasto con precio: no aplica
        const gastoConPrecio = await estado(
            client.post('/api/v1/inventario/consumos').bearerToken(e.token).headers(cabecera).json({
                producto_id: cable.id,
                bodega_id: central.id,
                cantidad: '1',
                precio_unitario: '5.00',
            }),
            422,
        )
        assert.equal(gastoConPrecio.body().errors[0].rule, 'no_aplica')
        // un producto sin precio de venta ni concepto
        const sinPrecio = await productoEn(e.B, e.ctx, { modalidad: 'consumible_cobro' })
        await comprarInventario(e.B, e.ctx, {
            producto_id: sinPrecio.id,
            bodega_id: central.id,
            cantidad: 10,
            total: '11.20',
        })
        const faltan = await estado(
            client.post('/api/v1/inventario/consumos').bearerToken(e.token).headers(cabecera).json({
                producto_id: sinPrecio.id,
                bodega_id: central.id,
                cantidad: '1',
                servicio_id: servicioId,
            }),
            422,
        )
        assert.sameMembers(
            faltan.body().errors.map((x: { rule: string }) => x.rule),
            ['precio_requerido', 'concepto_requerido'],
        )
        assert.deepEqual(await contarMovimientos(e.B), {
            ...sinNada,
            kardex: sinNada.kardex + 1,
            asientos: sinNada.asientos,
        })

        // un equipo de serie en venta por consumo: la unidad queda vendida, a su costo
        const venta = await estado(
            client.post('/api/v1/inventario/consumos').bearerToken(e.token).headers(cabecera).json({
                producto_id: router.id,
                bodega_id: central.id,
                serie: routers[0]!.serie.toLowerCase(),
                servicio_id: servicioId,
            }),
            201,
        )
        assert.equal(venta.body().tipo, 'venta')
        assert.equal(venta.body().unidad_id, routers[0]!.id)
        assert.equal(venta.body().costo_total, '-300.00')
        const unidad = await db.from('inventario.unidades').where('id', routers[0]!.id).firstOrFail()
        assert.equal(unidad.estado, 'vendida')
        const factura = await db.from('billing.facturas').where('id', venta.body().factura_id).firstOrFail()
        assert.equal(factura.total, '560.00')

        // el gasto de siempre sigue igual
        const gasto = await estado(
            client.post('/api/v1/inventario/consumos').bearerToken(e.token).headers(cabecera).json({
                producto_id: cable.id,
                bodega_id: central.id,
                cantidad: '10',
                servicio_id: servicioId,
            }),
            201,
        )
        assert.equal(gasto.body().tipo, 'consumo')
        assert.isNull(gasto.body().factura_id)
        const costoGasto = await partidas('inventario', gasto.body().id)
        assert.deepEqual(
            costoGasto.map(([c, d, h]) => [c, d, h]),
            [
                [CUENTAS_GT.MATERIALES_INSTALACION, '10.00', '0.00'],
                [CUENTAS_GT.INVENTARIOS, '0.00', '10.00'],
            ],
        )
        await afirmarCuadre(assert, e.B)
    })

    test('lote de una orden de Iris desde la bodega del técnico: gasto, cobro y comodato, todo o nada', async ({
        client,
        assert,
    }) => {
        const { e, cabecera, central, cable, conector, onu, onus, servicioId } = await preparar()
        const tecnico = await tecnicoConBodega(e.B, e.ctx)
        // le llega su material por una orden de traslado recibida
        const orden = await estado(
            client
                .post('/api/v1/inventario/traslados/enviar')
                .bearerToken(e.token)
                .headers(cabecera)
                .json({
                    bodega_origen_id: central.id,
                    bodega_destino_id: tecnico.bodega.id,
                    lineas: [
                        { producto_id: cable.id, cantidad: '30' },
                        { producto_id: conector.id, cantidad: '10' },
                        { producto_id: onu.id, unidad_ids: [onus[0]!.id] },
                    ],
                }),
            201,
        )
        await db
            .table('inventario.configuracion')
            .insert({ empresa_id: e.B, traslado_firma_obligatoria: false })
        await estado(
            client
                .post(`/api/v1/inventario/traslados/${orden.body().id}/recibir`)
                .bearerToken(tecnico.token)
                .headers(cabecera)
                .json({}),
            200,
        )
        const ordenIris = randomUUID()
        const cuerpo = (cantidadCable: string) => ({
            servicio_id: servicioId,
            tecnico: { correo: tecnico.usuario.email },
            origen_tipo: 'iris_orden',
            origen_id: ordenIris,
            lineas: [
                { producto_id: cable.id, cantidad: cantidadCable },
                { producto_id: conector.id, cantidad: '2' },
                { serie: onus[0]!.serie },
            ],
        })
        // el técnico (sin alcance global) no indica la bodega por el técnico
        await estado(
            client
                .post('/api/v1/inventario/consumos/lote')
                .bearerToken(tecnico.token)
                .headers(cabecera)
                .json(cuerpo('5')),
            403,
        )
        // todo o nada: el cable no alcanza en la bodega del técnico
        const antes = await contarMovimientos(e.B)
        const falla = await estado(
            client
                .post('/api/v1/inventario/consumos/lote')
                .bearerToken(e.token)
                .headers(cabecera)
                .json(cuerpo('31')),
            409,
        )
        assert.equal(falla.body().type, 'urn:argosisp:problema:existencia_insuficiente')
        assert.deepEqual(await contarMovimientos(e.B), antes)
        // un técnico desconocido
        const desconocido = await estado(
            client
                .post('/api/v1/inventario/consumos/lote')
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ ...cuerpo('5'), tecnico: { correo: `${unico('nadie')}@x.local` } }),
            422,
        )
        assert.equal(desconocido.body().errors[0].rule, 'tecnico_no_encontrado')

        const lote = await estado(
            client
                .post('/api/v1/inventario/consumos/lote')
                .bearerToken(e.token)
                .headers(cabecera)
                .header('Idempotency-Key', `iris:consumo:${ordenIris}`)
                .json(cuerpo('5')),
            201,
        )
        const r = lote.body()
        assert.deepEqual(
            r.movimientos.map((m: { tipo: string; bodega_id: number }) => [m.tipo, m.bodega_id]),
            [
                ['consumo', tecnico.bodega.id],
                ['venta', tecnico.bodega.id],
                ['asignacion_comodato', tecnico.bodega.id],
            ],
        )
        assert.isNumber(r.factura_id)
        assert.lengthOf(r.comodatos, 1)
        assert.equal(r.comodatos[0].estado, 'en_comodato')
        assert.isTrue(
            r.movimientos.every((m: { origen_externo_id: string }) => m.origen_externo_id === ordenIris),
        )
        assert.deepEqual(await saldoInventario(cable.id, tecnico.bodega.id), ['25.000', '25.00'])
        assert.deepEqual(await saldoInventario(conector.id, tecnico.bodega.id), ['8.000', '16.00'])
        // la misma clave: misma respuesta, nada nuevo
        const despues = await contarMovimientos(e.B)
        const repetida = await estado(
            client
                .post('/api/v1/inventario/consumos/lote')
                .bearerToken(e.token)
                .headers(cabecera)
                .header('Idempotency-Key', `iris:consumo:${ordenIris}`)
                .json(cuerpo('5')),
            201,
        )
        assert.equal(repetida.body().factura_id, r.factura_id)
        assert.deepEqual(await contarMovimientos(e.B), despues)
        await afirmarCuadre(assert, e.B)
    })
})
