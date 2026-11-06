import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import {
    crearClienteFila,
    crearEscenarioRouter,
    crearPlanFila,
    crearRouterFila,
    ipUnica,
} from '#tests/core/fabricas'
import { limpiarClavesAaa } from '#tests/core/ayudas_aaa'

/**
 * Tipo de conexión por router (decisión del PM, 5 nov; `contratos/tipo-conexion-router.md`): el alta
 * toma el del router, mover de router adopta el del destino y el router se cambia (o se unifica) con
 * `routers.cambiar_tipo_conexion`, servicio por servicio.
 */

const MAC = 'AA:BB:CC:00:77:01'

async function leer(peticion: PromiseLike<any>, status: number) {
    const respuesta = await estado(peticion, status)
    return respuesta.body()
}

function tipoProblema(cuerpo: any): string {
    return String(cuerpo.type).split(':').pop()!
}

async function eventos(requestId: string) {
    const filas = await db.from('audit.outbox').where('request_id', requestId).orderBy('id')
    return filas.map((f) => ({ evento: f.evento as string, payload: f.payload }))
}

async function evento(requestId: string, nombre: string) {
    const todos = await eventos(requestId)
    return todos.find((e) => e.evento === nombre)
}

function crear(client: any, token: string, cuerpo: Record<string, unknown>) {
    return client
        .post('/api/v1/servicios')
        .bearerToken(token)
        .json({ plantilla_facturacion_id: null, ...cuerpo })
}

async function escenario(tipo: string) {
    const esc = await crearEscenarioRouter({ tipo_conexion: tipo })
    const planId = await crearPlanFila()
    const clienteId = await crearClienteFila({ nombre: 'Rosa Tipo' })
    return { ...esc, planId, clienteId }
}

test.group('Tipo de conexión por router · router', (group) => {
    let admin: string
    group.setup(async () => {
        await limpiarClavesAaa()
        ;({ token: admin } = await usuarioConRoles(['admin']))
    })

    test('alta con pppoe por defecto o el tipo pedido; sale en GET', async ({ client, assert }) => {
        const r = await leer(
            client
                .post('/api/v1/routers')
                .bearerToken(admin)
                .json({
                    nombre: unico('R'),
                    host: `${unico('tipo')}.prueba.local`,
                    nas_ip: ipUnica(),
                }),
            201,
        )
        assert.equal(r.tipo_conexion, 'pppoe')
        const d = await leer(
            client
                .post('/api/v1/routers')
                .bearerToken(admin)
                .json({
                    nombre: unico('R'),
                    host: `${unico('tipo')}.prueba.local`,
                    modo_seguridad: 'api',
                    tipo_conexion: 'dhcp_fija',
                }),
            201,
        )
        assert.equal(d.tipo_conexion, 'dhcp_fija')
        const visto = await leer(client.get(`/api/v1/routers/${d.id}`).bearerToken(admin), 200)
        assert.equal(visto.tipo_conexion, 'dhcp_fija')
    })

    test('PUT cambia el tipo sin servicios (evento edicion); con servicios 422 tipo_conexion_con_servicios', async ({
        client,
        assert,
    }) => {
        const { routerId, planId, clienteId } = await escenario('pppoe')
        const router = await leer(client.get(`/api/v1/routers/${routerId}`).bearerToken(admin), 200)
        const requestId = unico('req')
        const editado = await leer(
            client
                .put(`/api/v1/routers/${routerId}`)
                .bearerToken(admin)
                .header('X-Request-Id', requestId)
                .json({ version: router.version, tipo_conexion: 'ip_estatica' }),
            200,
        )
        assert.equal(editado.tipo_conexion, 'ip_estatica')
        const ev = await evento(requestId, 'router.tipo_conexion_cambiado')
        assert.containSubset(ev?.payload, {
            router_id: routerId,
            de: 'pppoe',
            a: 'ip_estatica',
            servicios: [],
            motivo: 'edicion',
        })

        const s = await leer(
            crear(client, admin, { cliente_id: clienteId, router_id: routerId, plan_id: planId }),
            201,
        )
        assert.equal(s.tipo_conexion, 'ip_estatica')
        const r = await leer(
            client
                .put(`/api/v1/routers/${routerId}`)
                .bearerToken(admin)
                .json({ version: editado.version, tipo_conexion: 'pppoe' }),
            422,
        )
        assert.equal(tipoProblema(r), 'tipo_conexion_con_servicios')
        assert.equal(r.errors[0].field, `servicios.${s.id}`)
    })
})

test.group('Tipo de conexión por router · servicios', (group) => {
    let token: string
    group.setup(async () => {
        await limpiarClavesAaa()
        ;({ token } = await usuarioConRoles(['soporte']))
    })

    test('el alta toma el tipo del router; un tipo distinto es 422 tipo_conexion_del_router', async ({
        client,
        assert,
    }) => {
        const { routerId, planId, clienteId } = await escenario('ip_estatica')
        const s = await leer(
            crear(client, token, { cliente_id: clienteId, router_id: routerId, plan_id: planId }),
            201,
        )
        assert.containSubset(s, { tipo_conexion: 'ip_estatica', user_ppp: null })
        assert.isString(s.ipv4)

        const igual = await leer(
            crear(client, token, {
                cliente_id: clienteId,
                router_id: routerId,
                plan_id: planId,
                tipo_conexion: 'ip_estatica',
            }),
            201,
        )
        assert.equal(igual.tipo_conexion, 'ip_estatica')

        const distinto = await leer(
            crear(client, token, {
                cliente_id: clienteId,
                router_id: routerId,
                plan_id: planId,
                tipo_conexion: 'pppoe',
            }),
            422,
        )
        assert.equal(tipoProblema(distinto), 'tipo_conexion_del_router')
        assert.containSubset(distinto.errors[0], { field: 'tipo_conexion', rule: 'tipo_conexion_del_router' })
        assert.match(distinto.detail, /IP estática/)

        // PPPoE por defecto: credenciales generadas
        const ppp = await escenario('pppoe')
        const p = await leer(
            crear(client, token, { cliente_id: ppp.clienteId, router_id: ppp.routerId, plan_id: ppp.planId }),
            201,
        )
        assert.equal(p.tipo_conexion, 'pppoe')
        assert.isString(p.user_ppp)
    })

    test('mover de router adopta el tipo del destino: dhcp_fija exige mac; a pppoe genera credenciales', async ({
        client,
        assert,
    }) => {
        const origen = await escenario('pppoe')
        const destino = await crearEscenarioRouter({ tipo_conexion: 'dhcp_fija' })
        const s = await leer(
            crear(client, token, {
                cliente_id: origen.clienteId,
                router_id: origen.routerId,
                plan_id: origen.planId,
            }),
            201,
        )
        // sin MAC: 422 en mac
        const sinMac = await leer(
            client
                .put(`/api/v1/servicios/${s.id}`)
                .bearerToken(token)
                .json({ version: s.version, router_id: destino.routerId }),
            422,
        )
        assert.include(
            sinMac.errors.map((e: { field: string }) => e.field),
            'mac',
        )
        // pedir otro tipo que el del destino: 422
        const otro = await leer(
            client
                .put(`/api/v1/servicios/${s.id}`)
                .bearerToken(token)
                .json({ version: s.version, router_id: destino.routerId, tipo_conexion: 'pppoe', mac: MAC }),
            422,
        )
        assert.equal(tipoProblema(otro), 'tipo_conexion_del_router')

        const requestId = unico('req')
        const movido = await leer(
            client
                .put(`/api/v1/servicios/${s.id}`)
                .bearerToken(token)
                .header('X-Request-Id', requestId)
                .json({ version: s.version, router_id: destino.routerId, mac: MAC }),
            200,
        )
        assert.containSubset(movido, {
            router_id: destino.routerId,
            tipo_conexion: 'dhcp_fija',
            user_ppp: null,
        })
        const config = await evento(requestId, 'servicio.config_cambiada')
        assert.includeMembers(config!.payload.campos, ['router', 'tipo_conexion'])

        // de vuelta a un router pppoe: credenciales nuevas, sin pedirlas
        const vuelta = await leer(
            client
                .put(`/api/v1/servicios/${s.id}`)
                .bearerToken(token)
                .json({ version: movido.version, router_id: origen.routerId }),
            200,
        )
        assert.equal(vuelta.tipo_conexion, 'pppoe')
        assert.isString(vuelta.user_ppp)
    })

    test('un servicio que difiere del router se queda igual; solo puede pasar al tipo del router', async ({
        client,
        assert,
    }) => {
        const { routerId, planId, clienteId } = await escenario('ip_estatica')
        const s = await leer(
            crear(client, token, { cliente_id: clienteId, router_id: routerId, plan_id: planId }),
            201,
        )
        // dato anterior a la regla: el router es pppoe y el servicio ip_estatica
        await db.from('network.routers').where('id', routerId).update({ tipo_conexion: 'pppoe' })

        const editado = await leer(
            client
                .put(`/api/v1/servicios/${s.id}`)
                .bearerToken(token)
                .json({ version: s.version, direccion: 'Zona 1', tipo_conexion: 'ip_estatica' }),
            200,
        )
        assert.equal(editado.tipo_conexion, 'ip_estatica')
        const otro = await leer(
            client
                .put(`/api/v1/servicios/${s.id}`)
                .bearerToken(token)
                .json({ version: editado.version, tipo_conexion: 'dhcp_fija', mac: MAC }),
            422,
        )
        assert.equal(tipoProblema(otro), 'tipo_conexion_del_router')
        const unificado = await leer(
            client
                .put(`/api/v1/servicios/${s.id}`)
                .bearerToken(token)
                .json({ version: editado.version, tipo_conexion: 'pppoe' }),
            200,
        )
        assert.equal(unificado.tipo_conexion, 'pppoe')
    })
})

test.group('Tipo de conexión por router · cambiar y unificar', (group) => {
    let admin: string
    group.setup(async () => {
        await limpiarClavesAaa()
        ;({ token: admin } = await usuarioConRoles(['admin']))
    })

    test('vista previa: qué cambia y qué falta; incompletos 422; aplicar servicio por servicio', async ({
        client,
        assert,
    }) => {
        const { routerId, planId, clienteId } = await escenario('pppoe')
        const a = await leer(
            crear(client, admin, { cliente_id: clienteId, router_id: routerId, plan_id: planId }),
            201,
        )
        const b = await leer(
            crear(client, admin, { cliente_id: clienteId, router_id: routerId, plan_id: planId, mac: MAC }),
            201,
        )

        const vista = await leer(
            client
                .get(`/api/v1/routers/${routerId}/vista-previa-tipo-conexion`)
                .qs({ tipo: 'dhcp_fija' })
                .bearerToken(admin),
            200,
        )
        assert.containSubset(vista, {
            router_id: routerId,
            tipo_actual: 'pppoe',
            tipo: 'dhcp_fija',
            aplicable: false,
            resumen: { servicios: 2, cambian: 2, con_faltantes: 1, difieren_del_router: 0 },
        })
        const va = vista.servicios.find((x: any) => x.servicio_id === a.id)
        const vb = vista.servicios.find((x: any) => x.servicio_id === b.id)
        assert.deepEqual(va.faltan, ['mac'])
        assert.deepEqual(vb.faltan, [])
        assert.include(vb.se_completa, 'ipv6_modo')

        const incompleto = await leer(
            client
                .post(`/api/v1/routers/${routerId}/cambiar-tipo-conexion`)
                .bearerToken(admin)
                .json({ version: vista.router_version, tipo_conexion: 'dhcp_fija' }),
            422,
        )
        assert.equal(tipoProblema(incompleto), 'tipo_conexion_servicios_incompletos')
        assert.equal(incompleto.errors[0].field, `servicios.${a.id}.mac`)
        const sigue = await db.from('network.routers').where('id', routerId).first()
        assert.equal(sigue.tipo_conexion, 'pppoe')

        // solo admin
        const { token: tecnico } = await usuarioConRoles(['tecnico'])
        await estado(
            client
                .post(`/api/v1/routers/${routerId}/cambiar-tipo-conexion`)
                .bearerToken(tecnico)
                .json({ version: vista.router_version, tipo_conexion: 'ip_estatica' }),
            403,
        )
        // versión vieja: 409
        await estado(
            client
                .post(`/api/v1/routers/${routerId}/cambiar-tipo-conexion`)
                .bearerToken(admin)
                .json({ version: vista.router_version + 5, tipo_conexion: 'ip_estatica' }),
            409,
        )

        const ip = await leer(
            client
                .get(`/api/v1/routers/${routerId}/vista-previa-tipo-conexion`)
                .qs({ tipo: 'ip_estatica' })
                .bearerToken(admin),
            200,
        )
        assert.isTrue(ip.aplicable)
        const requestId = unico('req')
        const r = await leer(
            client
                .post(`/api/v1/routers/${routerId}/cambiar-tipo-conexion`)
                .bearerToken(admin)
                .header('X-Request-Id', requestId)
                .json({
                    version: ip.router_version,
                    tipo_conexion: 'ip_estatica',
                    motivo: 'Migración a WISP',
                }),
            200,
        )
        assert.containSubset(r, { de: 'pppoe', a: 'ip_estatica', router: { tipo_conexion: 'ip_estatica' } })
        assert.sameMembers(r.servicios, [a.id, b.id])

        const servicios = await db.from('core.servicios').whereIn('id', [a.id, b.id])
        for (const s of servicios) {
            assert.equal(s.tipo_conexion, 'ip_estatica')
            assert.isNull(s.user_ppp)
            assert.isNull(s.pass_ppp)
        }
        const ev = await eventos(requestId)
        const config = ev.filter((e) => e.evento === 'servicio.config_cambiada')
        assert.sameMembers(
            config.map((e) => e.payload.servicio_id),
            [a.id, b.id],
        )
        for (const e of config) assert.include(e.payload.campos, 'tipo_conexion')
        assert.containSubset(ev.find((e) => e.evento === 'router.tipo_conexion_cambiado')?.payload, {
            router_id: routerId,
            de: 'pppoe',
            a: 'ip_estatica',
            motivo: 'cambio',
        })
        // auditoría: la acción del router y una edición por servicio, con su diff
        const acciones = await db
            .from('audit.acciones')
            .where('request_id', requestId)
            .select('accion', 'entidad_id')
        assert.includeDeepMembers(
            acciones.map((x) => ({ accion: x.accion, entidad_id: Number(x.entidad_id) })),
            [
                { accion: 'routers.cambiar_tipo_conexion', entidad_id: routerId },
                { accion: 'servicios.editar', entidad_id: a.id },
                { accion: 'servicios.editar', entidad_id: b.id },
            ],
        )
        const diff = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'servicio', entidad_id: a.id, campo: 'tipo_conexion' })
            .orderBy('id', 'desc')
            .first()
        assert.deepEqual([diff.antes, diff.despues], ['pppoe', 'ip_estatica'])
    })

    test('sin tipo la vista previa muestra los que difieren; unificar los pasa al del router', async ({
        client,
        assert,
    }) => {
        const { routerId, planId, clienteId } = await escenario('ip_estatica')
        const s = await leer(
            crear(client, admin, { cliente_id: clienteId, router_id: routerId, plan_id: planId }),
            201,
        )
        await db.from('network.routers').where('id', routerId).update({ tipo_conexion: 'pppoe' })

        const vista = await leer(
            client.get(`/api/v1/routers/${routerId}/vista-previa-tipo-conexion`).bearerToken(admin),
            200,
        )
        assert.containSubset(vista, { tipo_actual: 'pppoe', tipo: 'pppoe', aplicable: true })
        assert.containSubset(vista.servicios[0], {
            servicio_id: s.id,
            tipo_conexion: 'ip_estatica',
            difiere_del_router: true,
            cambia: true,
            faltan: [],
        })
        assert.include(vista.servicios[0].se_completa, 'credenciales')

        const requestId = unico('req')
        const r = await leer(
            client
                .post(`/api/v1/routers/${routerId}/cambiar-tipo-conexion`)
                .bearerToken(admin)
                .header('X-Request-Id', requestId)
                .json({ version: vista.router_version, tipo_conexion: 'pppoe' }),
            200,
        )
        assert.deepEqual(r.servicios, [s.id])
        const fila = await db.from('core.servicios').where('id', s.id).first()
        assert.equal(fila.tipo_conexion, 'pppoe')
        assert.isString(fila.user_ppp)
        const unificado = await evento(requestId, 'router.tipo_conexion_cambiado')
        assert.containSubset(unificado?.payload, {
            de: 'pppoe',
            a: 'pppoe',
            servicios: [s.id],
            motivo: 'unificar',
        })
    })

    test('PPPoE en un router api sin credenciales de la API: bloqueo y 422 pppoe_local_requiere_api', async ({
        client,
        assert,
    }) => {
        const routerId = await crearRouterFila({
            modo_seguridad: 'api',
            nas_ip: null,
            tipo_conexion: 'ip_estatica',
        })
        const vista = await leer(
            client
                .get(`/api/v1/routers/${routerId}/vista-previa-tipo-conexion`)
                .qs({ tipo: 'pppoe' })
                .bearerToken(admin),
            200,
        )
        assert.isFalse(vista.aplicable)
        assert.equal(vista.bloqueos[0].codigo, 'pppoe_local_requiere_api')
        const r = await leer(
            client
                .post(`/api/v1/routers/${routerId}/cambiar-tipo-conexion`)
                .bearerToken(admin)
                .json({ version: vista.router_version, tipo_conexion: 'pppoe' }),
            422,
        )
        assert.equal(tipoProblema(r), 'pppoe_local_requiere_api')
    })
})
