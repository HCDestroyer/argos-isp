import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import {
    crearClienteFila,
    crearEscenarioRouter,
    crearPlanFila,
    crearRouterFila,
    crearServicioFila,
} from '#tests/core/fabricas'

/**
 * `routers.eliminar` (`contratos/eliminar.md`): solo routers que nunca se usaron. Una prueba por
 * cada cosa que lo impide y el caso feliz (se va con sus redes, bloques, pools y planes_routers).
 */

interface RouterPrueba {
    id: number
    nasIp: string
    redId: number
    poolEnlaceId: number
    base: string
    raiz: string
}

async function routerConPools(): Promise<RouterPrueba> {
    const { routerId, base, raiz } = await crearEscenarioRouter()
    const red = await db.from('network.redes_ipv4').where('router_id', routerId).firstOrFail()
    const pool = await db
        .from('network.ipv6_pools')
        .join('network.ipv6_bloques as b', 'b.id', 'network.ipv6_pools.bloque_id')
        .where('b.router_id', routerId)
        .where('network.ipv6_pools.tipo', 'enlace')
        .select('network.ipv6_pools.id')
        .firstOrFail()
    const r = await db
        .from('network.routers')
        .where('id', routerId)
        .select(db.raw('host(nas_ip) AS nas'))
        .firstOrFail()
    return { id: routerId, nasIp: r.nas, redId: Number(red.id), poolEnlaceId: Number(pool.id), base, raiz }
}

/** Servicio en OTRO router (para historial o asignaciones que apuntan a este). */
async function servicioAjeno(): Promise<number> {
    return crearServicioFila({ cliente_id: await crearClienteFila(), router_id: await crearRouterFila() })
}

const BLOQUEOS: Array<{ codigo: string; preparar: (r: RouterPrueba) => Promise<unknown> }> = [
    {
        codigo: 'servicios',
        preparar: async (r) =>
            crearServicioFila({ cliente_id: await crearClienteFila(), router_id: r.id, estado: 'retirado' }),
    },
    {
        codigo: 'sesiones',
        preparar: (r) =>
            db.table('network.sesiones').insert({
                router_id: r.id,
                nas_ip: r.nasIp,
                acct_session_id: unico('acct'),
                user_ppp: unico('ppp'),
            }),
    },
    {
        // sesión de un NAS sin router identificado: cuenta por nas_ip
        codigo: 'sesiones',
        preparar: (r) =>
            db.table('network.sesiones').insert({
                router_id: null,
                nas_ip: r.nasIp,
                acct_session_id: unico('acct'),
                user_ppp: unico('ppp'),
            }),
    },
    {
        codigo: 'historial_asignaciones',
        preparar: async (r) =>
            db.table('network.asignaciones_historial').insert({
                servicio_id: await servicioAjeno(),
                router_id: r.id,
                inicio: new Date(Date.now() - 86_400_000).toISOString(),
                fin: new Date().toISOString(),
                motivo: 'edicion: router',
            }),
    },
    {
        codigo: 'asignaciones_ipv4',
        preparar: async (r) =>
            db.table('network.ipv4_asignaciones').insert({
                servicio_id: await servicioAjeno(),
                red_id: r.redId,
                ip: `${r.base}.20`,
                inicio: new Date(Date.now() - 86_400_000).toISOString(),
                fin: new Date().toISOString(),
            }),
    },
    {
        codigo: 'asignaciones_ipv6',
        preparar: async (r) =>
            db.table('network.ipv6_asignaciones').insert({
                servicio_id: await servicioAjeno(),
                pool_id: r.poolEnlaceId,
                prefijo: `${r.raiz}00::/64`,
                tipo: 'enlace',
                inicio: new Date(Date.now() - 86_400_000).toISOString(),
                fin: new Date().toISOString(),
            }),
    },
    {
        codigo: 'routeros',
        preparar: (r) =>
            db.table('audit.red').insert({
                tipo: 'routeros',
                router_id: r.id,
                comando: JSON.stringify({ operacion: 'aplicar', metodo: 'PUT', ruta: '/queue/simple' }),
                respuesta: JSON.stringify({ status: 201 }),
                ok: true,
            }),
    },
    {
        codigo: 'routeros',
        preparar: (r) =>
            db.table('audit.red').insert({
                tipo: 'disconnect',
                router_id: r.id,
                comando: JSON.stringify({ user_ppp: 'x' }),
                respuesta: JSON.stringify({ code: 'Disconnect-ACK' }),
                ok: true,
            }),
    },
    {
        codigo: 'bodegas',
        preparar: (r) =>
            db.table('inventario.bodegas').insert({
                empresa_id: 1,
                nombre: unico('Bodega nodo'),
                tipo: 'bodega',
                router_id: r.id,
            }),
    },
    {
        codigo: 'alcance_roles',
        preparar: async (r) => {
            const { usuario } = await usuarioConRoles([])
            const rol = await db.from('core.roles').where('nombre', 'tecnico').firstOrFail()
            await db
                .table('core.usuarios_roles')
                .insert({ usuario_id: usuario.id, role_id: rol.id, alcance_tipo: 'router', alcance_id: r.id })
        },
    },
    {
        codigo: 'alcance_tokens',
        preparar: async (r) => {
            const { usuario } = await usuarioConRoles([])
            await db.table('core.tokens_api').insert({
                usuario_id: usuario.id,
                nombre: unico('token'),
                hash: unico('hash'),
                alcances: JSON.stringify({ routers: [r.id] }),
            })
        },
    },
    {
        codigo: 'importacion',
        preparar: (r) =>
            db.table('importacion.filas_origen').insert({
                origen: 'prueba_eliminar',
                tabla: 'routers',
                id_externo: unico('mw'),
                linea: 1,
                fila: JSON.stringify({}),
                estado: 'importada',
                entidad_tipo: 'router',
                entidad_id: r.id,
                huella: 'h',
                request_id: unico('req'),
            }),
    },
]

test.group('Routers · eliminar sin historial', () => {
    test('recién creado: se elimina con sus redes, bloques, pools y planes_routers', async ({
        client,
        assert,
    }) => {
        const { token, usuario } = await usuarioConRoles(['admin'])
        const r = await routerConPools()
        const planId = await crearPlanFila()
        await db
            .table('network.planes_routers')
            .insert({ plan_id: planId, router_id: r.id, profile_ppp: 'p' })
        await db
            .table('network.routers_contacto')
            .insert({ router_id: r.id, ultimo_contacto: new Date().toISOString(), fuente: 'sondeo' })
        // un sondeo (GET) no es historial que conservar
        await db.table('audit.red').insert({
            tipo: 'routeros',
            router_id: r.id,
            comando: JSON.stringify({ operacion: 'sondear', metodo: 'GET', ruta: '/system/resource' }),
            respuesta: JSON.stringify({ status: 200 }),
            ok: true,
        })

        const previa = await estado(client.get(`/api/v1/routers/${r.id}/eliminable`).bearerToken(token), 200)
        assert.deepEqual(previa.body(), { eliminable: true, motivos: [] })

        const requestId = unico('req')
        await estado(
            client
                .delete(`/api/v1/routers/${r.id}`)
                .qs({ version: 1 })
                .bearerToken(token)
                .header('X-Request-Id', requestId),
            204,
        )

        assert.isNull(await db.from('network.routers').where('id', r.id).first())
        assert.isNull(await db.from('network.redes_ipv4').where('router_id', r.id).first())
        assert.isNull(await db.from('network.ipv6_bloques').where('router_id', r.id).first())
        assert.isNull(await db.from('network.ipv6_pools').where('id', r.poolEnlaceId).first())
        assert.isNull(await db.from('network.planes_routers').where('router_id', r.id).first())
        assert.isNull(await db.from('network.routers_contacto').where('router_id', r.id).first())
        assert.isNotNull(await db.from('network.planes').where('id', planId).first(), 'el plan se conserva')

        const accion = await db
            .from('audit.acciones')
            .where({ accion: 'routers.eliminar', request_id: requestId, resultado: 'ok' })
            .firstOrFail()
        assert.equal(accion.actor_id, usuario.id)
        assert.lengthOf(accion.entrada.auditoria.foto.redes_ipv4, 1)
        assert.lengthOf(accion.entrada.auditoria.foto.ipv6_pools, 3)
        const evento = await db
            .from('audit.outbox')
            .where({ request_id: requestId, evento: 'router.eliminado' })
            .firstOrFail()
        assert.deepEqual(evento.payload, { router_id: r.id, empresa_id: null })
        // audit.red no se borra nunca
        assert.isNotNull(await db.from('audit.red').where('router_id', r.id).first())
    })

    test('las credenciales quedan como *** en la foto y en audit.cambios', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const id = await crearRouterFila({ api_password: 'secreta', radius_secret: 'radius-secreto' })
        const requestId = unico('req')
        await estado(
            client
                .delete(`/api/v1/routers/${id}`)
                .qs({ version: 1 })
                .bearerToken(token)
                .header('X-Request-Id', requestId),
            204,
        )
        const accion = await db
            .from('audit.acciones')
            .where({ accion: 'routers.eliminar', request_id: requestId })
            .firstOrFail()
        assert.equal(accion.entrada.auditoria.foto.router.api_password, '***')
        assert.equal(accion.entrada.auditoria.foto.router.radius_secret, '***')
        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'router', entidad_id: id, request_id: requestId })
        const secreto = cambios.find((c) => c.campo === 'radius_secret')
        assert.equal(secreto?.antes, '***')
        assert.notInclude(JSON.stringify(cambios), 'radius-secreto')
    })

    for (const [i, caso] of BLOQUEOS.entries()) {
        test(`con ${caso.codigo} (#${i}): 422 router_con_historial y se conserva`, async ({
            client,
            assert,
        }) => {
            const { token } = await usuarioConRoles(['admin'])
            const r = await routerConPools()
            await caso.preparar(r)

            const previa = await estado(
                client.get(`/api/v1/routers/${r.id}/eliminable`).bearerToken(token),
                200,
            )
            assert.isFalse(previa.body().eliminable)
            assert.include(
                previa.body().motivos.map((m: { codigo: string }) => m.codigo),
                caso.codigo,
            )

            const respuesta = await estado(
                client.delete(`/api/v1/routers/${r.id}`).qs({ version: 1 }).bearerToken(token),
                422,
            )
            assert.equal(respuesta.body().type, 'urn:argosisp:problema:router_con_historial')
            assert.include(
                respuesta.body().errors.map((e: { field: string }) => e.field),
                caso.codigo,
            )
            assert.isNotNull(await db.from('network.routers').where('id', r.id).first())
            assert.isNotNull(await db.from('network.redes_ipv4').where('router_id', r.id).first())
        })
    }

    test('un token revocado con alcance en el router no lo impide', async ({ client }) => {
        const { token, usuario } = await usuarioConRoles(['admin'])
        const id = await crearRouterFila()
        await db.table('core.tokens_api').insert({
            usuario_id: usuario.id,
            nombre: unico('token'),
            hash: unico('hash'),
            alcances: JSON.stringify({ routers: [id] }),
            revocado_en: new Date().toISOString(),
        })
        await estado(client.delete(`/api/v1/routers/${id}`).qs({ version: 1 }).bearerToken(token), 204)
    })

    test('solo admin; version vieja → 409; inexistente → 404', async ({ client }) => {
        const admin = await usuarioConRoles(['admin'])
        const tecnico = await usuarioConRoles(['tecnico'])
        const id = await crearRouterFila()
        await estado(
            client.delete(`/api/v1/routers/${id}`).qs({ version: 1 }).bearerToken(tecnico.token),
            403,
        )
        await estado(client.delete(`/api/v1/routers/${id}`).qs({ version: 2 }).bearerToken(admin.token), 409)
        await estado(
            client.delete('/api/v1/routers/999999999').qs({ version: 1 }).bearerToken(admin.token),
            404,
        )
        await estado(client.get('/api/v1/routers/999999999/eliminable').bearerToken(admin.token), 404)
    })

    test('GET /routers?activo=false lista los desactivados', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const id = await crearRouterFila({ activo: false })
        const ids: number[] = []
        let cursor: string | null = null
        do {
            const qs: Record<string, unknown> = { activo: false, limit: 100, ...(cursor ? { cursor } : {}) }
            const r = await estado(client.get('/api/v1/routers').qs(qs).bearerToken(token), 200)
            for (const x of r.body().data as Array<{ id: number; activo: boolean }>) {
                assert.isFalse(x.activo)
                ids.push(x.id)
            }
            cursor = r.body().nextCursor
        } while (cursor)
        assert.include(ids, id)
    })
})
