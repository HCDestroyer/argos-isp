import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { normalizarReglasPromesa } from '#billing/reglas_promesa'
import { estadoServicio, servicioCortado } from '#tests/billing/ayudas_billing'

/**
 * `POST /promesas/:id/rechazar` y `/cancelar` (supervisor de cobro: admin y contabilidad).
 */

const crear = (client: any, token: string, servicioId: number) =>
    estado(
        client
            .post('/api/v1/promesas')
            .bearerToken(token)
            .header('Idempotency-Key', unico('promesa'))
            .json({
                servicio_id: servicioId,
                vence_en: new Date(Date.now() + 2 * 86_400_000).toISOString(),
                monto: '300.00',
            }),
        201,
    )

test.group('billing · promesas: rechazar y cancelar', () => {
    test('rechazar una pendiente: motivo y quién en el cierre; solo pendientes; permisos', async ({
        client,
        assert,
    }) => {
        const reglas = JSON.stringify(
            normalizarReglasPromesa({ canales: { operador: { requiere_aprobacion: true } } }),
        )
        const { servicioId } = await servicioCortado({ plantilla: { reglas_promesa: reglas } })
        const { token: cajero } = await usuarioConRoles(['cajero'])
        const { token: contador, usuario } = await usuarioConRoles(['contabilidad'])
        const creada = await crear(client, cajero, servicioId)
        assert.equal(creada.body().estado, 'pendiente_aprobacion')
        const ruta = `/api/v1/promesas/${creada.body().id}/rechazar`

        await estado(client.post(ruta).bearerToken(cajero).json({ motivo: 'no procede' }), 403)
        await estado(client.post(ruta).bearerToken(contador).json({}), 422)
        const rechazada = await estado(
            client.post(ruta).bearerToken(contador).json({ motivo: 'Ya incumplió dos promesas este año' }),
            200,
        )
        assert.containSubset(rechazada.body(), { id: creada.body().id, estado: 'rechazada' })
        assert.containSubset(rechazada.body().resultado_evaluacion.cierre, {
            estado: 'rechazada',
            motivo: 'Ya incumplió dos promesas este año',
            por: usuario.id,
        })
        assert.equal(await estadoServicio(servicioId), 'suspendido')
        const cambio = await db
            .from('audit.cambios')
            .where('entidad_tipo', 'promesa')
            .where('entidad_id', creada.body().id)
            .where('campo', 'estado')
            .firstOrFail()
        assert.equal(cambio.despues, 'rechazada')

        // ya rechazada: ni rechazar ni cancelar
        await estado(client.post(ruta).bearerToken(contador).json({ motivo: 'otra vez' }), 409)
        await estado(
            client
                .post(`/api/v1/promesas/${creada.body().id}/cancelar`)
                .bearerToken(contador)
                .json({ motivo: 'otra vez' }),
            409,
        )
    })

    test('cancelar una activa: el servicio se re-evalúa y vuelve a cortarse', async ({ client, assert }) => {
        const { servicioId } = await servicioCortado()
        const { token: cajero } = await usuarioConRoles(['cajero'])
        const { token: admin } = await usuarioConRoles(['admin'])
        const creada = await crear(client, cajero, servicioId)
        assert.equal(creada.body().estado, 'activa')
        assert.equal(await estadoServicio(servicioId), 'activo')
        const ruta = `/api/v1/promesas/${creada.body().id}/cancelar`

        await estado(client.post(ruta).bearerToken(cajero).json({ motivo: 'error de captura' }), 403)
        const cancelada = await estado(
            client.post(ruta).bearerToken(admin).json({ motivo: 'Se capturó en el servicio equivocado' }),
            200,
        )
        assert.containSubset(cancelada.body(), { estado: 'cancelada' })
        assert.equal(
            cancelada.body().resultado_evaluacion.cierre.motivo,
            'Se capturó en el servicio equivocado',
        )
        assert.equal(await estadoServicio(servicioId), 'suspendido')
        await estado(client.post(ruta).bearerToken(admin).json({ motivo: 'de nuevo' }), 409)

        // la cancelada no ocupa el lugar: se puede crear otra
        const otra = await crear(client, cajero, servicioId)
        assert.equal(otra.body().estado, 'activa')
    })
})
