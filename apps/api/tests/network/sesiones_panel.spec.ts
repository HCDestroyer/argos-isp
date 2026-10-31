import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearRouterFila, crearServicioFila, ipUnica } from '#tests/core/fabricas'
import IniciarSesion from '#network/sesiones/actions/iniciar_sesion'
import TerminarSesion from '#network/sesiones/actions/terminar_sesion'
import type { RegistroAccounting } from '#network/sesiones/registro'

/**
 * Tarea 8 de A2: sesiones para el panel.
 *
 * - `GET /sesiones?servicio_id=&router_id=&activa=` con el contrato `Sesion`, cursor y alcance.
 * - `POST /sesiones/:id/desconectar` y `POST /servicios/:id/desconectar`: acción de dominio con
 *   motivo, auditoría, `Idempotency-Key` y `sesion.desconexion_solicitada` por outbox (lo ejecuta
 *   `coa`; de punta a punta en `coa.spec.ts`).
 */

interface Escenario {
    servicioId: number
    routerId: number
    nasIp: string
    userPpp: string
}

async function escenario(routerId?: number): Promise<Escenario> {
    const nasIp = ipUnica()
    const router = routerId ?? (await crearRouterFila({ nas_ip: nasIp }))
    const nas = routerId
        ? (
              (await db
                  .from('network.routers')
                  .where('id', routerId)
                  .select(db.raw('host(nas_ip) AS nas_ip'))
                  .first()) as { nas_ip: string }
          ).nas_ip
        : nasIp
    const userPpp = unico('ppp')
    const servicioId = await crearServicioFila({
        cliente_id: await crearClienteFila(),
        router_id: router,
        user_ppp: userPpp,
        ipv6_modo: 'ninguno',
    })
    return { servicioId, routerId: router, nasIp: nas, userPpp }
}

function registro(e: Escenario, parcial: Partial<RegistroAccounting> = {}): RegistroAccounting {
    return {
        tipo: 'Start',
        nas_ip: e.nasIp,
        acct_session_id: unico('ses'),
        user_ppp: e.userPpp,
        ipv4: '10.10.1.20',
        prefijo_enlace_v6: '2001:db8:a8::/64',
        prefijo_delegado_v6: null,
        bytes_in: '0',
        bytes_out: '0',
        duracion_s: null,
        causa_fin: null,
        evento_en: new Date().toISOString(),
        ...parcial,
    }
}

async function abrir(e: Escenario, parcial: Partial<RegistroAccounting> = {}) {
    const r = registro(e, parcial)
    const resultado = await new IniciarSesion().execute(r, contextoPrueba())
    return { id: resultado.sesionId!, acctSessionId: r.acct_session_id }
}

async function cerrar(e: Escenario, acctSessionId: string) {
    await new TerminarSesion().execute(
        registro(e, {
            tipo: 'Stop',
            acct_session_id: acctSessionId,
            bytes_in: '1500',
            bytes_out: '64000',
            duracion_s: 60,
            causa_fin: 'User-Request',
        }),
        contextoPrueba(),
    )
}

async function desconexiones(sesionId: number) {
    return db
        .from('audit.outbox')
        .where('evento', 'sesion.desconexion_solicitada')
        .whereRaw(`(payload->>'sesion_id')::bigint = ?`, [sesionId])
        .select('payload', 'request_id')
}

test.group('network · sesiones para el panel (tarea 8)', () => {
    test('GET /sesiones filtra por servicio, router y activa con el contrato Sesion', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const e = await escenario()
        const vieja = await abrir(e)
        await cerrar(e, vieja.acctSessionId)
        const viva = await abrir(e)
        const otro = await escenario(e.routerId)
        await abrir(otro)

        const activas = await estado(
            client.get('/api/v1/sesiones').qs({ servicio_id: e.servicioId, activa: true }).bearerToken(token),
            200,
        )
        const cuerpo = activas.body() as { data: Array<Record<string, unknown>>; nextCursor: string | null }
        assert.lengthOf(cuerpo.data, 1)
        assert.isNull(cuerpo.nextCursor)
        const s = cuerpo.data[0]!
        assert.deepEqual(Object.keys(s).sort(), [
            'acct_session_id',
            'bytes_in',
            'bytes_out',
            'causa_fin',
            'fin',
            'id',
            'inicio',
            'ipv4',
            'nas_ip',
            'origen',
            'prefijo_delegado_v6',
            'prefijo_enlace_v6',
            'router_id',
            'servicio_id',
            'user_ppp',
        ])
        assert.equal(s.origen, 'accounting')
        assert.include(s, {
            id: viva.id,
            servicio_id: e.servicioId,
            router_id: e.routerId,
            nas_ip: e.nasIp,
            acct_session_id: viva.acctSessionId,
            user_ppp: e.userPpp,
            ipv4: '10.10.1.20',
            prefijo_enlace_v6: '2001:db8:a8::/64',
            prefijo_delegado_v6: null,
            fin: null,
            bytes_in: 0,
            bytes_out: 0,
            causa_fin: null,
        })
        assert.isString(s.inicio)

        const cerradas = await estado(
            client
                .get('/api/v1/sesiones')
                .qs({ servicio_id: e.servicioId, activa: false })
                .bearerToken(token),
            200,
        )
        const [h] = (cerradas.body() as { data: Array<Record<string, unknown>> }).data
        assert.include(h, { id: vieja.id, bytes_in: 1500, bytes_out: 64000, causa_fin: 'User-Request' })
        assert.isString(h!.fin)

        const delRouter = await estado(
            client.get('/api/v1/sesiones').qs({ router_id: e.routerId }).bearerToken(token),
            200,
        )
        const ids = (delRouter.body() as { data: Array<{ id: number; servicio_id: number }> }).data
        assert.lengthOf(ids, 3)
        // la más reciente primero
        assert.deepEqual(
            ids.map((x) => x.id),
            [...ids.map((x) => x.id)].sort((a, b) => b - a),
        )
    })

    test('GET /sesiones pagina por cursor', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const e = await escenario()
        for (let i = 0; i < 3; i++) {
            const s = await abrir(e)
            await cerrar(e, s.acctSessionId)
        }
        const p1 = await estado(
            client.get('/api/v1/sesiones').qs({ router_id: e.routerId, limit: 2 }).bearerToken(token),
            200,
        )
        const b1 = p1.body() as { data: Array<{ id: number }>; nextCursor: string }
        assert.lengthOf(b1.data, 2)
        assert.isString(b1.nextCursor)
        const p2 = await estado(
            client
                .get('/api/v1/sesiones')
                .qs({ router_id: e.routerId, limit: 2, cursor: b1.nextCursor })
                .bearerToken(token),
            200,
        )
        const b2 = p2.body() as { data: Array<{ id: number }>; nextCursor: string | null }
        assert.lengthOf(b2.data, 1)
        assert.isNull(b2.nextCursor)
        assert.notInclude(
            b1.data.map((x) => x.id),
            b2.data[0]!.id,
        )
    })

    test('GET /sesiones respeta permiso y alcance por router', async ({ client, assert }) => {
        const { token: sinPermiso } = await usuarioConRoles(['contabilidad'])
        await estado(client.get('/api/v1/sesiones').bearerToken(sinPermiso), 403)

        const a = await escenario()
        const b = await escenario()
        const sa = await abrir(a)
        const sb = await abrir(b)
        const { usuario, token } = await usuarioConRoles([])
        const rol = (await db.from('core.roles').where('nombre', 'tecnico').select('id').first()) as {
            id: number
        }
        await db.table('core.usuarios_roles').insert({
            usuario_id: usuario.id,
            role_id: rol.id,
            alcance_tipo: 'router',
            alcance_id: a.routerId,
        })
        const r = await estado(client.get('/api/v1/sesiones').qs({ activa: true }).bearerToken(token), 200)
        const ids = (r.body() as { data: Array<{ id: number }> }).data.map((x) => x.id)
        assert.include(ids, sa.id)
        assert.notInclude(ids, sb.id)

        await estado(
            client
                .post(`/api/v1/sesiones/${sb.id}/desconectar`)
                .bearerToken(token)
                .json({ motivo: 'fuera de alcance' }),
            403,
        )
        assert.lengthOf(await desconexiones(sb.id), 0)
    })

    test('POST /sesiones/:id/desconectar → 202, auditoría y sesion.desconexion_solicitada una sola vez con Idempotency-Key', async ({
        client,
        assert,
    }) => {
        const { usuario, token } = await usuarioConRoles(['soporte'])
        const e = await escenario()
        const s = await abrir(e)
        const clave = randomUUID()
        const pedir = () =>
            client
                .post(`/api/v1/sesiones/${s.id}/desconectar`)
                .bearerToken(token)
                .header('Idempotency-Key', clave)
                .json({ motivo: 'el cliente pidió reiniciar' })

        const r1 = await estado(pedir(), 202)
        const r2 = await estado(pedir(), 202)
        assert.deepEqual(r2.body(), r1.body())
        assert.include(r1.body(), { id: s.id, fin: null, acct_session_id: s.acctSessionId })

        const eventos = await desconexiones(s.id)
        assert.lengthOf(eventos, 1)
        assert.deepEqual(eventos[0].payload, {
            sesion_id: s.id,
            servicio_id: e.servicioId,
            nas_ip: e.nasIp,
            acct_session_id: s.acctSessionId,
            user_ppp: e.userPpp,
            motivo: 'el cliente pidió reiniciar',
        })

        const acciones = await db
            .from('audit.acciones')
            .where('accion', 'sesiones.desconectar')
            .where('entidad_tipo', 'sesion')
            .where('entidad_id', s.id)
            .select('actor_id', 'resultado', 'entrada', 'canal', 'request_id')
        assert.lengthOf(acciones, 1)
        assert.equal(Number(acciones[0].actor_id), usuario.id)
        assert.equal(acciones[0].resultado, 'ok')
        assert.equal(acciones[0].entrada.motivo, 'el cliente pidió reiniciar')
        assert.equal(acciones[0].request_id, eventos[0].request_id)
    })

    test('POST /sesiones/:id/desconectar: 404 si no existe, 409 si ya terminó, 422 sin motivo', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const e = await escenario()
        const s = await abrir(e)
        await cerrar(e, s.acctSessionId)

        const r404 = await estado(
            client.post('/api/v1/sesiones/999999999/desconectar').bearerToken(token).json({ motivo: 'xyz' }),
            404,
        )
        assert.equal(r404.header('content-type')?.split(';')[0], 'application/problem+json')
        const r409 = await estado(
            client.post(`/api/v1/sesiones/${s.id}/desconectar`).bearerToken(token).json({ motivo: 'xyz' }),
            409,
        )
        assert.include(r409.body(), { type: 'urn:argosisp:problema:sesion_terminada', status: 409 })
        await estado(client.post(`/api/v1/sesiones/${s.id}/desconectar`).bearerToken(token).json({}), 422)
        assert.lengthOf(await desconexiones(s.id), 0)
        const error = await db
            .from('audit.acciones')
            .where('accion', 'sesiones.desconectar')
            .where('entidad_id', s.id)
            .first()
        assert.equal(error.resultado, 'error')
    })

    test('POST /servicios/:id/desconectar → desconecta la sesión activa; 404 problem si no hay', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const e = await escenario()

        const sinSesion = await estado(
            client
                .post(`/api/v1/servicios/${e.servicioId}/desconectar`)
                .bearerToken(token)
                .json({ motivo: 'prueba sin sesión' }),
            404,
        )
        assert.include(sinSesion.body(), { type: 'urn:argosisp:problema:no_encontrado', status: 404 })
        assert.match(String(sinSesion.body().detail), /no tiene una sesión activa/)

        const vieja = await abrir(e)
        await cerrar(e, vieja.acctSessionId)
        const viva = await abrir(e)
        const r = await estado(
            client
                .post(`/api/v1/servicios/${e.servicioId}/desconectar`)
                .bearerToken(token)
                .header('Idempotency-Key', randomUUID())
                .json({ motivo: 'cambio de CPE' }),
            200,
        )
        assert.include(r.body(), { id: e.servicioId, user_ppp: e.userPpp })
        assert.lengthOf(await desconexiones(vieja.id), 0)
        const [evento] = await desconexiones(viva.id)
        assert.include(evento.payload, {
            sesion_id: viva.id,
            servicio_id: e.servicioId,
            motivo: 'cambio de CPE',
        })

        const accion = await db
            .from('audit.acciones')
            .where('accion', 'servicios.desconectar')
            .where('entidad_tipo', 'servicio')
            .where('entidad_id', e.servicioId)
            .where('resultado', 'ok')
            .first()
        assert.exists(accion)

        await estado(
            client
                .post('/api/v1/servicios/999999999/desconectar')
                .bearerToken(token)
                .json({ motivo: 'no existe' }),
            404,
        )
        const { token: lectura } = await usuarioConRoles(['lectura'])
        await estado(
            client
                .post(`/api/v1/servicios/${e.servicioId}/desconectar`)
                .bearerToken(lectura)
                .json({ motivo: 'sin permiso' }),
            403,
        )
    })
})
