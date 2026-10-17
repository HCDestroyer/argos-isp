import { test } from '@japa/runner'
import type { ApiResponse } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearRouterFila, crearServicioFila, ipUnica } from '#tests/core/fabricas'

/**
 * Semana 3 · tarea 3 de A2: fecha de migración del router al nuevo `aaa` (acción
 * `routers.marcar_migrado`, tabla `network.routers_migracion_aaa`) y su uso como `desde` por
 * defecto de `GET /routers/:id/resumen-sesiones`.
 */

const HORA = 3_600_000
const hace = (horas: number) => new Date(Date.now() - horas * HORA)

type Migracion = {
    router_id: number
    aaa_desde: string | null
    motivo: string | null
    version: number
    updated_at: string | null
    primer_accounting: string | null
}

async function cuerpo<T>(peticion: PromiseLike<ApiResponse>, status: number): Promise<T> {
    const r = await estado(peticion, status)
    return r.body() as T
}

async function cambios(routerId: number) {
    return db
        .from('audit.cambios')
        .where({ entidad_tipo: 'router', entidad_id: routerId, campo: 'aaa_desde' })
        .orderBy('id', 'asc')
        .select('antes', 'despues', 'actor_id')
}

test.group('network · fecha de migración al nuevo aaa (semana 3, tarea 3)', () => {
    test('marcar, leer, volver a marcar y desmarcar, con auditoría', async ({ client, assert }) => {
        const { usuario, token } = await usuarioConRoles(['tecnico'])
        const nasIp = ipUnica()
        const routerId = await crearRouterFila({ nas_ip: nasIp })

        const inicial = await cuerpo<Migracion>(
            client.get(`/api/v1/routers/${routerId}/migracion-aaa`).bearerToken(token),
            200,
        )
        assert.deepEqual(inicial, {
            router_id: routerId,
            aaa_desde: null,
            motivo: null,
            version: 0,
            updated_at: null,
            primer_accounting: null,
        })

        // Una sesión de prueba anterior: queda como primer_accounting, no como fecha de migración.
        const prueba = hace(72)
        await db.table('network.sesiones').insert({
            router_id: routerId,
            nas_ip: nasIp,
            acct_session_id: unico('ses'),
            user_ppp: unico('ppp'),
            inicio: prueba,
            fin: hace(71),
        })

        const fecha = hace(24)
        const marcada = await cuerpo<Migracion>(
            client.post(`/api/v1/routers/${routerId}/marcar-migrado`).bearerToken(token).json({
                desde: fecha.toISOString(),
                motivo: 'piloto: RB-Centro al nuevo aaa',
                version: 0,
            }),
            200,
        )
        assert.include(marcada, {
            router_id: routerId,
            aaa_desde: fecha.toISOString(),
            motivo: 'piloto: RB-Centro al nuevo aaa',
            version: 1,
            primer_accounting: prueba.toISOString(),
        })

        const accion = (await db
            .from('audit.acciones')
            .where({ accion: 'routers.marcar_migrado', entidad_tipo: 'router', entidad_id: routerId })
            .select('resultado', 'actor_id')
            .first()) as { resultado: string; actor_id: number | string }
        assert.equal(accion.resultado, 'ok')
        assert.equal(Number(accion.actor_id), usuario.id)

        // version vieja → 409
        await estado(
            client
                .post(`/api/v1/routers/${routerId}/marcar-migrado`)
                .bearerToken(token)
                .json({ motivo: 'otra', version: 0 }),
            409,
        )

        // sin desde = ahora
        const antesDeAhora = Date.now()
        const ahora = await cuerpo<Migracion>(
            client
                .post(`/api/v1/routers/${routerId}/marcar-migrado`)
                .bearerToken(token)
                .json({ motivo: 'se repitió el corte', version: 1 }),
            200,
        )
        assert.equal(ahora.version, 2)
        assert.isAtLeast(new Date(ahora.aaa_desde!).getTime(), antesDeAhora - 1000)

        // null = desmarcar (vuelta atrás)
        const desmarcada = await cuerpo<Migracion>(
            client
                .post(`/api/v1/routers/${routerId}/marcar-migrado`)
                .bearerToken(token)
                .json({ desde: null, motivo: 'vuelta atrás del piloto' }),
            200,
        )
        assert.include(desmarcada, { aaa_desde: null, version: 3, motivo: 'vuelta atrás del piloto' })

        const filas = await cambios(routerId)
        assert.deepEqual(
            filas.map((f) => [f.antes, f.despues]),
            [
                [null, fecha.toISOString()],
                [fecha.toISOString(), ahora.aaa_desde],
                [ahora.aaa_desde, null],
            ],
        )
    })

    test('validaciones: futura, 404, motivo, permiso y alcance; Idempotency-Key no repite', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const routerId = await crearRouterFila({ nas_ip: ipUnica() })
        const ruta = `/api/v1/routers/${routerId}/marcar-migrado`

        await estado(
            client
                .post(ruta)
                .bearerToken(token)
                .json({ desde: new Date(Date.now() + 2 * HORA).toISOString(), motivo: 'futuro' }),
            422,
        )
        await estado(client.post(ruta).bearerToken(token).json({ motivo: 'x' }), 422)
        await estado(
            client
                .post('/api/v1/routers/999999999/marcar-migrado')
                .bearerToken(token)
                .json({ motivo: 'no existe' }),
            404,
        )
        await estado(client.get('/api/v1/routers/999999999/migracion-aaa').bearerToken(token), 404)

        const { token: soporte } = await usuarioConRoles(['soporte'])
        await estado(client.post(ruta).bearerToken(soporte).json({ motivo: 'sin permiso' }), 403)
        await estado(client.get(`/api/v1/routers/${routerId}/migracion-aaa`).bearerToken(soporte), 200)

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
            client
                .post(`/api/v1/routers/${otro}/marcar-migrado`)
                .bearerToken(acotado)
                .json({ motivo: 'fuera' }),
            403,
        )

        const clave = unico('idem')
        const desdeIdem = hace(5).toISOString()
        for (let i = 0; i < 2; i++) {
            const r = await estado(
                client
                    .post(ruta)
                    .header('Idempotency-Key', clave)
                    .bearerToken(acotado)
                    .json({ desde: desdeIdem, motivo: 'marcar una vez' }),
                200,
            )
            assert.equal((r.body() as Migracion).version, 1)
        }
        assert.lengthOf(await cambios(routerId), 1)
    })

    test('resumen-sesiones usa la fecha marcada como desde por defecto', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const nasIp = ipUnica()
        const routerId = await crearRouterFila({ nas_ip: nasIp })
        const s = await crearServicioFila({
            cliente_id: await crearClienteFila(),
            router_id: routerId,
            ipv6_modo: 'ninguno',
        })
        await db.table('network.sesiones').insert({
            servicio_id: s,
            router_id: routerId,
            nas_ip: nasIp,
            acct_session_id: unico('ses'),
            user_ppp: unico('ppp'),
            inicio: hace(30),
            fin: hace(20),
        })
        const resumen = `/api/v1/routers/${routerId}/resumen-sesiones`
        await estado(client.get(resumen).bearerToken(token), 422)

        const fecha = hace(10)
        await estado(
            client
                .post(`/api/v1/routers/${routerId}/marcar-migrado`)
                .bearerToken(token)
                .json({ desde: fecha.toISOString(), motivo: 'piloto' }),
            200,
        )
        const r = await cuerpo<Record<string, any>>(client.get(resumen).bearerToken(token), 200)
        assert.include(r, { desde: fecha.toISOString(), aaa_desde: fecha.toISOString(), con_sesion_desde: 0 })
        assert.deepEqual(
            (r.sin_sesion_desde as Array<{ servicio_id: number }>).map((x) => x.servicio_id),
            [s],
        )

        // un desde explícito gana a la fecha marcada
        const explicito = hace(25).toISOString()
        const r2 = await cuerpo<Record<string, any>>(
            client.get(resumen).qs({ desde: explicito }).bearerToken(token),
            200,
        )
        assert.include(r2, { desde: explicito, aaa_desde: fecha.toISOString(), con_sesion_desde: 1 })
    })
})
