import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import {
    bloqueV6Unico,
    crearClienteFila,
    crearEmpresaFila,
    crearEscenarioRouter,
    crearPlanFila,
    crearServicioFila,
    crearZonaFila,
} from '#tests/core/fabricas'
import CrearCliente from '#core/actions/crear_cliente'
import EditarCliente from '#core/actions/editar_cliente'
import GenerarTokenHorus from '#core/actions/generar_token_horus'
import { EMAIL_USUARIO_HORUS, PERMISOS_HORUS, ROL_HORUS } from '#core/integraciones_horus'

/**
 * Integración Horus (contrato `.claude/integration/contratos/horus.md` 1.2.0, §5.1):
 * A1 resolver por lotes, A2 `cliente.actualizado`, A3 código de cliente estable y A5 usuario
 * técnico Horus con su token.
 */

const RESOLVER = '/api/v1/integraciones/horus/resolver'
const TOKENS = '/api/v1/integraciones/horus/tokens'

async function cuerpo(peticion: PromiseLike<any>, status = 200) {
    const respuesta = await estado(peticion, status)
    return respuesta.body()
}

/** Servicio creado por la API (IPv4, /64 y /56 reservados) en un router nuevo. */
async function servicioPorApi(
    client: any,
    token: string,
    datosCliente: Record<string, unknown> = {},
    empresaId?: number,
) {
    const { routerId, base, raiz } = await crearEscenarioRouter()
    const planId = await crearPlanFila()
    const nombre = unico('Ferretería')
    const cliente = await new CrearCliente().execute(
        { nombre, tipo: 'empresa', ...datosCliente },
        contextoPrueba(),
    )
    const servicio = await cuerpo(
        client
            .post('/api/v1/servicios')
            .bearerToken(token)
            .json({
                plantilla_facturacion_id: null,
                cliente_id: cliente.id,
                router_id: routerId,
                plan_id: planId,
                ...(empresaId ? { empresa_id: empresaId } : {}),
            }),
        201,
    )
    return { routerId, base, raiz, planId, cliente, servicio }
}

async function ultimoEventoCliente(clienteId: number) {
    return db
        .from('audit.outbox')
        .where('evento', 'cliente.actualizado')
        .whereRaw(`(payload->>'cliente_id')::bigint = ?`, [clienteId])
        .orderBy('id', 'desc')
        .first()
}

test.group('Horus · A3 código de cliente estable', () => {
    test('se deriva del id al crear (C-000455), es único, inmutable y sale en la API', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const creado = await cuerpo(
            client
                .post('/api/v1/clientes')
                .bearerToken(token)
                .json({ nombre: unico('Cliente'), codigo_externo: 'MW-77' }),
            201,
        )
        assert.equal(creado.codigo, `C-${String(creado.id).padStart(6, '0')}`)
        assert.equal(creado.codigo_externo, 'MW-77')

        // un alta por fila directa (importador, fixtures) también lo recibe; el que se mande se ignora
        const filaId = await crearClienteFila({ codigo: 'C-999999' })
        const fila = await db.from('core.clientes').where('id', filaId).firstOrFail()
        assert.equal(fila.codigo, `C-${String(filaId).padStart(6, '0')}`)

        // desde el millón no se trunca
        const { codigo: grande } = await db
            .rawQuery(`SELECT core.codigo_cliente(1234567) AS codigo`)
            .then((r) => r.rows[0])
        assert.equal(grande, 'C-1234567')

        // inmutable y único
        const cambio = await db
            .from('core.clientes')
            .where('id', creado.id)
            .update({ codigo: 'C-999998' })
            .then(
                () => null,
                (error: Error) => error,
            )
        assert.match(cambio?.message ?? '', /inmutable/)
        const unica = await db
            .from('pg_constraint')
            .where('conname', 'clientes_codigo_unico')
            .where('contype', 'u')
            .first()
        assert.exists(unica)

        // editar el cliente no lo cambia; la búsqueda lo encuentra por código y por código externo
        const editado = await cuerpo(
            client
                .put(`/api/v1/clientes/${creado.id}`)
                .bearerToken(token)
                .json({ version: creado.version, telefono: '5555-1234' }),
        )
        assert.equal(editado.codigo, creado.codigo)
        const porCodigo = await cuerpo(
            client.get('/api/v1/clientes').bearerToken(token).qs({ q: creado.codigo.toLowerCase() }),
        )
        assert.deepEqual(
            porCodigo.data.map((c: { id: number }) => c.id),
            [creado.id],
        )
        const porExterno = await cuerpo(client.get('/api/v1/clientes').bearerToken(token).qs({ q: 'mw-77' }))
        assert.include(
            porExterno.data.map((c: { id: number }) => c.id),
            creado.id,
        )
    })

    test('migración: todos los clientes tienen el código derivado de su id', async ({ assert }) => {
        await crearClienteFila()
        const { distintos } = await db
            .rawQuery(
                `SELECT count(*)::int AS distintos FROM core.clientes WHERE codigo IS DISTINCT FROM core.codigo_cliente(id)`,
            )
            .then((r) => r.rows[0])
        assert.equal(distintos, 0)
    })
})

test.group('Horus · A2 evento cliente.actualizado', () => {
    test('se emite por outbox al cambiar nombre o tipo, no por el canal preferido', async ({ assert }) => {
        const ctx = contextoPrueba()
        const cliente = await new CrearCliente().execute({ nombre: unico('Cliente') }, ctx)
        assert.isNull(await ultimoEventoCliente(cliente.id))

        // el canal preferido no lo muestra nadie fuera de Argos (teléfono y dirección sí: Iris 0.3.1;
        // el correo también desde Iris 0.5.0, pedido A11)
        const correo = await new EditarCliente().execute(
            { id: cliente.id, version: cliente.version, canal_preferido: 'whatsapp' },
            ctx,
        )
        assert.isNull(await ultimoEventoCliente(cliente.id))

        const nombre = unico('Nuevo nombre')
        const renombrado = await new EditarCliente().execute(
            { id: cliente.id, version: correo.version, nombre, tipo: 'empresa' },
            ctx,
        )
        const evento = await ultimoEventoCliente(cliente.id)
        assert.deepEqual(evento.payload, { cliente_id: cliente.id, campos: ['nombre', 'tipo'] })
        assert.equal(evento.request_id, ctx.requestId)
        assert.isNull(evento.publicado_en)

        // mismo nombre: sin cambio, sin evento nuevo
        await new EditarCliente().execute({ id: cliente.id, version: renombrado.version, nombre }, ctx)
        const ultimo = await ultimoEventoCliente(cliente.id)
        assert.equal(ultimo.id, evento.id)
    })
})

test.group('Horus · A5 usuario técnico y token', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('admin genera el token: crea usuario y rol una vez, alcance mínimo, se usa y se revoca', async ({
        client,
        assert,
    }) => {
        const admin = await usuarioConRoles(['admin'])
        const primero = await cuerpo(
            client.post(TOKENS).bearerToken(admin.token).json({ nombre: 'Horus lab' }),
            201,
        )
        assert.match(primero.token, /^atk_/)
        assert.deepEqual(primero.datos.alcances, { permisos: [...PERMISOS_HORUS] })

        const usuario = await db.from('core.usuarios').where('email', EMAIL_USUARIO_HORUS).firstOrFail()
        assert.equal(primero.usuario_id, usuario.id)
        assert.isTrue(usuario.alcance_global)
        const roles = await db
            .from('core.usuarios_roles as ur')
            .join('core.roles as r', 'r.id', 'ur.role_id')
            .where('ur.usuario_id', usuario.id)
            .select('r.nombre')
        assert.deepEqual(
            roles.map((r) => r.nombre),
            [ROL_HORUS],
        )

        // el segundo reutiliza el usuario y no revoca el primero
        const segundo = await cuerpo(client.post(TOKENS).bearerToken(admin.token).json({}), 201)
        assert.equal(segundo.usuario_id, usuario.id)
        assert.equal(segundo.datos.nombre, 'Horus Flow')
        const lista = await cuerpo(client.get(TOKENS).bearerToken(admin.token))
        const ids = lista.map((t: { id: number }) => t.id)
        assert.includeMembers(ids, [primero.datos.id, segundo.datos.id])
        assert.notProperty(lista[0], 'token')
        assert.notProperty(lista[0], 'hash')

        // se usa: resolver sí; lo demás no (alcance mínimo)
        await estado(
            client
                .post(RESOLVER)
                .bearerToken(primero.token)
                .json({ ips: ['203.0.113.77'] }),
            200,
        )
        await estado(client.get('/api/v1/clientes').bearerToken(primero.token), 200)
        await estado(client.post('/api/v1/clientes').bearerToken(primero.token).json({ nombre: 'x y' }), 403)
        await estado(client.get('/api/v1/routers').bearerToken(primero.token), 403)
        await estado(client.get(TOKENS).bearerToken(primero.token), 403)

        // auditoría con actor
        const accion = await db
            .from('audit.acciones')
            .where('accion', 'horus.generar_token')
            .where('entidad_id', primero.datos.id)
            .firstOrFail()
        assert.equal(accion.actor_id, admin.usuario.id)
        assert.equal(accion.resultado, 'ok')

        // se revoca: 401 con ese token; el otro sigue
        const revocado = await cuerpo(
            client.post(`${TOKENS}/${primero.datos.id}/revocar`).bearerToken(admin.token),
        )
        assert.isNotNull(revocado.revocado_en)
        await estado(
            client
                .post(RESOLVER)
                .bearerToken(primero.token)
                .json({ ips: ['203.0.113.77'] }),
            401,
        )
        await estado(
            client
                .post(RESOLVER)
                .bearerToken(segundo.token)
                .json({ ips: ['203.0.113.77'] }),
            200,
        )
        await cuerpo(client.post(`${TOKENS}/${segundo.datos.id}/revocar`).bearerToken(admin.token))
    })

    test('permisos: cajero no genera ni revoca; un token ajeno a Horus no se revoca por aquí (404)', async ({
        client,
    }) => {
        const cajero = await usuarioConRoles(['cajero'])
        await estado(client.post(TOKENS).bearerToken(cajero.token).json({}), 403)
        await estado(client.get(TOKENS).bearerToken(cajero.token), 403)

        const admin = await usuarioConRoles(['admin'])
        const ajeno = await cuerpo(
            client
                .post('/api/v1/tokens')
                .bearerToken(admin.token)
                .json({ usuario_id: admin.usuario.id, nombre: 'otro' }),
            201,
        )
        await estado(client.post(`${TOKENS}/${ajeno.datos.id}/revocar`).bearerToken(admin.token), 404)
        await estado(client.post(`${TOKENS}/${ajeno.datos.id}/revocar`).bearerToken(cajero.token), 403)
    })

    test('consola: node ace integraciones:horus-token usa la misma acción', async ({ assert }) => {
        const salida = await new GenerarTokenHorus().execute({ routers: [1] }, contextoPrueba())
        assert.deepEqual(salida.datos.alcances, { permisos: [...PERMISOS_HORUS], routers: [1] })
        await db.from('core.tokens_api').where('id', salida.datos.id).update({ revocado_en: new Date() })
    })
})

test.group('Horus · A1 POST /integraciones/horus/resolver', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    async function tokenHorus(routers?: number[], zonas?: number[]) {
        const salida = await new GenerarTokenHorus().execute({ routers, zonas }, contextoPrueba())
        return salida
    }

    test('lote mixto IPv4, IPv6 enlace y delegado, no encontradas; orden y forma de §2.1', async ({
        client,
        assert,
    }) => {
        const admin = await usuarioConRoles(['admin'])
        const s = await servicioPorApi(client, admin.token)
        const { token } = await tokenHorus()

        const ips = [
            `${s.base}.2`,
            '203.0.113.250',
            `${s.raiz}10:ab::1`,
            `${s.raiz}00::abcd`,
            '2001:db8:ffff::1',
        ]
        const { resultados } = await cuerpo(client.post(RESOLVER).bearerToken(token).json({ ips }))
        assert.lengthOf(resultados, 5)
        assert.deepEqual(
            resultados.map((r: { ip: string }) => r.ip),
            ips,
        )

        const empresa = await db.from('core.empresas').where('id', 1).firstOrFail()
        const plan = await db.from('network.planes').where('id', s.planId).firstOrFail()
        const desde = resultados[0].desde
        assert.match(desde, /^\d{4}-\d{2}-\d{2}T.*Z$/)
        assert.deepEqual(resultados[0], {
            ip: `${s.base}.2`,
            servicio_id: s.servicio.id,
            cliente_id: s.cliente.id,
            prefijo: `${s.base}.2/32`,
            cliente: { nombre: s.cliente.nombre, codigo: s.cliente.codigo, tipo: 'empresa' },
            servicio: {
                user_ppp: s.servicio.user_ppp,
                plan: plan.nombre,
                estado: 'activo',
                router_id: s.routerId,
            },
            empresa: { id: 1, nombre: empresa.nombre_comercial, nit: empresa.nit },
            desde,
        })
        assert.deepEqual(resultados[1], { ip: '203.0.113.250', error: 'no_encontrada' })
        assert.equal(resultados[2].prefijo, `${s.raiz}10::/56`)
        assert.equal(resultados[2].servicio_id, s.servicio.id)
        assert.equal(resultados[3].prefijo, `${s.raiz}00::/64`)
        assert.deepEqual(resultados[4], { ip: '2001:db8:ffff::1', error: 'no_encontrada' })

        // sesión activa en un /56 dentro de otro asignado: gana el prefijo más largo y `desde` es la sesión
        const otro = await crearServicioFila({ cliente_id: await crearClienteFila() })
        const fijo = await crearServicioFila({ cliente_id: s.cliente.id })
        const raizSesion = bloqueV6Unico().replace('00::/40', '')
        await db.table('network.ipv6_asignaciones').insert({
            servicio_id: fijo,
            prefijo: `${raizSesion}30::/48`,
            tipo: 'delegacion',
        })
        const inicio = new Date('2026-10-17T08:12:00Z')
        await db.table('network.sesiones').insert({
            nas_ip: '192.0.2.200',
            acct_session_id: unico('acct'),
            user_ppp: unico('ppp'),
            servicio_id: otro,
            prefijo_delegado_v6: `${raizSesion}30:1200::/56`,
            inicio,
        })
        const v6 = await cuerpo(
            client
                .post(RESOLVER)
                .bearerToken(token)
                .json({ ips: [`${raizSesion}30:1234::1`, `${raizSesion}30:ff00::1`] }),
        )
        assert.equal(v6.resultados[0].servicio_id, otro)
        assert.equal(v6.resultados[0].desde, inicio.toISOString())
        assert.equal(v6.resultados[1].servicio_id, fijo)
    })

    test('una fila de auditoría por llamada, con el token como actor y los clientes leídos', async ({
        client,
        assert,
    }) => {
        const admin = await usuarioConRoles(['admin'])
        const s = await servicioPorApi(client, admin.token)
        const horus = await tokenHorus()
        const respuesta = await estado(
            client
                .post(RESOLVER)
                .bearerToken(horus.token)
                .json({ ips: [`${s.base}.2`, `${s.raiz}10::1`, '198.51.100.9'] }),
            200,
        )
        const requestId = respuesta.header('x-request-id') as string
        const filas = await db.from('audit.acciones').where('request_id', requestId)
        assert.lengthOf(filas, 1)
        const fila = filas[0]
        assert.equal(fila.accion, 'ip.resolver')
        assert.equal(fila.actor_tipo, 'token')
        assert.equal(fila.actor_id, horus.usuario_id)
        assert.equal(fila.resultado, 'ok')
        assert.deepEqual(fila.entrada.auditoria, {
            cantidad: 3,
            encontradas: 2,
            servicios: [s.servicio.id],
            clientes: [s.cliente.id],
        })
    })

    test('validación: 0 o 501 IPs → 422, una IP inválida → 422, 500 IPs en una llamada', async ({
        client,
        assert,
    }) => {
        const { token } = await tokenHorus()
        await estado(client.post(RESOLVER).bearerToken(token).json({ ips: [] }), 422)
        const muchas = Array.from({ length: 501 }, (_, i) => `198.18.${Math.floor(i / 256)}.${i % 256}`)
        await estado(client.post(RESOLVER).bearerToken(token).json({ ips: muchas }), 422)
        await estado(
            client
                .post(RESOLVER)
                .bearerToken(token)
                .json({ ips: ['10.0.0.1', 'no-es-ip'] }),
            422,
        )
        await estado(client.post(RESOLVER).bearerToken(token).json({}), 422)

        const inicio = performance.now()
        const { resultados } = await cuerpo(
            client
                .post(RESOLVER)
                .bearerToken(token)
                .json({ ips: muchas.slice(0, 500) }),
        )
        assert.lengthOf(resultados, 500)
        assert.isBelow(performance.now() - inicio, 5000)
    })

    test('sin ip.resolver → 403 (cajero; token sin ese permiso); sin token → 401', async ({ client }) => {
        const cajero = await usuarioConRoles(['cajero'])
        await estado(
            client
                .post(RESOLVER)
                .bearerToken(cajero.token)
                .json({ ips: ['10.0.0.1'] }),
            403,
        )
        const admin = await usuarioConRoles(['admin'])
        const recortado = await cuerpo(
            client
                .post('/api/v1/tokens')
                .bearerToken(admin.token)
                .json({
                    usuario_id: admin.usuario.id,
                    nombre: 'solo clientes',
                    alcances: { permisos: ['clientes.ver'] },
                }),
            201,
        )
        await estado(
            client
                .post(RESOLVER)
                .bearerToken(recortado.token)
                .json({ ips: ['10.0.0.1'] }),
            403,
        )
        await estado(client.post(RESOLVER).json({ ips: ['10.0.0.1'] }), 401)
    })

    test('alcance del token por router y por zona: lo de fuera responde no_encontrada', async ({
        client,
        assert,
    }) => {
        const admin = await usuarioConRoles(['admin'])
        const zona = await crearZonaFila()
        const a = await servicioPorApi(client, admin.token, { zona_id: zona })
        const b = await servicioPorApi(client, admin.token)
        const ips = [`${a.base}.2`, `${b.base}.2`]

        const porRouter = await tokenHorus([a.routerId])
        const r1 = await cuerpo(client.post(RESOLVER).bearerToken(porRouter.token).json({ ips }))
        assert.equal(r1.resultados[0].servicio_id, a.servicio.id)
        assert.deepEqual(r1.resultados[1], { ip: ips[1], error: 'no_encontrada' })

        const porZona = await tokenHorus(undefined, [zona])
        const r2 = await cuerpo(client.post(RESOLVER).bearerToken(porZona.token).json({ ips }))
        assert.equal(r2.resultados[0].servicio_id, a.servicio.id)
        assert.deepEqual(r2.resultados[1], { ip: ips[1], error: 'no_encontrada' })

        // soporte con rol acotado a un router (sesión de panel) sigue la misma regla
        const soporte = await usuarioConRoles([])
        const rolSoporte = await db.from('core.roles').where('nombre', 'soporte').firstOrFail()
        await db.table('core.usuarios_roles').insert({
            usuario_id: soporte.usuario.id,
            role_id: rolSoporte.id,
            alcance_tipo: 'router',
            alcance_id: b.routerId,
        })
        const r3 = await cuerpo(client.post(RESOLVER).bearerToken(soporte.token).json({ ips }))
        assert.equal(r3.resultados[0].error, 'no_encontrada')
        assert.equal(r3.resultados[1].servicio_id, b.servicio.id)
    })

    test('multiempresa: cada resultado trae su empresa; un Horus acotado no ve otra empresa', async ({
        client,
        assert,
    }) => {
        const admin = await usuarioConRoles(['admin'])
        const sur = await crearEmpresaFila()
        const a = await servicioPorApi(client, admin.token, {}, 1)
        const b = await servicioPorApi(client, admin.token, {}, sur)
        const ips = [`${a.base}.2`, `${b.base}.2`]

        const horus = await tokenHorus()
        const todas = await cuerpo(client.post(RESOLVER).bearerToken(horus.token).json({ ips }))
        assert.equal(todas.resultados[0].empresa.id, 1)
        const empresaSur = await db.from('core.empresas').where('id', sur).firstOrFail()
        assert.deepEqual(todas.resultados[1].empresa, {
            id: sur,
            nombre: empresaSur.nombre_comercial,
            nit: empresaSur.nit,
        })

        // el usuario Horus pasa a operar solo la empresa 1
        await db.from('core.usuarios').where('id', horus.usuario_id).update({ alcance_global: false })
        await db.table('core.usuarios_empresas').insert({ usuario_id: horus.usuario_id, empresa_id: 1 })
        try {
            const acotado = await cuerpo(client.post(RESOLVER).bearerToken(horus.token).json({ ips }))
            assert.equal(acotado.resultados[0].servicio_id, a.servicio.id)
            assert.deepEqual(acotado.resultados[1], { ip: ips[1], error: 'no_encontrada' })
        } finally {
            await db.from('core.usuarios_empresas').where('usuario_id', horus.usuario_id).delete()
            await db.from('core.usuarios').where('id', horus.usuario_id).update({ alcance_global: true })
        }
    })
})
