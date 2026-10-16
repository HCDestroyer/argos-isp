import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { ValidacionFallida } from '#shared/errores'
import { elegirPlantilla, plantillaPorDefecto } from '#core/plantilla_por_defecto'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'
import { crearPlantillaFila } from '#tests/billing/ayudas_billing'

/**
 * Pendientes de seed y ACL (filas de A4): `zonas.ver` para cajero y contabilidad, y plantilla de
 * facturación por defecto en `POST /servicios` (`app/core/plantilla_por_defecto.ts`).
 */

test.group('Servicios · plantilla de facturación por defecto', () => {
    test('elegirPlantilla: ninguna → null, una → esa, varias → 422', ({ assert }) => {
        assert.isNull(elegirPlantilla([]))
        assert.equal(elegirPlantilla([7]), 7)
        assert.throws(() => elegirPlantilla([7, 8]), ValidacionFallida)
        try {
            elegirPlantilla([7, 8])
        } catch (error) {
            assert.equal((error as ValidacionFallida).errores![0]!.field, 'plantilla_facturacion_id')
        }
    })

    test('POST /servicios: sin el campo y con varias plantillas → 422; null explícito → sin plantilla; id → esa', async ({
        client,
        assert,
    }) => {
        // el técnico crea servicios y no ve plantillas
        await desmarcarTodas()
        const { token } = await usuarioConRoles(['tecnico'])
        const { routerId } = await crearEscenarioRouter()
        const planId = await crearPlanFila()
        await crearPlantillaFila()
        const plantillaId = await crearPlantillaFila()
        const cuerpo = async () => ({
            cliente_id: await crearClienteFila(),
            router_id: routerId,
            plan_id: planId,
        })

        const varias = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json(await cuerpo()),
            422,
        )
        assert.equal(varias.body().errors[0].field, 'plantilla_facturacion_id')
        assert.include(varias.body().detail, 'varias plantillas')

        const sin = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({ ...(await cuerpo()), plantilla_facturacion_id: null }),
            201,
        )
        assert.isNull(sin.body().plantilla_facturacion_id)

        const con = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({ ...(await cuerpo()), plantilla_facturacion_id: plantillaId }),
            201,
        )
        assert.equal(con.body().plantilla_facturacion_id, plantillaId)
    })

    test('POST /servicios sin el campo usa la plantilla marcada por_defecto aunque haya varias', async ({
        client,
        assert,
    }) => {
        await desmarcarTodas()
        const { token } = await usuarioConRoles(['tecnico'])
        const admin = await usuarioConRoles(['admin'])
        const { routerId } = await crearEscenarioRouter()
        const planId = await crearPlanFila()
        await crearPlantillaFila()
        const otra = await crearPlantillaFila()
        const marcada = await estado(
            client
                .post('/api/v1/plantillas-facturacion')
                .bearerToken(admin.token)
                .json({ nombre: unico('Por defecto'), ciclo: 'dia_fijo', dia: 1, por_defecto: true }),
            201,
        )
        const marcadaId = marcada.body().id as number
        assert.equal(await db.transaction((trx) => plantillaPorDefecto(trx)), marcadaId)

        const creado = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({ cliente_id: await crearClienteFila(), router_id: routerId, plan_id: planId }),
            201,
        )
        assert.equal(creado.body().plantilla_facturacion_id, marcadaId)

        // un id explícito y el null explícito siguen ganando a la marca
        const explicito = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({
                    cliente_id: await crearClienteFila(),
                    router_id: routerId,
                    plan_id: planId,
                    plantilla_facturacion_id: otra,
                }),
            201,
        )
        assert.equal(explicito.body().plantilla_facturacion_id, otra)

        // sin marca vuelve la regla anterior: varias → 422
        await desmarcarTodas()
        await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({ cliente_id: await crearClienteFila(), router_id: routerId, plan_id: planId }),
            422,
        )
    })
})

/** Las pruebas comparten la base: otra prueba puede haber dejado una plantilla marcada. */
async function desmarcarTodas() {
    await db.from('billing.plantillas_facturacion').where('por_defecto', true).update({ por_defecto: false })
}

test.group('ACL · zonas.ver en cajero y contabilidad', () => {
    test('cajero y contabilidad listan zonas', async ({ client }) => {
        for (const rol of ['cajero', 'contabilidad']) {
            const { token } = await usuarioConRoles([rol])
            await estado(client.get('/api/v1/zonas').bearerToken(token), 200)
        }
    })
})
