import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { ApiClient } from '@japa/api-client'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearServicioFila } from '#tests/core/fabricas'
import GenerarTokenHorus from '#core/actions/generar_token_horus'
import { csrfDeSesion } from '#core/auth/sesion_panel'
import { PERMISOS_HORUS } from '#core/integraciones_horus'

/**
 * Autologin desde Horus, lado receptor (contrato Horus §1.5, pedido A9): ticket de un solo uso,
 * canje, vinculación tras el login normal y revocación.
 */

const PANEL = 'http://localhost:3000'
const TICKETS = '/api/v1/integraciones/horus/sso/tickets'
const CANJEAR = '/api/v1/auth/sso/canjear'
const VINCULAR = '/api/v1/auth/sso/vincular'

function cookieDe(setCookie: string | string[] | undefined): string | null {
    const lista = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []
    const crudo = lista.find((c) => c.startsWith('argos_sesion='))
    return crudo ? crudo.split(';')[0]!.slice('argos_sesion='.length) : null
}

async function horus() {
    return new GenerarTokenHorus().execute({}, contextoPrueba())
}

/** Pide un ticket como el servidor de Horus y devuelve el ticket (del fragmento de la URL). */
async function pedirTicket(
    client: ApiClient,
    token: string,
    idExterno: string,
    destino: { tipo: string; id_externo: string },
    correo: string | null = null,
) {
    const respuesta = await estado(
        client
            .post(TICKETS)
            .bearerToken(token)
            .json({ usuario: { id_externo: idExterno, correo, nombre: 'Ana López' }, destino }),
        201,
    )
    const { url, expira_en: expiraEn } = respuesta.body() as { url: string; expira_en: string }
    return { url, expiraEn, ticket: url.split('#')[1]! }
}

const canjear = (client: ApiClient, ticket: string) =>
    client.post(CANJEAR).header('Origin', PANEL).json({ ticket })

test.group('SSO desde Horus · ticket, canje y vinculación', () => {
    test('el token Horus lleva sso.emitir; solo él emite: otro token o un admin con sesión → 403', async ({
        client,
        assert,
    }) => {
        const h = await horus()
        assert.include(h.datos.alcances.permisos as string[], 'sso.emitir')
        assert.deepEqual(h.datos.alcances.permisos, [...PERMISOS_HORUS])
        const { url, expiraEn } = await pedirTicket(client, h.token, 'u-1', {
            tipo: 'cliente',
            id_externo: '1',
        })
        assert.match(url, /^http:\/\/localhost:3000\/sso\/entrar#[\w-]{40,}$/)
        const vida = new Date(expiraEn).getTime() - Date.now()
        assert.isAbove(vida, 50_000)
        assert.isAtMost(vida, 60_000)

        // se guarda solo el hash; la auditoría no trae el valor
        const ticket = url.split('#')[1]!
        assert.isNull(await db.from('core.sso_tickets').where('hash', ticket).first())
        const accion = await db
            .from('audit.acciones')
            .where('accion', 'sso.emitir')
            .orderBy('id', 'desc')
            .firstOrFail()
        assert.equal(accion.actor_tipo, 'token')
        assert.equal(accion.actor_id, h.usuario_id)
        assert.notInclude(JSON.stringify(accion.entrada), ticket)
        assert.equal(accion.entrada.usuario.id_externo, 'u-1')

        const admin = await usuarioConRoles(['admin'])
        const cuerpo = { usuario: { id_externo: 'u-1' }, destino: { tipo: 'cliente', id_externo: '1' } }
        await estado(client.post(TICKETS).bearerToken(admin.token).json(cuerpo), 403)
        const otro = await estado(
            client
                .post('/api/v1/tokens')
                .bearerToken(admin.token)
                .json({ usuario_id: admin.usuario.id, nombre: 'otro' }),
            201,
        )
        await estado(client.post(TICKETS).bearerToken(otro.body().token).json(cuerpo), 403)
        await estado(
            client
                .post(TICKETS)
                .bearerToken(h.token)
                .json({ ...cuerpo, destino: { tipo: 'hallazgo', id_externo: '1' } }),
            422,
        )
    })

    test('sin vinculación pide login; el correo coincidente NO entra; tras el login queda vinculado', async ({
        client,
        assert,
    }) => {
        const h = await horus()
        const soporte = await usuarioConRoles(['soporte'])
        const servicioId = await crearServicioFila({ cliente_id: await crearClienteFila() })
        const idExterno = unico('u')

        // mismo correo que el usuario local: no hay sesión ni cookie
        const { ticket } = await pedirTicket(
            client,
            h.token,
            idExterno,
            { tipo: 'servicio', id_externo: String(servicioId) },
            soporte.usuario.email,
        )
        const canje = await estado(canjear(client, ticket), 200)
        assert.isNull(cookieDe(canje.header('set-cookie')))
        const cuerpo = canje.body()
        assert.equal(cuerpo.resultado, 'vinculacion_requerida')
        assert.isNull(cuerpo.sesion)
        assert.equal(cuerpo.ruta, `/servicios/${servicioId}`)
        assert.equal(cuerpo.vinculacion.usuario_externo.correo, soporte.usuario.email)
        assert.isNull(await db.from('core.vinculaciones_externas').where('id_externo', idExterno).first())

        // credenciales malas: 401 y el token de vinculación sigue sirviendo
        await estado(
            client.post(VINCULAR).header('Origin', PANEL).json({
                token_vinculacion: cuerpo.vinculacion.token,
                email: soporte.usuario.email,
                password: 'incorrecta',
            }),
            401,
        )
        const vinculado = await estado(
            client.post(VINCULAR).header('Origin', PANEL).json({
                token_vinculacion: cuerpo.vinculacion.token,
                email: soporte.usuario.email,
                password: soporte.password,
            }),
            200,
        )
        assert.equal(vinculado.body().resultado, 'sesion')
        assert.equal(vinculado.body().ruta, `/servicios/${servicioId}`)
        assert.isNotNull(cookieDe(vinculado.header('set-cookie')))
        const fila = await db
            .from('core.vinculaciones_externas')
            .where('id_externo', idExterno)
            .whereNull('revocada_en')
            .firstOrFail()
        assert.equal(fila.usuario_id, soporte.usuario.id)
        assert.equal(fila.conector, 'horus')

        // el token de vinculación es de un solo uso
        await estado(
            client.post(VINCULAR).header('Origin', PANEL).json({
                token_vinculacion: cuerpo.vinculacion.token,
                email: soporte.usuario.email,
                password: soporte.password,
            }),
            410,
        )

        // auditoría: emisión, canje, vinculación (y el login)
        const acciones = await db
            .from('audit.acciones')
            .whereIn('accion', ['auth.sso_canjear', 'auth.sso_vincular'])
            .where('resultado', 'ok')
            .where('created_at', '>=', fila.created_at)
            .select('accion', 'actor_id')
        assert.deepInclude(acciones, { accion: 'auth.sso_vincular', actor_id: soporte.usuario.id })
    })

    test('con vinculación: sesión del usuario local con sus permisos, no más; ticket de un solo uso', async ({
        client,
        assert,
    }) => {
        const h = await horus()
        const cajero = await usuarioConRoles(['cajero'])
        const idExterno = unico('u')
        await db.table('core.vinculaciones_externas').insert({
            conector: 'horus',
            id_externo: idExterno,
            usuario_id: cajero.usuario.id,
        })

        const { ticket } = await pedirTicket(client, h.token, idExterno, { tipo: 'cliente', id_externo: '7' })
        const canje = await estado(canjear(client, ticket), 200)
        const cuerpo = canje.body()
        assert.equal(cuerpo.resultado, 'sesion')
        assert.equal(cuerpo.ruta, '/clientes/7')
        assert.isNull(cuerpo.vinculacion)
        assert.equal(cuerpo.sesion.usuario.id, cajero.usuario.id)
        const valor = cookieDe(canje.header('set-cookie'))!
        assert.match(valor, /^oat_/)
        assert.equal(cuerpo.sesion.csrf, csrfDeSesion(valor))
        assert.notInclude(cuerpo.sesion.usuario.permisos, 'servicios.suspender')
        assert.isString(cuerpo.sesion.expira_max_en)

        // la sesión es la del cajero: puede ver clientes, no suspender servicios
        const cookie = `argos_sesion=${valor}`
        const me = await estado(client.get('/api/v1/me').header('Cookie', cookie), 200)
        assert.equal(me.body().id, cajero.usuario.id)
        const servicioId = await crearServicioFila({ cliente_id: await crearClienteFila() })
        await estado(
            client
                .post(`/api/v1/servicios/${servicioId}/suspender`)
                .header('Cookie', cookie)
                .header('X-CSRF-Token', cuerpo.sesion.csrf)
                .json({ motivo: 'prueba' }),
            403,
        )

        // reusado → 410
        const reuso = await estado(canjear(client, ticket), 410)
        assert.match(reuso.body().type, /ticket_invalido/)
        const canjeOk = await db
            .from('audit.acciones')
            .where('accion', 'auth.sso_canjear')
            .where('actor_id', cajero.usuario.id)
            .where('resultado', 'ok')
            .first()
        assert.exists(canjeOk)
    })

    test('ticket vencido, desconocido, de un conector revocado o de otro conector → 410', async ({
        client,
    }) => {
        const h = await horus()
        const usuario = await usuarioConRoles(['lectura'])
        const idExterno = unico('u')
        await db.table('core.vinculaciones_externas').insert({
            conector: 'horus',
            id_externo: idExterno,
            usuario_id: usuario.usuario.id,
        })
        const destino = { tipo: 'cliente', id_externo: '1' }

        // vencido
        const vencido = await pedirTicket(client, h.token, idExterno, destino)
        await db
            .from('core.sso_tickets')
            .whereNull('usado_en')
            .where('token_api_id', h.datos.id)
            .update({ expira_en: new Date(Date.now() - 1000) })
        await estado(canjear(client, vencido.ticket), 410)

        // desconocido
        await estado(canjear(client, 'x'.repeat(43)), 410)

        // de otro conector (un sistema que Argos no conoce)
        const otro = await pedirTicket(client, h.token, idExterno, destino)
        await db
            .from('core.sso_tickets')
            .whereNull('usado_en')
            .where('token_api_id', h.datos.id)
            .where('expira_en', '>', new Date())
            .update({ conector: 'otro' })
        await estado(canjear(client, otro.ticket), 410)

        // el token del conector se revocó después de emitir
        const vigente = await pedirTicket(client, h.token, idExterno, destino)
        await db.from('core.tokens_api').where('id', h.datos.id).update({ revocado_en: new Date() })
        await estado(canjear(client, vigente.ticket), 410)
    })

    test('quitar la propia vinculación o revocarlas (admin): el siguiente canje pide login otra vez', async ({
        client,
        assert,
    }) => {
        const h = await horus()
        const tecnico = await usuarioConRoles(['tecnico'])
        const idExterno = unico('u')
        const [v] = (await db
            .table('core.vinculaciones_externas')
            .insert({ conector: 'horus', id_externo: idExterno, usuario_id: tecnico.usuario.id })
            .returning('id')) as Array<{ id: number }>
        const destino = { tipo: 'router', id_externo: '3' }

        // el usuario ve y quita la suya
        const mias = await estado(client.get('/api/v1/me/vinculaciones').bearerToken(tecnico.token), 200)
        assert.deepEqual(
            mias.body().map((x: { id: number }) => x.id),
            [v!.id],
        )
        const otroUsuario = await usuarioConRoles(['tecnico'])
        await estado(
            client.post(`/api/v1/me/vinculaciones/${v!.id}/quitar`).bearerToken(otroUsuario.token),
            404,
        )
        await estado(client.post(`/api/v1/me/vinculaciones/${v!.id}/quitar`).bearerToken(tecnico.token), 200)
        const t1 = await pedirTicket(client, h.token, idExterno, destino)
        const c1 = await estado(canjear(client, t1.ticket), 200)
        assert.equal(c1.body().resultado, 'vinculacion_requerida')
        assert.equal(c1.body().ruta, '/routers/3')

        // se vuelve a vincular; un admin revoca todas las del usuario
        await estado(
            client.post(VINCULAR).header('Origin', PANEL).json({
                token_vinculacion: c1.body().vinculacion.token,
                email: tecnico.usuario.email,
                password: tecnico.password,
            }),
            200,
        )
        const t2 = await pedirTicket(client, h.token, idExterno, destino)
        const c2 = await estado(canjear(client, t2.ticket), 200)
        assert.equal(c2.body().resultado, 'sesion')

        await estado(client.post('/api/v1/vinculaciones/revocar').bearerToken(tecnico.token).json({}), 403)
        const admin = await usuarioConRoles(['admin'])
        const revocacion = await estado(
            client
                .post('/api/v1/vinculaciones/revocar')
                .bearerToken(admin.token)
                .json({ usuario_id: tecnico.usuario.id }),
            200,
        )
        assert.equal(revocacion.body().revocadas, 1)
        const cambios = await db
            .from('audit.cambios')
            .where('entidad_tipo', 'vinculacion_externa')
            .where('campo', 'revocada_en')
            .whereIn(
                'entidad_id',
                db.from('core.vinculaciones_externas').where('id_externo', idExterno).select('id'),
            )
        assert.lengthOf(cambios, 2)

        const t3 = await pedirTicket(client, h.token, idExterno, destino)
        const c3 = await estado(canjear(client, t3.ticket), 200)
        assert.equal(c3.body().resultado, 'vinculacion_requerida')
    })
})
