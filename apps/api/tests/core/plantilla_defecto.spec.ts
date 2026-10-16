import { test } from '@japa/runner'
import { ValidacionFallida } from '#shared/errores'
import { elegirPlantilla } from '#core/plantilla_por_defecto'
import { estado, usuarioConRoles } from '#tests/ayudas'
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
})

test.group('ACL · zonas.ver en cajero y contabilidad', () => {
    test('cajero y contabilidad listan zonas', async ({ client }) => {
        for (const rol of ['cajero', 'contabilidad']) {
            const { token } = await usuarioConRoles([rol])
            await estado(client.get('/api/v1/zonas').bearerToken(token), 200)
        }
    })
})
