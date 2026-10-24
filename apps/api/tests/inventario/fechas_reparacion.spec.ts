import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { errorDe, servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { afirmarCuadre, bodegaEn, productoEn, saldoInventario } from '#tests/inventario/ayudas_inventario'
import { hoyGuatemala } from '#ledger/fechas'
import CargarSaldoInicial from '#inventario/actions/cargar_saldo_inicial'
import ConsumirInventario from '#inventario/actions/consumir_inventario'
import AjustarInventario from '#inventario/actions/ajustar_inventario'
import AsignarComodato from '#inventario/actions/asignar_comodato'
import DevolverComodato from '#inventario/actions/devolver_comodato'
import MarcarReparada from '#inventario/actions/marcar_reparada'
import DarDeBajaInventario from '#inventario/actions/dar_de_baja_inventario'
import CerrarPeriodo from '#ledger/actions/cerrar_periodo'

/**
 * Inventario interno, fase C (decisiones del líder): consumos y ajustes con fecha pasada (al costo
 * del momento, solo en periodo abierto, sin existencia negativa en ninguna fecha posterior) y
 * `inventario.marcar_reparada`.
 */

const diasAtras = (n: number) =>
    DateTime.fromISO(hoyGuatemala(), { zone: 'utc' }).minus({ days: n }).toISODate()!

test.group('Inventario · fase C · fechas pasadas y reparación', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('consumo y ajuste con fecha pasada (H55): solo sin movimientos posteriores que cambien el promedio, al promedio de esa fecha, solo en periodo abierto', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const bodega = await bodegaEn(e.B, e.ctx)
        const cable = await productoEn(e.B, e.ctx)
        const consumir = (cantidad: string, fecha?: string) =>
            new ConsumirInventario().execute(
                { producto_id: cable.id, bodega_id: bodega.id, cantidad, ...(fecha ? { fecha } : {}) },
                e.ctx,
            )
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
        // antes del saldo inicial: la entrada posterior cambió el promedio
        const antes = await errorDe(consumir('1', diasAtras(12)))
        assert.equal(antes.status, 409)
        assert.equal(antes.codigo, 'fecha_con_movimientos_posteriores')
        const futuro = await errorDe(
            consumir('1', DateTime.fromISO(hoyGuatemala()).plus({ days: 1 }).toISODate()!),
        )
        assert.include(futuro.reglas, 'futuro')

        // solo salidas al promedio después: se acepta, al promedio de esa fecha (= el de hoy)
        const primero = await consumir('8', diasAtras(4))
        assert.equal(primero.costo_total, '-16.00')
        const pasado = await consumir('1', diasAtras(5))
        assert.equal(pasado.fecha, diasAtras(5))
        assert.equal(pasado.costo_total, '-2.00')
        const asiento = await db.from('ledger.asientos').where('id', pasado.asiento_id!).first()
        assert.equal(DateTime.fromJSDate(asiento.fecha).toISODate(), diasAtras(5))
        // más de lo que hay: el 409 de siempre
        const demasiado = await errorDe(consumir('2', diasAtras(5)))
        assert.equal(demasiado.codigo, 'existencia_insuficiente')

        // una entrada hoy cambia el promedio: ya no se acepta una fecha anterior
        await new AjustarInventario().execute(
            {
                producto_id: cable.id,
                bodega_id: bodega.id,
                cantidad: '6',
                motivo: 'llegaron de otra obra',
            },
            e.ctx,
        )
        for (const intento of [
            () => consumir('1', diasAtras(3)),
            () =>
                new AjustarInventario().execute(
                    {
                        producto_id: cable.id,
                        bodega_id: bodega.id,
                        cantidad: '-1',
                        motivo: 'faltante de la semana',
                        fecha: diasAtras(3),
                    },
                    e.ctx,
                ),
            () =>
                new AjustarInventario().execute(
                    {
                        producto_id: cable.id,
                        bodega_id: bodega.id,
                        cantidad: '1',
                        motivo: 'sobrante de la semana',
                        fecha: diasAtras(3),
                    },
                    e.ctx,
                ),
        ]) {
            const error = await errorDe(intento())
            assert.equal(error.codigo, 'fecha_con_movimientos_posteriores')
            assert.include(error.detalle, 'fecha de hoy')
        }
        const hoy = await new AjustarInventario().execute(
            { producto_id: cable.id, bodega_id: bodega.id, cantidad: '-1', motivo: 'faltante de hoy' },
            e.ctx,
        )
        assert.equal(hoy.costo_total, '-2.00')
        assert.deepEqual(await saldoInventario(cable.id, bodega.id), ['6.000', '12.00'])
        await afirmarCuadre(assert, e.B)

        // un mes cerrado no recibe movimientos
        const mesPasado = DateTime.fromISO(hoyGuatemala(), { zone: 'utc' }).minus({ months: 1 })
        await new CerrarPeriodo().execute(
            { empresa_id: e.B, anio: mesPasado.year, mes: mesPasado.month },
            e.ctx,
        )
        const cerrado = await errorDe(
            new AjustarInventario().execute(
                {
                    producto_id: cable.id,
                    bodega_id: bodega.id,
                    cantidad: '1',
                    motivo: 'sobrante del mes pasado',
                    fecha: mesPasado.endOf('month').toISODate()!,
                },
                e.ctx,
            ),
        )
        assert.equal(cerrado.codigo, 'periodo_cerrado')
    })

    test('marcar_reparada: de en_reparacion a disponible en su bodega, sin movimiento ni asiento; desde reparación también se da de baja', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const bodega = await bodegaEn(e.B, e.ctx)
        const onu = await productoEn(e.B, e.ctx, { nombre: 'ONU', tipo: 'equipo', seguimiento: 'serie' })
        const { servicioId } = await servicioEn(e.B)
        const unidades: number[] = []
        for (const costo of ['300.00', '280.00']) {
            const cargada = await new CargarSaldoInicial().execute(
                {
                    producto_id: onu.id,
                    bodega_id: bodega.id,
                    unidad: { serie: unico('ONU') },
                    costo_total: costo,
                },
                e.ctx,
            )
            unidades.push(cargada.unidad_id!)
        }
        for (const unidadId of unidades) {
            await new AsignarComodato().execute({ servicio_id: servicioId, unidad_id: unidadId }, e.ctx)
            await new DevolverComodato().execute(
                { servicio_id: servicioId, unidad_id: unidadId, bodega_id: bodega.id, en_reparacion: true },
                e.ctx,
            )
        }
        const [reparada, rota] = unidades as [number, number]
        const movimientos = async () => {
            const fila = await db
                .from('inventario.movimientos')
                .where('empresa_id', e.B)
                .count('* as n')
                .first()
            return Number(fila.n)
        }
        const antes = await movimientos()
        const valor = await saldoInventario(onu.id, bodega.id)

        const sinMotivo = await errorDe(
            new MarcarReparada().execute({ unidad_id: reparada, motivo: '' }, e.ctx),
        )
        assert.equal(sinMotivo.status, 422)
        const lista = await new MarcarReparada().execute(
            { unidad_id: reparada, motivo: 'cambio de fuente' },
            e.ctx,
        )
        assert.equal(lista.estado, 'disponible')
        assert.equal(lista.bodega_id, bodega.id)
        assert.equal(await movimientos(), antes)
        assert.deepEqual(await saldoInventario(onu.id, bodega.id), valor)
        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'unidad_inventario', entidad_id: reparada })
            .orderBy('id', 'desc')
            .first()
        assert.isNotNull(cambio)
        const otraVez = await errorDe(
            new MarcarReparada().execute({ unidad_id: reparada, motivo: 'otra vez' }, e.ctx),
        )
        assert.equal(otraVez.codigo, 'unidad_no_disponible')

        await new DarDeBajaInventario().execute(
            {
                producto_id: onu.id,
                bodega_id: bodega.id,
                unidad_id: rota,
                causa: 'danado',
                motivo: 'sin reparación',
            },
            e.ctx,
        )
        const baja = await db.from('inventario.unidades').where('id', rota).first()
        assert.equal(baja.estado, 'dada_de_baja')
        await afirmarCuadre(assert, e.B)
    })
})
