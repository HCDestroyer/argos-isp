import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'

/**
 * Tarea 12: historial de asignaciones (`network.asignaciones_historial`) y
 * `GET /servicios/:id/asignaciones`.
 */

interface Tramo {
    id: number
    router_id: number | null
    plan_id: number | null
    plan_nombre: string | null
    ipv4: string | null
    prefijo_enlace_v6: string | null
    prefijo_delegado_v6: string | null
    inicio: string
    fin: string | null
    motivo: string | null
}

test.group('Servicios · historial de asignaciones', () => {
    test('alta abre un tramo; editar plan o IP cierra y abre; editar datos no; retirar cierra', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { routerId, base, raiz } = await crearEscenarioRouter()
        const planA = await crearPlanFila()
        const planB = await crearPlanFila({ nombre: 'Plan B historial' + Date.now() })

        const creado = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({
                    plantilla_facturacion_id: null,
                    cliente_id: await crearClienteFila(),
                    router_id: routerId,
                    plan_id: planA,
                }),
            201,
        )
        const id = creado.body().id
        const listar = async (query = '') => {
            const respuesta = await estado(
                client.get(`/api/v1/servicios/${id}/asignaciones${query}`).bearerToken(token),
                200,
            )
            return respuesta.body() as { data: Tramo[]; nextCursor: string | null }
        }

        let pagina = await listar()
        assert.lengthOf(pagina.data, 1)
        assert.containsSubset(pagina.data[0], {
            router_id: routerId,
            plan_id: planA,
            ipv4: `${base}.2`,
            prefijo_enlace_v6: `${raiz}00::/64`,
            prefijo_delegado_v6: `${raiz}10::/56`,
            fin: null,
            motivo: 'alta',
        })

        // datos sin efecto en asignaciones: no hay tramo nuevo
        await estado(
            client
                .put(`/api/v1/servicios/${id}`)
                .bearerToken(token)
                .json({ version: 1, direccion: 'Zona 4' }),
            200,
        )
        pagina = await listar()
        assert.lengthOf(pagina.data, 1)

        await estado(
            client.put(`/api/v1/servicios/${id}`).bearerToken(token).json({ version: 2, plan_id: planB }),
            200,
        )
        await estado(
            client
                .put(`/api/v1/servicios/${id}`)
                .bearerToken(token)
                .json({ version: 3, ipv4: `${base}.50` }),
            200,
        )
        pagina = await listar()
        assert.lengthOf(pagina.data, 3)
        const [ip, plan, alta] = pagina.data
        assert.containsSubset(ip, { plan_id: planB, ipv4: `${base}.50`, fin: null, motivo: 'edicion: ips' })
        assert.containsSubset(plan, { plan_id: planB, ipv4: `${base}.2`, motivo: 'edicion: plan' })
        const filaPlanB = await db.from('network.planes').where('id', planB).first()
        assert.equal(plan!.plan_nombre, filaPlanB.nombre)
        assert.equal(alta!.plan_id, planA)
        // los tramos se encadenan: fin del anterior = inicio del siguiente
        assert.equal(alta!.fin, plan!.inicio)
        assert.equal(plan!.fin, ip!.inicio)

        await estado(
            client.post(`/api/v1/servicios/${id}/retirar`).bearerToken(token).json({ motivo: 'baja' }),
            200,
        )
        pagina = await listar()
        assert.lengthOf(pagina.data, 3)
        assert.isNotNull(pagina.data[0]!.fin)
        const abiertos = await db
            .from('network.asignaciones_historial')
            .where('servicio_id', id)
            .whereNull('fin')
            .count('* as n')
        assert.equal(Number(abiertos[0].n), 0)

        // paginación por cursor
        const primera = await listar('?limit=2')
        assert.lengthOf(primera.data, 2)
        assert.isString(primera.nextCursor)
        const segunda = await listar(`?limit=2&cursor=${primera.nextCursor}`)
        assert.lengthOf(segunda.data, 1)
        assert.isNull(segunda.nextCursor)
        assert.equal(segunda.data[0]!.motivo, 'alta')
    })

    test('cambio de router: tramo nuevo con IPs del router nuevo; 404 si el servicio no existe', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const a = await crearEscenarioRouter()
        const b = await crearEscenarioRouter()
        const creado = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({
                    plantilla_facturacion_id: null,
                    cliente_id: await crearClienteFila(),
                    router_id: a.routerId,
                    plan_id: await crearPlanFila(),
                }),
            201,
        )
        const id = creado.body().id
        await estado(
            client
                .put(`/api/v1/servicios/${id}`)
                .bearerToken(token)
                .json({ version: 1, router_id: b.routerId }),
            200,
        )
        const pagina = await estado(
            client.get(`/api/v1/servicios/${id}/asignaciones`).bearerToken(token),
            200,
        )
        const [nuevo, viejo] = pagina.body().data as Tramo[]
        assert.containsSubset(nuevo, { router_id: b.routerId, ipv4: `${b.base}.2`, fin: null })
        assert.include(nuevo!.motivo!, 'router')
        assert.containsSubset(viejo, { router_id: a.routerId, ipv4: `${a.base}.2` })

        await estado(client.get('/api/v1/servicios/999999999/asignaciones').bearerToken(token), 404)
    })
})
