import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar } from '#shared/cifrado'
import { estado, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'
import { RouterOSFalso } from '#network/routeros/falso'

/**
 * `POST /servicios/:id/sincronizar-router` (pedido del PM, 29 oct): aplica en el acto el estado deseado
 * del servicio en su MikroTik (RouterOS falso) y dice qué corrigió. Los servicios se crean por la API
 * sin entregar sus eventos al dispatcher: el router queda desincronizado a propósito.
 */
test.group('Servicios · sincronizar con el router', (group) => {
    let falso: RouterOSFalso
    let token: string
    let routerId: number
    let planId: number
    let clienteId: number

    group.each.setup(async () => {
        falso = new RouterOSFalso()
        await falso.levantar()
        ;({ token } = await usuarioConRoles(['soporte']))
        ;({ routerId } = await crearEscenarioRouter())
        await db
            .from('network.routers')
            .where('id', routerId)
            .update({ host: falso.url, api_usuario: falso.usuario, api_password: cifrar(falso.password) })
        planId = await crearPlanFila({ bajada_limitada_kbps: 2000, subida_limitada_kbps: 1000 })
        clienteId = await crearClienteFila()
        return () => falso.cerrar()
    })

    async function crear(client: any, cuerpo: Record<string, unknown> = {}) {
        const r = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({
                    plantilla_facturacion_id: null,
                    cliente_id: clienteId,
                    router_id: routerId,
                    plan_id: planId,
                    tipo_conexion: 'ip_estatica',
                    ...cuerpo,
                }),
            201,
        )
        return r.body() as { id: number; ipv4: string }
    }

    const sincronizar = (client: any, id: number, status = 200) =>
        estado(client.post(`/api/v1/servicios/${id}/sincronizar-router`).bearerToken(token), status)

    async function resultadoDe(client: any, id: number) {
        const r = await sincronizar(client, id)
        return r.body()
    }

    test('desincronizado → crea lo que falta; ya bien → ya_estaba_bien; borrado a mano → lo repone', async ({
        client,
        assert,
    }) => {
        const servicio = await crear(client)
        const comment = `argosisp:servicio:${servicio.id}`
        assert.lengthOf(falso.conComment('/queue/simple', comment), 0)

        const primera = await resultadoDe(client, servicio.id)
        assert.equal(primera.servicio_id, servicio.id)
        assert.equal(primera.router_id, routerId)
        assert.isFalse(primera.ya_estaba_bien)
        assert.isNull(primera.error)
        assert.deepInclude(primera.cambios, {
            router_id: routerId,
            ruta: '/queue/simple',
            comment,
            accion: 'creado',
        })
        assert.lengthOf(falso.conComment('/queue/simple', comment), 1)
        const red = await db.from('audit.red').where({ router_id: routerId, servicio_id: servicio.id })
        assert.isAbove(red.length, 0)
        const accion = await db
            .from('audit.acciones')
            .where({ accion: 'servicios.sincronizar_router', entidad_id: servicio.id })
            .firstOrFail()
        assert.equal(accion.resultado, 'ok')

        // idempotente: nada que corregir, ninguna escritura
        const escrituras = falso.escrituras.length
        const segunda = await resultadoDe(client, servicio.id)
        assert.isTrue(segunda.ya_estaba_bien)
        assert.deepEqual(segunda.cambios, [])
        assert.equal(falso.escrituras.length, escrituras)

        falso.borrarAMano('/queue/simple', (o) => o.comment === comment)
        const tercera = await resultadoDe(client, servicio.id)
        assert.isFalse(tercera.ya_estaba_bien)
        assert.deepInclude(tercera.cambios, {
            router_id: routerId,
            ruta: '/queue/simple',
            comment,
            accion: 'creado',
        })
    })

    test('router caído: 200 con error en lenguaje simple', async ({ client, assert }) => {
        const servicio = await crear(client)
        await falso.caer()
        const r = await resultadoDe(client, servicio.id)
        assert.isFalse(r.ya_estaba_bien)
        assert.equal(r.error.motivo, 'puerto_cerrado')
        assert.notInclude(r.error.detalle, 'ECONNREFUSED')
    })

    test('pendiente de instalación 422; router sin API 422; cajero 403; inexistente 404', async ({
        client,
        assert,
    }) => {
        const pendiente = await crear(client, { estado_inicial: 'pendiente_instalacion' })
        const r = await sincronizar(client, pendiente.id, 422)
        assert.equal(r.body().type, 'urn:argosisp:problema:servicio_pendiente_instalacion')

        const servicio = await crear(client)
        await db
            .from('network.routers')
            .where('id', routerId)
            .update({ api_usuario: null, api_password: null })
        const sinApi = await sincronizar(client, servicio.id, 422)
        assert.equal(sinApi.body().type, 'urn:argosisp:problema:router_sin_api')
        assert.include(sinApi.body().detail, 'API REST')

        const cajero = await usuarioConRoles(['cajero'])
        await estado(
            client.post(`/api/v1/servicios/${servicio.id}/sincronizar-router`).bearerToken(cajero.token),
            403,
        )
        await sincronizar(client, 999999999, 404)
    })
})
