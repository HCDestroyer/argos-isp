import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { crearClienteFila, crearPlanFila, crearServicioFila } from '#tests/core/fabricas'
import { leerPrecioEfectivo, leerServicio, precioEfectivo, precioEfectivoSql } from '#billing/configuracion'

/**
 * Precio efectivo mensual (contrato Iris 0.8.0, `precio_mensual` de A1): una sola definición en
 * SQL (`precioEfectivoSql`) y en TS (`precioEfectivo`), la misma con la que se factura.
 */
test.group('billing · precio efectivo del servicio', () => {
    async function preciosSql(servicioId: number) {
        const conJoin = await db
            .from('core.servicios as s')
            .join('network.planes as p', 'p.id', 's.plan_id')
            .where('s.id', servicioId)
            .select(db.raw(`${precioEfectivoSql('s', 'p')} as precio_mensual`))
            .firstOrFail()
        const sinJoin = await db
            .from('core.servicios as srv')
            .where('srv.id', servicioId)
            .select(db.raw(`${precioEfectivoSql('srv')} as precio_mensual`))
            .firstOrFail()
        return [conJoin.precio_mensual, sinJoin.precio_mensual] as const
    }

    async function precioDeLeerServicio(servicioId: number) {
        const servicio = await leerServicio(db.connection(), servicioId)
        return servicio.precio
    }

    test('plan, costo_override y plan temporal: SQL, TS y leerServicio coinciden (IVA incluido, 2 decimales)', async ({
        assert,
    }) => {
        const plan = await crearPlanFila({ precio: '250' })
        const temporal = await crearPlanFila({ precio: '99.5' })
        const servicioId = await crearServicioFila({ cliente_id: await crearClienteFila(), plan_id: plan })

        assert.deepEqual(await preciosSql(servicioId), ['250.00', '250.00'])
        assert.equal(await leerPrecioEfectivo(db.connection(), servicioId), '250.00')
        assert.equal(await precioDeLeerServicio(servicioId), '250.00')

        // el plan temporal es el plan_id vigente
        await db.from('core.servicios').where('id', servicioId).update({ plan_id: temporal })
        assert.deepEqual(await preciosSql(servicioId), ['99.50', '99.50'])
        assert.equal(await precioDeLeerServicio(servicioId), '99.50')

        // costo_override manda sobre el plan
        await db.from('core.servicios').where('id', servicioId).update({ costo_override: '180.25' })
        assert.deepEqual(await preciosSql(servicioId), ['180.25', '180.25'])
        assert.equal(await leerPrecioEfectivo(db.connection(), servicioId), '180.25')
        assert.equal(await precioDeLeerServicio(servicioId), '180.25')

        // override 0 (cortesía) también manda
        await db.from('core.servicios').where('id', servicioId).update({ costo_override: '0' })
        assert.deepEqual(await preciosSql(servicioId), ['0.00', '0.00'])

        assert.equal(precioEfectivo({ costo_override: null, precio: '250' }), '250.00')
        assert.equal(precioEfectivo({ costo_override: '0.00', precio: '250.00' }), '0.00')
        await assert.rejects(() => leerPrecioEfectivo(db.connection(), 999_999_999))
    })
})
