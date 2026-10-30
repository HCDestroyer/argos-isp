import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import { unicoBd } from '#tests/billing/ayudas_billing'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import {
    afirmarCuadre,
    bodegaEn,
    comprarInventario,
    contarMovimientos,
    productoEn,
} from '#tests/inventario/ayudas_inventario'
import CargarSaldoInicial from '#inventario/actions/cargar_saldo_inicial'

/**
 * Pedido A3 de Iris (`contratos/iris.md` §5.1): `origen_tipo = iris_orden` + `origen_id` en el
 * consumo y en el comodato (asignar, devolver, pérdida). Se guarda en el movimiento
 * (`origen_externo_*`), sale en el kardex y en los eventos, y no cambia el libro.
 */

/** orden de Iris de esta corrida (las claves de idempotencia sobreviven entre corridas) */
const ORDEN = randomUUID()

async function ultimoEvento(nombre: string, campo: string, valor: number) {
    return db
        .from('audit.outbox')
        .where('evento', nombre)
        .whereRaw(`payload->>? = ?`, [campo, String(valor)])
        .orderBy('id', 'desc')
        .first()
}

async function entradaAuditada(accion: string, entidadId: number) {
    const fila = await db
        .from('audit.acciones')
        .where({ accion, resultado: 'ok' })
        .where('entidad_id', entidadId)
        .orderBy('id', 'desc')
        .first()
    return fila?.entrada as Record<string, unknown> | undefined
}

test.group('Inventario · origen Iris (pedido A3)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('consumo con la orden de Iris: en el movimiento, el kardex filtrado, el evento y la auditoría; sin origen, null', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const cabecera = { 'X-Empresa-Id': String(e.B) }
        const cable = await productoEn(e.B, e.ctx)
        const bodega = await bodegaEn(e.B, e.ctx)
        await comprarInventario(e.B, e.ctx, {
            producto_id: cable.id,
            bodega_id: bodega.id,
            cantidad: 100,
            total: '112.00',
        })
        const { servicioId } = await servicioEn(e.B)
        const antes = await contarMovimientos(e.B)

        const consumo = await estado(
            client
                .post('/api/v1/inventario/consumos')
                .bearerToken(e.token)
                .headers(cabecera)
                .header('Idempotency-Key', `iris:consumo:${ORDEN}`)
                .json({
                    producto_id: cable.id,
                    bodega_id: bodega.id,
                    cantidad: '10',
                    servicio_id: servicioId,
                    origen_tipo: 'iris_orden',
                    origen_id: ORDEN,
                }),
            201,
        )
        const movimiento = consumo.body()
        assert.equal(movimiento.tipo, 'consumo')
        assert.equal(movimiento.origen_externo_tipo, 'iris_orden')
        assert.equal(movimiento.origen_externo_id, ORDEN)
        // el origen interno del kardex no se toca
        assert.isNull(movimiento.origen_tipo)
        assert.isNull(movimiento.origen_id)
        // mismo asiento de siempre: un movimiento y un asiento más
        assert.deepEqual(await contarMovimientos(e.B), {
            kardex: antes.kardex + 1,
            asientos: antes.asientos + 1,
        })

        // repetido con la misma clave: el mismo movimiento
        const repetido = await estado(
            client
                .post('/api/v1/inventario/consumos')
                .bearerToken(e.token)
                .headers(cabecera)
                .header('Idempotency-Key', `iris:consumo:${ORDEN}`)
                .json({
                    producto_id: cable.id,
                    bodega_id: bodega.id,
                    cantidad: '10',
                    servicio_id: servicioId,
                    origen_tipo: 'iris_orden',
                    origen_id: ORDEN,
                }),
            201,
        )
        assert.equal(repetido.body().id, movimiento.id)

        // otro consumo sin origen
        const suelto = await estado(
            client
                .post('/api/v1/inventario/consumos')
                .bearerToken(e.token)
                .headers(cabecera)
                .header('Idempotency-Key', unico('consumo'))
                .json({ producto_id: cable.id, bodega_id: bodega.id, cantidad: '5' }),
            201,
        )
        assert.isNull(suelto.body().origen_externo_tipo)
        assert.isNull(suelto.body().origen_externo_id)

        const kardex = await estado(
            client
                .get('/api/v1/inventario/movimientos')
                .bearerToken(e.token)
                .headers(cabecera)
                .qs({ producto_id: cable.id }),
            200,
        )
        assert.deepEqual(
            kardex
                .body()
                .data.map((m: { tipo: string; origen_externo_id: string | null }) => [
                    m.tipo,
                    m.origen_externo_id,
                ]),
            [
                ['entrada_compra', null],
                ['consumo', ORDEN],
                ['consumo', null],
            ],
        )
        const deLaOrden = await estado(
            client
                .get('/api/v1/inventario/movimientos')
                .bearerToken(e.token)
                .headers(cabecera)
                .qs({ origen_externo_id: ORDEN }),
            200,
        )
        assert.deepEqual(
            deLaOrden
                .body()
                .data.map((m: { id: number; saldo_cantidad: string }) => [m.id, m.saldo_cantidad]),
            // el saldo corrido sigue siendo el de toda la historia del producto
            [[movimiento.id, '90.000']],
        )

        const evento = await ultimoEvento('inventario.movimiento_registrado', 'movimiento_id', movimiento.id)
        assert.include(evento.payload, {
            tipo: 'consumo',
            origen_tipo: null,
            origen_id: null,
            origen_externo_tipo: 'iris_orden',
            origen_externo_id: ORDEN,
        })
        const sinOrigen = await ultimoEvento(
            'inventario.movimiento_registrado',
            'movimiento_id',
            suelto.body().id,
        )
        assert.include(sinOrigen.payload, { origen_externo_tipo: null, origen_externo_id: null })
        assert.include(await entradaAuditada('inventario.consumir', movimiento.id), {
            origen_tipo: 'iris_orden',
            origen_id: ORDEN,
        })
        await afirmarCuadre(assert, e.B)
    })

    test('validación: origen_tipo solo iris_orden y en pareja con origen_id (422, sin escribir nada)', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const cabecera = { 'X-Empresa-Id': String(e.B) }
        const cable = await productoEn(e.B, e.ctx)
        const bodega = await bodegaEn(e.B, e.ctx)
        await comprarInventario(e.B, e.ctx, {
            producto_id: cable.id,
            bodega_id: bodega.id,
            cantidad: 10,
            total: '11.20',
        })
        const antes = await contarMovimientos(e.B)
        const base = { producto_id: cable.id, bodega_id: bodega.id, cantidad: '1' }
        const casos: Array<[Record<string, unknown>, string]> = [
            [{ origen_tipo: 'iris_orden' }, 'origen_id'],
            [{ origen_tipo: 'iris_orden', origen_id: '   ' }, 'origen_id'],
            [{ origen_id: ORDEN }, 'origen_tipo'],
            [{ origen_tipo: 'compra', origen_id: '5' }, 'origen_tipo'],
            [{ origen_tipo: 'iris_orden', origen_id: 'con espacios' }, 'origen_id'],
        ]
        for (const [extra, campo] of casos) {
            const r = await estado(
                client
                    .post('/api/v1/inventario/consumos')
                    .bearerToken(e.token)
                    .headers(cabecera)
                    .header('Idempotency-Key', unico('consumo'))
                    .json({ ...base, ...extra }),
                422,
            )
            assert.include(
                r.body().errors.map((x: { field: string }) => x.field),
                campo,
                JSON.stringify(extra),
            )
        }
        assert.deepEqual(await contarMovimientos(e.B), antes)
    })

    test('comodato con la orden de Iris: asignar y devolver llevan el origen al movimiento y a sus eventos; la pérdida, a la auditoría', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const cabecera = { 'X-Empresa-Id': String(e.B) }
        const onu = await productoEn(e.B, e.ctx, { nombre: 'ONU GPON', tipo: 'equipo', seguimiento: 'serie' })
        const bodega = await bodegaEn(e.B, e.ctx)
        await new CargarSaldoInicial().execute(
            {
                producto_id: onu.id,
                bodega_id: bodega.id,
                unidad: { serie: await unicoBd('ZTEG') },
                costo_total: '300.00',
            },
            e.ctx,
        )
        const unidad = (await db
            .from('inventario.unidades')
            .where('producto_id', onu.id)
            .select('id', 'serie')
            .firstOrFail()) as { id: number; serie: string }
        const unidadId = Number(unidad.id)
        const { servicioId } = await servicioEn(e.B)
        const instalacion = randomUUID()
        const retiro = randomUUID()
        const reinstalacion = randomUUID()

        await estado(
            client
                .post(`/api/v1/servicios/${servicioId}/equipos`)
                .bearerToken(e.token)
                .headers(cabecera)
                .header('Idempotency-Key', `iris:comodato:${instalacion}:${unidad.serie}`)
                .json({ unidad_id: unidadId, origen_tipo: 'iris_orden', origen_id: instalacion }),
            201,
        )
        const asignado = await ultimoEvento('inventario.comodato_asignado', 'unidad_id', unidadId)
        assert.include(asignado.payload, {
            servicio_id: servicioId,
            origen_externo_tipo: 'iris_orden',
            origen_externo_id: instalacion,
        })

        // sin origen_id: 422 y la unidad sigue en comodato
        const incompleta = await estado(
            client
                .post(`/api/v1/servicios/${servicioId}/equipos/${unidadId}/devolver`)
                .bearerToken(e.token)
                .headers(cabecera)
                .header('Idempotency-Key', unico('d'))
                .json({ bodega_id: bodega.id, origen_tipo: 'iris_orden' }),
            422,
        )
        assert.equal(incompleta.body().errors[0].field, 'origen_id')

        await estado(
            client
                .post(`/api/v1/servicios/${servicioId}/equipos/${unidadId}/devolver`)
                .bearerToken(e.token)
                .headers(cabecera)
                .header('Idempotency-Key', `iris:devolucion:${retiro}:${unidadId}`)
                .json({
                    bodega_id: bodega.id,
                    condicion: 'usado',
                    origen_tipo: 'iris_orden',
                    origen_id: retiro,
                }),
            200,
        )
        const devuelto = await ultimoEvento('inventario.comodato_devuelto', 'unidad_id', unidadId)
        assert.include(devuelto.payload, {
            bodega_id: bodega.id,
            condicion: 'usado',
            origen_externo_tipo: 'iris_orden',
            origen_externo_id: retiro,
        })

        // se presta otra vez sin origen y se declara perdida desde otra orden
        await estado(
            client
                .post(`/api/v1/servicios/${servicioId}/equipos`)
                .bearerToken(e.token)
                .headers(cabecera)
                .header('Idempotency-Key', unico('c'))
                .json({ unidad_id: unidadId }),
            201,
        )
        const sinOrigen = await ultimoEvento('inventario.comodato_asignado', 'unidad_id', unidadId)
        assert.include(sinOrigen.payload, { origen_externo_tipo: null, origen_externo_id: null })
        await estado(
            client
                .post(`/api/v1/servicios/${servicioId}/equipos/${unidadId}/perdida`)
                .bearerToken(e.token)
                .headers(cabecera)
                .header('Idempotency-Key', unico('p'))
                .json({ motivo: 'el cliente no lo entregó', origen_id: reinstalacion }),
            422,
        )
        await estado(
            client
                .post(`/api/v1/servicios/${servicioId}/equipos/${unidadId}/perdida`)
                .bearerToken(e.token)
                .headers(cabecera)
                .header('Idempotency-Key', `iris:perdida:${reinstalacion}:${unidadId}`)
                .json({
                    motivo: 'el cliente no lo entregó',
                    origen_tipo: 'iris_orden',
                    origen_id: reinstalacion,
                }),
            200,
        )
        assert.include(await entradaAuditada('inventario.declarar_perdida_comodato', unidadId), {
            origen_tipo: 'iris_orden',
            origen_id: reinstalacion,
        })
        // el asiento de la pérdida no menciona la orden: la trazabilidad no toca el libro
        const baja = await db
            .from('ledger.activos_bajas')
            .where('tipo', 'retiro')
            .whereLike('motivo', `%servicio ${servicioId}%`)
            .first()
        assert.notInclude(baja.motivo, reinstalacion)

        // historial de la unidad y kardex con la orden de cada movimiento
        const historial = await estado(
            client.get(`/api/v1/inventario/unidades/${unidadId}`).bearerToken(e.token).headers(cabecera),
            200,
        )
        assert.deepEqual(
            historial
                .body()
                .historial.map(
                    (m: {
                        tipo: string
                        origen_externo_tipo: string | null
                        origen_externo_id: string | null
                    }) => [m.tipo, m.origen_externo_tipo, m.origen_externo_id],
                ),
            [
                ['saldo_inicial', null, null],
                ['asignacion_comodato', 'iris_orden', instalacion],
                ['devolucion_comodato', 'iris_orden', retiro],
                ['asignacion_comodato', null, null],
            ],
        )
        const kardex = await estado(
            client
                .get('/api/v1/inventario/movimientos')
                .bearerToken(e.token)
                .headers(cabecera)
                .qs({ origen_externo_id: retiro }),
            200,
        )
        assert.deepEqual(
            kardex
                .body()
                .data.map((m: { tipo: string; origen_externo_tipo: string }) => [
                    m.tipo,
                    m.origen_externo_tipo,
                ]),
            [['devolucion_comodato', 'iris_orden']],
        )
        await afirmarCuadre(assert, e.B)
    })
})
