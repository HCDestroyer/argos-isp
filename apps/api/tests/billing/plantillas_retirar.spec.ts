import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, usuarioConRoles } from '#tests/ayudas'
import { crearPlantillaFila, escenario, facturasDe, generar } from '#tests/billing/ayudas_billing'
import { crearClienteFila, crearServicioFila } from '#tests/core/fabricas'

/**
 * `plantillas.retirar` (pedido de A4): la plantilla retirada sigue facturando a sus servicios y no
 * se asigna a servicios nuevos ni se cambia un servicio a ella.
 */
test.group('billing · retirar plantilla de facturación', () => {
    test('retirada: sus servicios siguen facturando; no se asigna a servicios nuevos', async ({
        client,
        assert,
    }) => {
        const datos = await escenario({ fecha_instalacion: '2026-09-01' })
        await generar(datos.servicioId, '2026-09-01')
        const { token } = await usuarioConRoles(['contabilidad'])
        const { token: cajero } = await usuarioConRoles(['cajero'])
        const leida = await estado(
            client.get(`/api/v1/plantillas-facturacion/${datos.plantillaId}`).bearerToken(token),
            200,
        )
        assert.isNull(leida.body().retirada_en)
        await estado(
            client
                .post(`/api/v1/plantillas-facturacion/${datos.plantillaId}/retirar`)
                .bearerToken(cajero)
                .json({ version: leida.body().version, motivo: 'ya no se vende' }),
            403,
        )
        await estado(
            client
                .post(`/api/v1/plantillas-facturacion/${datos.plantillaId}/retirar`)
                .bearerToken(token)
                .json({ version: leida.body().version + 5, motivo: 'versión vieja' }),
            409,
        )
        const retirada = await estado(
            client
                .post(`/api/v1/plantillas-facturacion/${datos.plantillaId}/retirar`)
                .bearerToken(token)
                .json({ version: leida.body().version, motivo: 'ya no se vende' }),
            200,
        )
        assert.isString(retirada.body().retirada_en)
        assert.equal(retirada.body().motivo_retiro, 'ya no se vende')
        const otra = await estado(
            client
                .post(`/api/v1/plantillas-facturacion/${datos.plantillaId}/retirar`)
                .bearerToken(token)
                .json({ version: retirada.body().version, motivo: 'otra vez' }),
            409,
        )
        assert.equal(otra.body().type, 'urn:argosisp:problema:plantilla_retirada')

        // el servicio que ya la tiene sigue facturando
        await generar(datos.servicioId, '2026-10-01')
        assert.lengthOf(await facturasDe(datos.servicioId), 2)
        // y se edita lo demás del servicio
        await db.from('core.servicios').where('id', datos.servicioId).update({ updated_at: new Date() })

        // un servicio nuevo con ella, o cambiar otro servicio a ella: 422 (trigger)
        const clienteId = await crearClienteFila()
        await assert.rejects(
            () => crearServicioFila({ cliente_id: clienteId, plantilla_facturacion_id: datos.plantillaId }),
            /retirada/,
        )
        const vigente = await crearPlantillaFila()
        const otroServicio = await crearServicioFila({
            cliente_id: clienteId,
            plantilla_facturacion_id: vigente,
        })
        await assert.rejects(
            () =>
                db
                    .from('core.servicios')
                    .where('id', otroServicio)
                    .update({ plantilla_facturacion_id: datos.plantillaId }),
            /retirada/,
        )

        const cambio = await db
            .from('audit.cambios')
            .where({
                entidad_tipo: 'plantilla_facturacion',
                entidad_id: datos.plantillaId,
                campo: 'motivo_retiro',
            })
            .first()
        assert.exists(cambio)
    })

    test('la plantilla por defecto no se retira (409)', async ({ client, assert }) => {
        const marcada = (await db
            .from('billing.plantillas_facturacion')
            .where('por_defecto', true)
            .select('id', 'version')
            .first()) as { id: number; version: number } | null
        const id = marcada ? Number(marcada.id) : await crearPlantillaFila({ por_defecto: true })
        const version = marcada ? Number(marcada.version) : 1
        const { token } = await usuarioConRoles(['admin'])
        const r = await estado(
            client
                .post(`/api/v1/plantillas-facturacion/${id}/retirar`)
                .bearerToken(token)
                .json({ version, motivo: 'probar' }),
            409,
        )
        assert.equal(r.body().type, 'urn:argosisp:problema:plantilla_por_defecto')
    })
})
