import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import {
    crearClienteFila,
    crearEmpresaFila,
    crearEscenarioRouter,
    crearPlanFila,
    crearServicioFila,
} from '#tests/core/fabricas'

/**
 * Multiempresa, paso 4: empresa activa (`X-Empresa-Id`), 403 `empresa_no_permitida`, 422
 * `empresa_requerida`, listas filtradas por la empresa activa, consolidado con alcance global,
 * `audit.acciones.empresa_id` y CORS.
 */

/** Usuario con esos roles acotado a esas empresas (sin alcance global). */
async function usuarioEnEmpresas(roles: string[], empresas: number[]) {
    const datos = await usuarioConRoles(roles)
    await db.from('core.usuarios').where('id', datos.usuario.id).update({ alcance_global: false })
    await db
        .table('core.usuarios_empresas')
        .multiInsert(empresas.map((empresaId) => ({ usuario_id: datos.usuario.id, empresa_id: empresaId })))
    return datos
}

/** Dos empresas con un cliente y un servicio cada una, más un cliente sin servicios. */
async function dosEmpresas() {
    const norte = await crearEmpresaFila()
    const sur = await crearEmpresaFila()
    const { routerId } = await crearEscenarioRouter()
    const { routerId: routerNorte } = await crearEscenarioRouter()
    await db.from('network.routers').where('id', routerNorte).update({ empresa_sugerida_id: norte })
    const planId = await crearPlanFila()
    const clienteNorte = await crearClienteFila()
    const clienteSur = await crearClienteFila()
    const clienteNuevo = await crearClienteFila()
    const servicioNorte = await crearServicioFila({
        cliente_id: clienteNorte,
        router_id: routerId,
        plan_id: planId,
        empresa_id: norte,
    })
    const servicioSur = await crearServicioFila({
        cliente_id: clienteSur,
        router_id: routerId,
        plan_id: planId,
        empresa_id: sur,
    })
    return {
        norte,
        sur,
        routerId,
        routerNorte,
        planId,
        clienteNorte,
        clienteSur,
        clienteNuevo,
        servicioNorte,
        servicioSur,
    }
}

const ids = (cuerpo: { data: Array<{ id: number }> }) => cuerpo.data.map((fila) => fila.id)

test.group('Multiempresa: empresa activa', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('X-Empresa-Id sin acceso: 403 empresa_no_permitida; inválida 400; con acceso queda activa', async ({
        client,
        assert,
    }) => {
        const e = await dosEmpresas()
        const { token } = await usuarioEnEmpresas(['soporte'], [e.norte])

        const ajena = await estado(
            client.get('/api/v1/servicios').bearerToken(token).header('X-Empresa-Id', String(e.sur)),
            403,
        )
        assert.include(ajena.body().type, 'empresa_no_permitida')
        await estado(client.get('/api/v1/me').bearerToken(token).header('X-Empresa-Id', 'abc'), 400)

        // desactivada: tampoco se puede elegir
        await db.from('core.empresas').where('id', e.norte).update({ activa: false })
        await estado(client.get('/api/v1/me').bearerToken(token).header('X-Empresa-Id', String(e.norte)), 403)
        await db.from('core.empresas').where('id', e.norte).update({ activa: true })

        // una sola empresa: queda activa sin cabecera
        const me = await estado(client.get('/api/v1/me').bearerToken(token), 200)
        assert.equal(me.body().empresa_activa_id, e.norte)
        assert.deepEqual(
            me.body().empresas.map((x: { id: number }) => x.id),
            [e.norte],
        )

        // admin global con cabecera: activa la elegida
        const admin = await usuarioConRoles(['admin'])
        const meAdmin = await estado(
            client.get('/api/v1/me').bearerToken(admin.token).header('X-Empresa-Id', String(e.sur)),
            200,
        )
        assert.equal(meAdmin.body().empresa_activa_id, e.sur)
        const sinCabecera = await estado(client.get('/api/v1/me').bearerToken(admin.token), 200)
        assert.isNull(sinCabecera.body().empresa_activa_id)
    })

    test('crear servicio: empresa activa del usuario; varias sin cabecera 422; auditoría con empresa', async ({
        client,
        assert,
    }) => {
        const e = await dosEmpresas()
        const soloSur = await usuarioEnEmpresas(['soporte'], [e.sur])
        const cuerpo = {
            cliente_id: e.clienteNuevo,
            router_id: e.routerId,
            plan_id: e.planId,
            plantilla_facturacion_id: null,
        }
        const creado = await estado(
            client.post('/api/v1/servicios').bearerToken(soloSur.token).json(cuerpo),
            201,
        )
        assert.equal(creado.body().empresa_id, e.sur)
        const accion = await db
            .from('audit.acciones')
            .where('accion', 'servicios.crear')
            .where('entidad_id', creado.body().id)
            .firstOrFail()
        assert.equal(accion.empresa_id, e.sur)

        // pedir otra empresa explícita sin acceso: 403
        await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(soloSur.token)
                .json({ ...cuerpo, empresa_id: e.norte }),
            403,
        )
        // el router sugiere una empresa sin acceso: 403
        await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(soloSur.token)
                .json({ ...cuerpo, router_id: e.routerNorte }),
            403,
        )

        const ambas = await usuarioEnEmpresas(['soporte'], [e.norte, e.sur])
        const requerida = await estado(
            client.post('/api/v1/servicios').bearerToken(ambas.token).json(cuerpo),
            422,
        )
        assert.include(requerida.body().type, 'empresa_requerida')
        const conCabecera = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(ambas.token)
                .header('X-Empresa-Id', String(e.norte))
                .json(cuerpo),
            201,
        )
        assert.equal(conCabecera.body().empresa_id, e.norte)

        // el error también queda auditado con la empresa activa
        const error = await db
            .from('audit.acciones')
            .where('accion', 'servicios.crear')
            .where('actor_id', ambas.usuario.id)
            .where('resultado', 'error')
            .firstOrFail()
        assert.isNull(error.empresa_id)
    })

    test('listas: servicios, clientes y routers por la empresa activa', async ({ client, assert }) => {
        const e = await dosEmpresas()
        const { token } = await usuarioEnEmpresas(['admin'], [e.norte, e.sur])

        const serviciosNorte = await estado(
            client
                .get('/api/v1/servicios?limit=200')
                .bearerToken(token)
                .header('X-Empresa-Id', String(e.norte)),
            200,
        )
        assert.include(ids(serviciosNorte.body()), e.servicioNorte)
        assert.notInclude(ids(serviciosNorte.body()), e.servicioSur)
        assert.isTrue(
            serviciosNorte.body().data.every((s: { empresa_id: number }) => s.empresa_id === e.norte),
        )

        const clientesSur = await estado(
            client.get('/api/v1/clientes?limit=200').bearerToken(token).header('X-Empresa-Id', String(e.sur)),
            200,
        )
        assert.include(ids(clientesSur.body()), e.clienteSur)
        assert.include(ids(clientesSur.body()), e.clienteNuevo)
        assert.notInclude(ids(clientesSur.body()), e.clienteNorte)

        const routersSur = await estado(
            client.get('/api/v1/routers?limit=200').bearerToken(token).header('X-Empresa-Id', String(e.sur)),
            200,
        )
        // el compartido (sin sugerida) sí; el sugerido para la otra empresa sin servicios del sur, no
        assert.include(ids(routersSur.body()), e.routerId)
        assert.notInclude(ids(routersSur.body()), e.routerNorte)

        // un recurso de otra empresa de su alcance se abre igual (enlace directo)
        await estado(
            client
                .get(`/api/v1/servicios/${e.servicioNorte}`)
                .bearerToken(token)
                .header('X-Empresa-Id', String(e.sur)),
            200,
        )
    })

    test('alcance: recursos de otra empresa 403; sin cabecera ve la unión de las suyas', async ({
        client,
        assert,
    }) => {
        const e = await dosEmpresas()
        const soloNorte = await usuarioEnEmpresas(['soporte'], [e.norte])
        await estado(client.get(`/api/v1/servicios/${e.servicioSur}`).bearerToken(soloNorte.token), 403)
        await estado(client.get(`/api/v1/clientes/${e.clienteSur}`).bearerToken(soloNorte.token), 403)
        await estado(client.get(`/api/v1/clientes/${e.clienteNuevo}`).bearerToken(soloNorte.token), 200)
        await estado(
            client
                .post(`/api/v1/servicios/${e.servicioSur}/suspender`)
                .bearerToken(soloNorte.token)
                .json({ motivo: 'no es mío' }),
            403,
        )
        const servicios = await estado(
            client.get('/api/v1/servicios?limit=200').bearerToken(soloNorte.token),
            200,
        )
        assert.include(ids(servicios.body()), e.servicioNorte)
        assert.notInclude(ids(servicios.body()), e.servicioSur)
    })

    test('consolidado: empresas=todas solo con alcance global (o acceso a todas)', async ({
        client,
        assert,
    }) => {
        const e = await dosEmpresas()
        const admin = await usuarioConRoles(['admin'])
        const todas = await estado(
            client
                .get('/api/v1/servicios?limit=200&empresas=todas')
                .bearerToken(admin.token)
                .header('X-Empresa-Id', String(e.norte)),
            200,
        )
        assert.includeMembers(ids(todas.body()), [e.servicioNorte, e.servicioSur])
        const clientes = await estado(
            client.get('/api/v1/clientes?limit=200&empresas=todas').bearerToken(admin.token),
            200,
        )
        assert.includeMembers(ids(clientes.body()), [e.clienteNorte, e.clienteSur, e.clienteNuevo])

        const acotado = await usuarioEnEmpresas(['admin'], [e.norte])
        const prohibido = await estado(
            client.get('/api/v1/servicios?empresas=todas').bearerToken(acotado.token),
            403,
        )
        assert.include(prohibido.body().type, 'empresa_no_permitida')
        const listaEmpresas = await estado(client.get('/api/v1/empresas').bearerToken(acotado.token), 200)
        assert.deepEqual(
            listaEmpresas.body().map((x: { id: number }) => x.id),
            [e.norte],
        )
        await estado(client.get(`/api/v1/empresas/${e.sur}`).bearerToken(acotado.token), 403)

        // con acceso a todas las activas, el consolidado también vale
        await db.from('core.empresas').whereNotIn('id', [1, e.norte, e.sur]).update({ activa: false })
        const conTodas = await usuarioEnEmpresas(['admin'], [1, e.norte, e.sur])
        await estado(client.get('/api/v1/servicios?empresas=todas').bearerToken(conTodas.token), 200)
    })

    test('con una sola empresa nada cambia: sin cabecera todo es de la 1', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const me = await estado(client.get('/api/v1/me').bearerToken(token), 200)
        assert.equal(me.body().empresa_activa_id, 1)
        const clienteId = await crearClienteFila()
        const { routerId } = await crearEscenarioRouter()
        const planId = await crearPlanFila()
        const creado = await estado(
            client.post('/api/v1/servicios').bearerToken(token).json({
                cliente_id: clienteId,
                router_id: routerId,
                plan_id: planId,
                plantilla_facturacion_id: null,
            }),
            201,
        )
        assert.equal(creado.body().empresa_id, 1)
        const lista = await estado(
            client.get(`/api/v1/servicios?cliente_id=${clienteId}`).bearerToken(token),
            200,
        )
        assert.deepEqual(ids(lista.body()), [creado.body().id])
        const accion = await db
            .from('audit.acciones')
            .where('accion', 'servicios.crear')
            .where('entidad_id', creado.body().id)
            .firstOrFail()
        assert.equal(accion.empresa_id, 1)
    })

    test('CORS: el preflight permite X-Empresa-Id', async ({ client, assert }) => {
        const respuesta = await client
            .options('/api/v1/servicios')
            .header('Origin', 'http://localhost:3000')
            .header('Access-Control-Request-Method', 'GET')
            .header('Access-Control-Request-Headers', 'authorization, x-empresa-id')
        assert.oneOf(respuesta.status(), [200, 204])
        assert.include((respuesta.header('access-control-allow-headers') ?? '').toLowerCase(), 'x-empresa-id')
    })
})
