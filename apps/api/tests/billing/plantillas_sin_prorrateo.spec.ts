import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import PlantillasSinProrrateo from '#database/migrations/1795228317052_plantillas_sin_prorrateo'
import { crearPlantillaFila, escenario, facturasDe, generar } from '#tests/billing/ayudas_billing'

/**
 * Decisión del PM (21 nov): «al emitir automáticamente debe tomar el total según el servicio y no
 * hacer cálculos según el día». La migración apaga el prorrateo de todas las plantillas, con su
 * auditoría por fila, y el cron cobra el primer periodo completo.
 */
test.group('Plantillas sin prorrateo', () => {
    test('la migración apaga el prorrateo de cada plantilla, sube su versión y deja auditoría por fila', async ({
        assert,
    }) => {
        const con = [
            await crearPlantillaFila({ prorrateo: true }),
            await crearPlantillaFila({ prorrateo: true }),
        ]
        const sin = await crearPlantillaFila({ prorrateo: false })
        const antes = await db
            .from('billing.plantillas_facturacion')
            .whereIn('id', [...con, sin])
            .orderBy('id')
            .select('id', 'version')

        await db.transaction(async (trx) => {
            await new PlantillasSinProrrateo(trx, 'plantillas_sin_prorrateo', false).execUp()
        })

        const despues = await db
            .from('billing.plantillas_facturacion')
            .whereIn('id', [...con, sin])
            .orderBy('id')
            .select('id', 'prorrateo', 'version')
        assert.deepEqual(
            despues.map((p) => [p.id, p.prorrateo, p.version]),
            antes.map((p) => [p.id, false, con.includes(p.id) ? p.version + 1 : p.version]),
        )
        const [{ quedan }] = await db
            .from('billing.plantillas_facturacion')
            .where('prorrateo', true)
            .count('* as quedan')
        assert.equal(Number(quedan), 0)

        const acciones = await db
            .from('audit.acciones')
            .where('accion', 'plantillas.editar')
            .where('entidad_tipo', 'plantilla_facturacion')
            .whereIn('entidad_id', [...con, sin])
            .select('entidad_id', 'actor_tipo', 'canal', 'resultado', 'entrada', 'request_id')
        assert.sameMembers(
            acciones.map((a) => Number(a.entidad_id)),
            con,
        )
        for (const a of acciones) {
            assert.include(a, { actor_tipo: 'sistema', canal: 'interno', resultado: 'ok' })
            assert.include(a.entrada, {
                prorrateo: false,
                origen: 'migracion',
                motivo: 'Decisión del PM: la factura cobra el precio completo del servicio, sin prorrateo',
            })
        }
        const cambios = await db
            .from('audit.cambios')
            .where('entidad_tipo', 'plantilla_facturacion')
            .whereIn('entidad_id', [...con, sin])
            .select('entidad_id', 'campo', 'antes', 'despues', 'actor_tipo', 'request_id')
        assert.sameDeepMembers(
            cambios.map((c) => [Number(c.entidad_id), c.campo, c.antes, c.despues, c.actor_tipo]),
            con.map((id) => [id, 'prorrateo', true, false, 'sistema']),
        )
        assert.equal(cambios[0]!.request_id, acciones[0]!.request_id)
    })

    test('sin prorrateo, el cron cobra el primer periodo completo de una instalación a mitad de ciclo', async ({
        assert,
    }) => {
        const e = await escenario({ fecha_instalacion: '2026-09-16', plantilla: { prorrateo: false } })
        await generar(e.servicioId, '2026-10-01')
        const facturas = await facturasDe(e.servicioId)
        assert.deepEqual(
            facturas.map((f) => [f.periodo, f.total]),
            [
                ['2026-09-16', '150.00'],
                ['2026-10-01', '150.00'],
            ],
        )
        const [linea] = await db
            .from('billing.facturas_lineas')
            .where('factura_id', facturas[0]!.id)
            .where('tipo', 'servicio')
            .select('concepto')
        assert.notInclude(linea!.concepto, 'prorrateo')
    })
})
