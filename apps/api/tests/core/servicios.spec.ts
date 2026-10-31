import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { descifrar } from '#shared/cifrado'
import { obtenerConfiguracionEfectiva } from '#core/actions/obtener_configuracion_efectiva'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import {
    bloqueV6Unico,
    crearClienteFila,
    crearPlanFila,
    crearRouterFila,
    redUnica,
} from '#tests/core/fabricas'

/**
 * Router con una red IPv4 /24 (gateway .1) y un bloque IPv6 /40 con pools de enlace (/48 → /64)
 * y de delegación (/44 → /56 y /44 → /48).
 */
async function escenarioRouter() {
    const routerId = await crearRouterFila()
    const cidr = redUnica()
    const base = cidr.replace('.0/24', '')
    await db
        .table('network.redes_ipv4')
        .insert({ router_id: routerId, cidr, gateway: `${base}.1`, tipo: 'estatico' })

    const bloque = bloqueV6Unico() // 2001:db8:XX00::/40
    const raiz = bloque.replace('00::/40', '')
    const [b] = (await db
        .table('network.ipv6_bloques')
        .insert({ router_id: routerId, prefijo: bloque })
        .returning('id')) as Array<{ id: number }>
    await db.table('network.ipv6_pools').multiInsert([
        { bloque_id: b!.id, prefijo: `${raiz}00::/48`, tipo: 'enlace', tamano_entrega: 64 },
        { bloque_id: b!.id, prefijo: `${raiz}10::/44`, tipo: 'delegacion', tamano_entrega: 56 },
        { bloque_id: b!.id, prefijo: `${raiz}20::/44`, tipo: 'delegacion', tamano_entrega: 48 },
    ])
    return { routerId, base, raiz }
}

async function planDual(extra: Record<string, unknown> = {}) {
    return crearPlanFila({ bajada_limitada_kbps: 1024, subida_limitada_kbps: 512, ...extra })
}

async function eventos(requestId: string) {
    const filas = await db.from('audit.outbox').where('request_id', requestId).orderBy('id')
    return filas.map((f) => ({ evento: f.evento as string, payload: f.payload }))
}

test.group('Servicios · alta', () => {
    test('alta PPPoE dual stack: IPv4, /64 y /56, user_ppp único, outbox y auditoría', async ({
        client,
        assert,
    }) => {
        const { token, usuario } = await usuarioConRoles(['soporte'])
        const { routerId, base, raiz } = await escenarioRouter()
        const planId = await planDual()
        const clienteId = await crearClienteFila({ nombre: 'Ana López' })
        const requestId = unico('req')

        const respuesta = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .header('X-Request-Id', requestId)
                .header('X-Canal', 'panel')
                .json({
                    plantilla_facturacion_id: null,
                    cliente_id: clienteId,
                    router_id: routerId,
                    plan_id: planId,
                    direccion: 'Zona 1',
                }),
            201,
        )
        const s = respuesta.body()
        assert.containsSubset(s, {
            cliente_id: clienteId,
            router_id: routerId,
            plan_id: planId,
            estado: 'activo',
            promesa_activa: false,
            user_ppp: `ana.${clienteId}`,
            ipv4: `${base}.2`,
            prefijo_enlace_v6: `${raiz}00::/64`,
            prefijo_delegado_v6: `${raiz}10::/56`,
            ipv6_modo: 'radius_servicio',
            version: 1,
        })
        assert.notProperty(s, 'pass_ppp')

        const fila = await db.from('core.servicios').where('id', s.id).firstOrFail()
        assert.match(fila.pass_ppp, /^v1\./)
        assert.lengthOf(descifrar(fila.pass_ppp), 12)

        const evs = await eventos(requestId)
        assert.deepEqual(evs, [
            {
                evento: 'servicio.creado',
                payload: {
                    servicio_id: s.id,
                    empresa_id: 1,
                    cliente_id: clienteId,
                    router_id: routerId,
                    plan_id: planId,
                },
            },
            {
                evento: 'asignacion.cambiada',
                payload: {
                    servicio_id: s.id,
                    empresa_id: 1,
                    ipv4: [`${base}.2`],
                    prefijo_enlace_v6: `${raiz}00::/64`,
                    prefijo_delegado_v6: `${raiz}10::/56`,
                    inicio: evs[1]!.payload.inicio,
                    fin: null,
                },
            },
        ])

        const accion = await db.from('audit.acciones').where('request_id', requestId).firstOrFail()
        assert.containsSubset(accion, {
            accion: 'servicios.crear',
            actor_tipo: 'usuario',
            actor_id: usuario.id,
            canal: 'panel',
            entidad_tipo: 'servicio',
            entidad_id: s.id,
            resultado: 'ok',
        })
        const cambioClave = await db
            .from('audit.cambios')
            .where({ request_id: requestId, campo: 'pass_ppp' })
            .firstOrFail()
        assert.equal(cambioClave.despues, '***')
    })

    test('dos servicios reciben IPs y prefijos distintos; user_ppp repetido se numera', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const { routerId, base, raiz } = await escenarioRouter()
        const planId = await planDual()
        const clienteId = await crearClienteFila({ nombre: 'Óscar Pérez' })
        const cuerpo = {
            plantilla_facturacion_id: null,
            cliente_id: clienteId,
            router_id: routerId,
            plan_id: planId,
        }

        const a = await estado(client.post('/api/v1/servicios').bearerToken(token).json(cuerpo), 201)
        const b = await estado(client.post('/api/v1/servicios').bearerToken(token).json(cuerpo), 201)
        assert.equal(a.body().user_ppp, `oscar.${clienteId}`)
        assert.equal(b.body().user_ppp, `oscar.${clienteId}-2`)
        assert.equal(b.body().ipv4, `${base}.3`)
        assert.equal(b.body().prefijo_enlace_v6, `${raiz}00:1::/64`)
        assert.equal(b.body().prefijo_delegado_v6, `${raiz}10:100::/56`)

        await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({ ...cuerpo, user_ppp: a.body().user_ppp }),
            409,
        )
        // IP fija pedida y ya ocupada
        await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({ ...cuerpo, ipv4: `${base}.2` }),
            409,
        )
    })

    test('credenciales: se ven en claro con permiso y la consulta queda auditada', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const { routerId } = await escenarioRouter()
        const creado = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({
                    plantilla_facturacion_id: null,
                    cliente_id: await crearClienteFila(),
                    router_id: routerId,
                    plan_id: await planDual(),
                    user_ppp: unico('fijo'),
                    pass_ppp: 'clave-del-cpe',
                }),
            201,
        )
        const requestId = unico('req')
        const credenciales = await estado(
            client
                .get(`/api/v1/servicios/${creado.body().id}/credenciales`)
                .bearerToken(token)
                .header('X-Request-Id', requestId),
            200,
        )
        assert.deepEqual(credenciales.body(), {
            servicio_id: creado.body().id,
            user_ppp: creado.body().user_ppp,
            pass_ppp: 'clave-del-cpe',
        })
        const accion = await db.from('audit.acciones').where('request_id', requestId).firstOrFail()
        assert.equal(accion.accion, 'servicios.ver_credenciales')

        const cajero = await usuarioConRoles(['cajero'])
        await estado(
            client.get(`/api/v1/servicios/${creado.body().id}/credenciales`).bearerToken(cajero.token),
            403,
        )
        await estado(client.get(`/api/v1/servicios/${creado.body().id}`).bearerToken(cajero.token), 200)
    })

    test('modos IPv6: plan solo v4, estatico, radius_pool y router sin pools', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { routerId, raiz } = await escenarioRouter()
        const clienteId = await crearClienteFila()
        const soloV4 = await planDual({ dual_stack: 'v4' })
        const dual = await planDual()

        const v4 = await estado(
            client.post('/api/v1/servicios').bearerToken(token).json({
                plantilla_facturacion_id: null,
                cliente_id: clienteId,
                router_id: routerId,
                plan_id: soloV4,
            }),
            201,
        )
        assert.containsSubset(v4.body(), {
            ipv6_modo: 'ninguno',
            prefijo_enlace_v6: null,
            prefijo_delegado_v6: null,
        })
        await estado(
            client.post('/api/v1/servicios').bearerToken(token).json({
                plantilla_facturacion_id: null,
                cliente_id: clienteId,
                router_id: routerId,
                plan_id: soloV4,
                ipv6_modo: 'radius_servicio',
            }),
            422,
        )

        const manual = `${raiz}f0::/56`
        const estatico = await estado(
            client.post('/api/v1/servicios').bearerToken(token).json({
                plantilla_facturacion_id: null,
                cliente_id: clienteId,
                router_id: routerId,
                plan_id: dual,
                ipv6_modo: 'estatico',
                prefijo_delegado_v6: manual,
            }),
            201,
        )
        assert.containsSubset(estatico.body(), { prefijo_delegado_v6: manual, prefijo_enlace_v6: null })
        await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({
                    plantilla_facturacion_id: null,
                    cliente_id: clienteId,
                    router_id: routerId,
                    plan_id: dual,
                    ipv6_modo: 'estatico',
                    prefijo_delegado_v6: `${raiz}f0::/60`,
                }),
            409,
        )
        await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({
                    plantilla_facturacion_id: null,
                    cliente_id: clienteId,
                    router_id: routerId,
                    plan_id: dual,
                    prefijo_delegado_v6: `${raiz}f1::/56`,
                }),
            422,
        )

        const pool = await estado(
            client.post('/api/v1/servicios').bearerToken(token).json({
                plantilla_facturacion_id: null,
                cliente_id: clienteId,
                router_id: routerId,
                plan_id: dual,
                ipv6_modo: 'radius_pool',
            }),
            201,
        )
        assert.containsSubset(pool.body(), { prefijo_enlace_v6: null, prefijo_delegado_v6: null })

        const sinPools = await crearRouterFila()
        await db
            .table('network.redes_ipv4')
            .insert({ router_id: sinPools, cidr: redUnica(), tipo: 'estatico' })
        const rechazo = await estado(
            client.post('/api/v1/servicios').bearerToken(token).json({
                plantilla_facturacion_id: null,
                cliente_id: clienteId,
                router_id: sinPools,
                plan_id: dual,
            }),
            422,
        )
        assert.equal(rechazo.body().type, 'urn:argosisp:problema:sin_pool_ipv6')
    })

    test('referencias: plan no disponible en el router, cliente inexistente, router sin IPs', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { routerId } = await escenarioRouter()
        const clienteId = await crearClienteFila()
        const local = await planDual({ global: false })
        const noDisponible = await estado(
            client.post('/api/v1/servicios').bearerToken(token).json({
                plantilla_facturacion_id: null,
                cliente_id: clienteId,
                router_id: routerId,
                plan_id: local,
            }),
            422,
        )
        assert.equal(noDisponible.body().type, 'urn:argosisp:problema:plan_no_disponible')
        await estado(
            client.post('/api/v1/servicios').bearerToken(token).json({
                plantilla_facturacion_id: null,
                cliente_id: 999999,
                router_id: routerId,
                plan_id: local,
            }),
            422,
        )
        const vacio = await crearRouterFila()
        const sinIp = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({
                    plantilla_facturacion_id: null,
                    cliente_id: clienteId,
                    router_id: vacio,
                    plan_id: await planDual({ dual_stack: 'v4' }),
                }),
            422,
        )
        assert.equal(sinIp.body().type, 'urn:argosisp:problema:sin_ipv4')
    })

    test('Idempotency-Key: repetir el alta no crea otro servicio', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const { routerId } = await escenarioRouter()
        const cuerpo = {
            plantilla_facturacion_id: null,
            cliente_id: await crearClienteFila(),
            router_id: routerId,
            plan_id: await planDual(),
        }
        const clave = unico('idem')
        const a = await estado(
            client.post('/api/v1/servicios').bearerToken(token).header('Idempotency-Key', clave).json(cuerpo),
            201,
        )
        const b = await estado(
            client.post('/api/v1/servicios').bearerToken(token).header('Idempotency-Key', clave).json(cuerpo),
            201,
        )
        assert.equal(a.body().id, b.body().id)
        assert.lengthOf(await db.from('core.servicios').where('cliente_id', cuerpo.cliente_id), 1)
    })
})

test.group('Servicios · edición y retiro', () => {
    async function servicioBase(token: string, client: any) {
        const esc = await escenarioRouter()
        const planId = await planDual()
        const r = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({
                    plantilla_facturacion_id: null,
                    cliente_id: await crearClienteFila(),
                    router_id: esc.routerId,
                    plan_id: planId,
                }),
            201,
        )
        return { ...esc, planId, servicio: r.body() }
    }

    test('dos sesiones con la misma version: la segunda recibe 409', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const { servicio } = await servicioBase(token, client)
        const requestId = unico('req')
        const primera = await estado(
            client
                .put(`/api/v1/servicios/${servicio.id}`)
                .bearerToken(token)
                .header('X-Request-Id', requestId)
                .json({ version: 1, direccion: 'Casa azul' }),
            200,
        )
        assert.equal(primera.body().version, 2)
        // solo datos: no hay eventos de configuración, sí `servicio.datos_cambiados` (Iris 0.5.0, A10)
        const emitidos = await eventos(requestId)
        assert.deepEqual(
            emitidos.map((e) => e.evento),
            ['servicio.datos_cambiados'],
        )
        const segunda = await estado(
            client
                .put(`/api/v1/servicios/${servicio.id}`)
                .bearerToken(token)
                .json({ version: 1, direccion: 'Casa roja' }),
            409,
        )
        assert.equal(segunda.body().type, 'urn:argosisp:problema:conflicto_version')
    })

    test('cambiar plan a /48 re-reserva la delegación y emite config_cambiada', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const { servicio, raiz } = await servicioBase(token, client)
        const plan48 = await planDual({ tamano_prefijo_delegado: 48 })
        const requestId = unico('req')
        const editado = await estado(
            client
                .put(`/api/v1/servicios/${servicio.id}`)
                .bearerToken(token)
                .header('X-Request-Id', requestId)
                .json({ version: 1, plan_id: plan48 }),
            200,
        )
        assert.containsSubset(editado.body(), {
            plan_id: plan48,
            ipv4: servicio.ipv4,
            prefijo_enlace_v6: servicio.prefijo_enlace_v6,
            prefijo_delegado_v6: `${raiz}20::/48`,
        })
        const evs = await eventos(requestId)
        assert.deepEqual(evs[0], {
            evento: 'servicio.config_cambiada',
            payload: { servicio_id: servicio.id, empresa_id: 1, campos: ['plan', 'prefijo_v6'] },
        })
        assert.equal(evs[1]!.evento, 'asignacion.cambiada')
        assert.equal(evs[1]!.payload.prefijo_delegado_v6, `${raiz}20::/48`)

        // historial: la /56 anterior quedó cerrada
        const historial = await db
            .from('network.ipv6_asignaciones')
            .where({ servicio_id: servicio.id, tipo: 'delegacion' })
            .orderBy('id')
        assert.lengthOf(historial, 2)
        assert.isNotNull(historial[0].fin)

        // volver al plan /56 recupera el mismo prefijo (estable)
        const vuelta = await estado(
            client
                .put(`/api/v1/servicios/${servicio.id}`)
                .bearerToken(token)
                .json({ version: 2, plan_id: servicio.plan_id }),
            200,
        )
        assert.equal(vuelta.body().prefijo_delegado_v6, servicio.prefijo_delegado_v6)
    })

    test('cambiar de router mueve IPv4 y prefijos; cambiar IP y contraseña', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { servicio, base } = await servicioBase(token, client)
        const otro = await escenarioRouter()
        const requestId = unico('req')
        const movido = await estado(
            client
                .put(`/api/v1/servicios/${servicio.id}`)
                .bearerToken(token)
                .header('X-Request-Id', requestId)
                .json({ version: 1, router_id: otro.routerId }),
            200,
        )
        assert.containsSubset(movido.body(), {
            router_id: otro.routerId,
            ipv4: `${otro.base}.2`,
            prefijo_enlace_v6: `${otro.raiz}00::/64`,
            prefijo_delegado_v6: `${otro.raiz}10::/56`,
        })
        const evs = await eventos(requestId)
        assert.sameMembers(evs[0]!.payload.campos, ['router', 'ips', 'prefijo_v6'])
        const vigentes = await db
            .from('network.ipv4_asignaciones')
            .where('servicio_id', servicio.id)
            .whereNull('fin')
        assert.lengthOf(vigentes, 1)

        const conIp = await estado(
            client
                .put(`/api/v1/servicios/${servicio.id}`)
                .bearerToken(token)
                .json({ version: 2, ipv4: `${otro.base}.77`, pass_ppp: 'nueva-clave' }),
            200,
        )
        assert.equal(conIp.body().ipv4, `${otro.base}.77`)
        const fila = await db.from('core.servicios').where('id', servicio.id).firstOrFail()
        assert.equal(descifrar(fila.pass_ppp), 'nueva-clave')
        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'servicio', entidad_id: servicio.id })
        assert.isFalse(JSON.stringify(cambios).includes('nueva-clave'))
        assert.isTrue(cambios.some((c) => c.campo === 'clave_ppp_cambiada'))

        // IP de una red de otro router → 422
        await estado(
            client
                .put(`/api/v1/servicios/${servicio.id}`)
                .bearerToken(token)
                .json({ version: 3, ipv4: `${base}.9` }),
            422,
        )
    })

    test('retirar libera IPs y prefijos, emite estado_cambiado; no se repite ni se edita', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { servicio } = await servicioBase(token, client)
        const requestId = unico('req')
        const retirado = await estado(
            client
                .post(`/api/v1/servicios/${servicio.id}/retirar`)
                .bearerToken(token)
                .header('X-Request-Id', requestId)
                .json({ motivo: 'Cliente se mudó' }),
            200,
        )
        assert.containsSubset(retirado.body(), {
            estado: 'retirado',
            ipv4: null,
            prefijo_enlace_v6: null,
            prefijo_delegado_v6: null,
            version: 2,
        })
        const evs = await eventos(requestId)
        assert.deepEqual(evs[0], {
            evento: 'servicio.estado_cambiado',
            payload: {
                servicio_id: servicio.id,
                empresa_id: 1,
                de: 'activo',
                a: 'retirado',
                motivo: 'Cliente se mudó',
            },
        })
        assert.containsSubset(evs[1], { evento: 'asignacion.cambiada', payload: { ipv4: [] } })
        assert.lengthOf(
            await db.from('network.ipv6_asignaciones').where('servicio_id', servicio.id).whereNull('fin'),
            0,
        )

        await estado(
            client
                .post(`/api/v1/servicios/${servicio.id}/retirar`)
                .bearerToken(token)
                .json({ motivo: 'otra vez' }),
            422,
        )
        await estado(
            client
                .put(`/api/v1/servicios/${servicio.id}`)
                .bearerToken(token)
                .json({ version: 2, direccion: 'x' }),
            422,
        )
        // la IP liberada queda disponible
        const nuevo = await estado(
            client.post('/api/v1/servicios').bearerToken(token).json({
                plantilla_facturacion_id: null,
                cliente_id: servicio.cliente_id,
                router_id: servicio.router_id,
                plan_id: servicio.plan_id,
            }),
            201,
        )
        assert.equal(nuevo.body().ipv4, servicio.ipv4)
    })

    test('cajero recibe 403 en servicios.suspender y servicios.retirar', async ({ client }) => {
        const { token } = await usuarioConRoles(['cajero'])
        await estado(
            client.post('/api/v1/servicios/1/suspender').bearerToken(token).json({ motivo: 'mora' }),
            403,
        )
        await estado(
            client.post('/api/v1/servicios/1/retirar').bearerToken(token).json({ motivo: 'baja' }),
            403,
        )
    })
})

test.group('Servicios · lectura y alcance', () => {
    test('listar con filtros y búsqueda; alcance por router', async ({ client, assert }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const a = await escenarioRouter()
        const b = await escenarioRouter()
        const planId = await planDual()
        const clienteId = await crearClienteFila({ nombre: unico('Listado') })
        const enA = await estado(
            client.post('/api/v1/servicios').bearerToken(admin).json({
                plantilla_facturacion_id: null,
                cliente_id: clienteId,
                router_id: a.routerId,
                plan_id: planId,
            }),
            201,
        )
        const enB = await estado(
            client.post('/api/v1/servicios').bearerToken(admin).json({
                plantilla_facturacion_id: null,
                cliente_id: clienteId,
                router_id: b.routerId,
                plan_id: planId,
            }),
            201,
        )

        const porCliente = await estado(
            client.get('/api/v1/servicios').qs({ cliente_id: clienteId }).bearerToken(admin),
            200,
        )
        assert.sameMembers(
            porCliente.body().data.map((s: { id: number }) => s.id),
            [enA.body().id, enB.body().id],
        )
        const porIp = await estado(
            client.get('/api/v1/servicios').qs({ q: enB.body().ipv4 }).bearerToken(admin),
            200,
        )
        assert.deepEqual(
            porIp.body().data.map((s: { id: number }) => s.id),
            [enB.body().id],
        )

        const { token, usuario } = await usuarioConRoles([])
        const rol = await db.from('core.roles').where('nombre', 'tecnico').firstOrFail()
        await db.table('core.usuarios_roles').insert({
            usuario_id: usuario.id,
            role_id: rol.id,
            alcance_tipo: 'router',
            alcance_id: a.routerId,
        })
        const visibles = await estado(
            client.get('/api/v1/servicios').qs({ cliente_id: clienteId }).bearerToken(token),
            200,
        )
        assert.deepEqual(
            visibles.body().data.map((s: { id: number }) => s.id),
            [enA.body().id],
        )
        await estado(client.get(`/api/v1/servicios/${enB.body().id}`).bearerToken(token), 403)
        await estado(
            client.post('/api/v1/servicios').bearerToken(token).json({
                plantilla_facturacion_id: null,
                cliente_id: clienteId,
                router_id: b.routerId,
                plan_id: planId,
            }),
            403,
        )
        await estado(
            client
                .put(`/api/v1/servicios/${enA.body().id}`)
                .bearerToken(token)
                .json({ version: 1, router_id: b.routerId }),
            403,
        )
    })

    test('obtenerConfiguracionEfectiva: servicio, plan efectivo, plantilla y excepciones', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { routerId } = await escenarioRouter()
        const planId = await planDual()
        const [plantilla] = (await db
            .table('billing.plantillas_facturacion')
            .insert({ nombre: unico('Plantilla'), dia: 1 })
            .returning('id')) as Array<{ id: number }>
        const creado = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({
                    cliente_id: await crearClienteFila(),
                    router_id: routerId,
                    plan_id: planId,
                    plantilla_facturacion_id: plantilla!.id,
                    costo_override: '99.90',
                    fecha_instalacion: '2026-10-20',
                }),
            201,
        )
        assert.containsSubset(creado.body(), { costo_override: '99.90', fecha_instalacion: '2026-10-20' })
        const config = await obtenerConfiguracionEfectiva(creado.body().id)
        assert.equal(config.servicio.id, creado.body().id)
        assert.equal(config.plan.id, planId)
        assert.equal(config.plan.rate_limit, '5M/20M 0/0 0/0 0/0 8 5M/20M')
        assert.equal(config.plantilla_facturacion!.id, plantilla!.id)
        assert.deepEqual(config.excepciones, [])
        assert.equal(config.facturacion!.plantilla_id, plantilla!.id)
        assert.deepEqual(config.facturacion!.excepciones, [])
        assert.deepEqual(config.servicio.excepciones, {})
    })
})
