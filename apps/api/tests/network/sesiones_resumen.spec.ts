import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearRouterFila, crearServicioFila, ipUnica } from '#tests/core/fabricas'

/**
 * Semana 3 · tarea 2 de A2 (pedido de A4, pantalla "Migración de router"):
 * `GET /sesiones?desde=&hasta=` y `GET /routers/:id/resumen-sesiones?desde=`.
 */

const HORA = 3_600_000
const hace = (horas: number) => new Date(Date.now() - horas * HORA)

async function sesion(datos: {
    servicioId: number | null
    routerId: number
    nasIp: string
    inicio: Date
    fin?: Date | null
    userPpp?: string
}): Promise<number> {
    const [fila] = (await db
        .table('network.sesiones')
        .insert({
            servicio_id: datos.servicioId,
            router_id: datos.routerId,
            nas_ip: datos.nasIp,
            acct_session_id: unico('ses'),
            user_ppp: datos.userPpp ?? unico('ppp'),
            inicio: datos.inicio,
            fin: datos.fin ?? null,
            causa_fin: datos.fin ? 'User-Request' : null,
        })
        .returning('id')) as Array<{ id: number | string }>
    return Number(fila!.id)
}

async function servicio(routerId: number, datos: Record<string, unknown> = {}) {
    return crearServicioFila({
        cliente_id: await crearClienteFila(),
        router_id: routerId,
        ipv6_modo: 'ninguno',
        ...datos,
    })
}

async function ids(client: ApiClient, token: string, qs: Record<string, unknown>): Promise<number[]> {
    const r = await estado(client.get('/api/v1/sesiones').qs(qs).bearerToken(token), 200)
    return (r.body() as { data: Array<{ id: number }> }).data.map((x) => x.id)
}

test.group('network · resumen de sesiones por router (semana 3, tarea 2)', () => {
    test('GET /sesiones filtra por solapamiento con desde/hasta', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const nasIp = ipUnica()
        const routerId = await crearRouterFila({ nas_ip: nasIp })
        const s = await servicio(routerId)
        // [-10h, -8h], [-6h, -2h], [-1h, abierta]
        const vieja = await sesion({ servicioId: s, routerId, nasIp, inicio: hace(10), fin: hace(8) })
        const media = await sesion({ servicioId: s, routerId, nasIp, inicio: hace(6), fin: hace(2) })
        const abierta = await sesion({ servicioId: s, routerId, nasIp, inicio: hace(1) })

        assert.deepEqual(await ids(client, token, { router_id: routerId }), [abierta, media, vieja])
        assert.deepEqual(await ids(client, token, { router_id: routerId, desde: hace(3).toISOString() }), [
            abierta,
            media,
        ])
        assert.deepEqual(await ids(client, token, { router_id: routerId, hasta: hace(7).toISOString() }), [
            vieja,
        ])
        assert.deepEqual(
            await ids(client, token, {
                router_id: routerId,
                desde: hace(9).toISOString(),
                hasta: hace(5).toISOString(),
            }),
            [media, vieja],
        )
        assert.deepEqual(
            await ids(client, token, {
                router_id: routerId,
                desde: hace(7.5).toISOString(),
                hasta: hace(6.5).toISOString(),
            }),
            [],
        )
        assert.deepEqual(
            await ids(client, token, { router_id: routerId, activa: false, desde: hace(9).toISOString() }),
            [media, vieja],
        )
        await estado(client.get('/api/v1/sesiones').qs({ desde: 'ayer' }).bearerToken(token), 422)
    })

    test('GET /routers/:id/resumen-sesiones cuenta servicios, sesiones activas y PPPoE sin sesión desde', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const nasIp = ipUnica()
        const routerId = await crearRouterFila({ nas_ip: nasIp })
        const migracion = hace(24)

        const conAbierta = await servicio(routerId)
        await sesion({ servicioId: conAbierta, routerId, nasIp, inicio: hace(2) })
        const conCerradaDespues = await servicio(routerId)
        await sesion({ servicioId: conCerradaDespues, routerId, nasIp, inicio: hace(30), fin: hace(20) })
        const soloAntes = await servicio(routerId, { estado: 'suspendido' })
        const finSoloAntes = hace(48)
        await sesion({ servicioId: soloAntes, routerId, nasIp, inicio: hace(50), fin: finSoloAntes })
        const nunca = await servicio(routerId)
        const retirado = await servicio(routerId, { estado: 'retirado' })
        // Pendiente de instalación: aaa lo rechaza, no puede tener sesión; no cuenta (`contratos/instalacion.md`)
        const pendiente = await servicio(routerId, { estado: 'pendiente_instalacion', instalado_en: null })
        // sesión de un user_ppp desconocido: cuenta en sesiones_activas, no en servicios
        await sesion({ servicioId: null, routerId, nasIp, inicio: hace(1) })

        const r = await estado(
            client
                .get(`/api/v1/routers/${routerId}/resumen-sesiones`)
                .qs({ desde: migracion.toISOString() })
                .bearerToken(token),
            200,
        )
        const cuerpo = r.body() as Record<string, any>
        assert.include(cuerpo, {
            router_id: routerId,
            desde: migracion.toISOString(),
            servicios: 4,
            con_sesion_activa: 1,
            sesiones_activas: 2,
            con_sesion_desde: 2,
        })
        const sin = cuerpo.sin_sesion_desde as Array<Record<string, unknown>>
        assert.deepEqual(
            sin.map((x) => x.servicio_id),
            [soloAntes, nunca],
        )
        assert.notInclude(
            sin.map((x) => x.servicio_id),
            retirado,
        )
        assert.notInclude(
            sin.map((x) => x.servicio_id),
            pendiente,
        )
        assert.deepEqual(Object.keys(sin[0]!).sort(), [
            'cliente_id',
            'cliente_nombre',
            'estado',
            'servicio_id',
            'ultima_sesion_fin',
            'ultima_sesion_inicio',
            'user_ppp',
        ])
        assert.equal(sin[0]!.estado, 'suspendido')
        assert.equal(sin[0]!.ultima_sesion_fin, finSoloAntes.toISOString())
        assert.isNull(sin[1]!.ultima_sesion_inicio)

        // Con `desde` más viejo, el suspendido también tuvo sesión.
        const antes = await estado(
            client
                .get(`/api/v1/routers/${routerId}/resumen-sesiones`)
                .qs({ desde: hace(49).toISOString() })
                .bearerToken(token),
            200,
        )
        assert.deepEqual(
            (antes.body() as { sin_sesion_desde: Array<{ servicio_id: number }> }).sin_sesion_desde.map(
                (x) => x.servicio_id,
            ),
            [nunca],
        )
    })

    test('resumen: 404, 422, permiso y alcance', async ({ client }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const desde = hace(1).toISOString()
        await estado(
            client.get('/api/v1/routers/999999999/resumen-sesiones').qs({ desde }).bearerToken(token),
            404,
        )
        const routerId = await crearRouterFila({ nas_ip: ipUnica() })
        await estado(client.get(`/api/v1/routers/${routerId}/resumen-sesiones`).bearerToken(token), 422)

        const { token: cajero } = await usuarioConRoles(['cajero'])
        await estado(
            client.get(`/api/v1/routers/${routerId}/resumen-sesiones`).qs({ desde }).bearerToken(cajero),
            403,
        )

        const otro = await crearRouterFila({ nas_ip: ipUnica() })
        const { usuario, token: acotado } = await usuarioConRoles([])
        const rol = (await db.from('core.roles').where('nombre', 'tecnico').select('id').first()) as {
            id: number
        }
        await db.table('core.usuarios_roles').insert({
            usuario_id: usuario.id,
            role_id: rol.id,
            alcance_tipo: 'router',
            alcance_id: routerId,
        })
        await estado(
            client.get(`/api/v1/routers/${routerId}/resumen-sesiones`).qs({ desde }).bearerToken(acotado),
            200,
        )
        await estado(
            client.get(`/api/v1/routers/${otro}/resumen-sesiones`).qs({ desde }).bearerToken(acotado),
            403,
        )
    })
})
