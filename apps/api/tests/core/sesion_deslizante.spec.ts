import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { AccessToken } from '@adonisjs/auth/access_tokens'
import type { ApiClient } from '@japa/api-client'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import {
    NOMBRE_TOKEN_PANEL,
    configSesionPanel,
    decidirRenovacion,
    relojSesion,
} from '#core/auth/sesion_deslizante'

/**
 * Sesión deslizante del panel: renovación, tope absoluto, inactividad, sin escrituras por petición
 * y Bearer intacto. Reloj controlado (`relojSesion`): nada espera en tiempo real.
 * Contrato: `.claude/integration/contratos/sesion-panel.md` §4.
 */

const PANEL = 'http://localhost:3000'
const MIN = 60_000
const HORA = 60 * MIN
const relojReal = relojSesion.ahora

function fijarReloj(instante: Date) {
    relojSesion.ahora = () => new Date(instante.getTime())
}

function cookieSesion(
    setCookie: string | string[] | undefined,
): { valor: string; maxAge: number | null } | null {
    const lista = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []
    const crudo = lista.find((c) => c.startsWith('argos_sesion='))
    if (!crudo) return null
    const [par, ...atributos] = crudo.split(';').map((p) => p.trim())
    const maxAge = atributos.find((a) => a.toLowerCase().startsWith('max-age='))
    return { valor: par!.slice('argos_sesion='.length), maxAge: maxAge ? Number(maxAge.split('=')[1]) : null }
}

interface FilaToken {
    id: number
    name: string
    created_at: Date
    updated_at: Date
    expires_at: Date | null
    last_used_at: Date | null
}

async function filaDe(valor: string): Promise<FilaToken> {
    const id = AccessToken.decode('oat_', valor)!.identifier
    return db.from('core.auth_access_tokens').where('id', id).firstOrFail()
}

async function loginPanel(client: ApiClient) {
    const { usuario, password } = await usuarioConRoles(['admin'])
    const respuesta = await estado(
        client.post('/api/v1/auth/sesion').header('Origin', PANEL).json({ email: usuario.email, password }),
        200,
    )
    const valor = cookieSesion(respuesta.header('set-cookie'))!.valor
    const fila = await filaDe(valor)
    return { valor, cookie: `argos_sesion=${valor}`, fila, inicio: new Date(fila.created_at), respuesta }
}

function me(client: ApiClient, cookie: string) {
    return client.get('/api/v1/me').header('Cookie', cookie)
}

test.group('Sesión del panel deslizante', (group) => {
    group.each.teardown(() => {
        relojSesion.ahora = relojReal
    })

    test('el login guarda 12 h de vencimiento y 72 h de tope', async ({ client, assert }) => {
        const { fila, inicio, respuesta } = await loginPanel(client)
        assert.equal(fila.name, NOMBRE_TOKEN_PANEL)
        const expira = new Date(respuesta.body().expira_en).getTime()
        assert.approximately(expira - inicio.getTime(), 12 * HORA, 5_000)
        assert.equal(new Date(respuesta.body().expira_max_en).getTime(), inicio.getTime() + 72 * HORA)
        const maxAge = cookieSesion(respuesta.header('set-cookie'))!.maxAge!
        assert.approximately(maxAge, 12 * 3600, 5)
    })

    test('una petición renueva el vencimiento, reemite la cookie y conserva el csrf', async ({
        client,
        assert,
    }) => {
        const { cookie, valor, inicio, respuesta } = await loginPanel(client)
        const csrf = respuesta.body().csrf

        fijarReloj(new Date(inicio.getTime() + 11 * HORA))
        const r = await estado(me(client, cookie), 200)
        const nueva = cookieSesion(r.header('set-cookie'))
        assert.isNotNull(nueva)
        assert.equal(nueva!.valor, valor)
        assert.equal(nueva!.maxAge, 12 * 3600)
        assert.equal(new Date(r.body().expira_en).getTime(), inicio.getTime() + 23 * HORA)
        assert.equal(new Date(r.body().expira_max_en).getTime(), inicio.getTime() + 72 * HORA)
        assert.equal(r.body().csrf, csrf)

        const fila = await filaDe(valor)
        assert.equal(new Date(fila.expires_at!).getTime(), inicio.getTime() + 23 * HORA)

        // a las 22 h sigue viva (sin la renovación habría vencido a las 12 h) y el csrf sirve en un POST
        fijarReloj(new Date(inicio.getTime() + 22 * HORA))
        await estado(
            client
                .post('/api/v1/zonas')
                .header('Cookie', cookie)
                .header('Origin', PANEL)
                .header('X-CSRF-Token', csrf)
                .json({ nombre: unico('Zona deslizante') }),
            201,
        )
    })

    test('nunca pasa del tope de 72 h desde el login', async ({ client, assert }) => {
        const { cookie, valor, inicio } = await loginPanel(client)
        const tope = inicio.getTime() + 72 * HORA

        for (let h = 11; h <= 66; h += 11) {
            fijarReloj(new Date(inicio.getTime() + h * HORA))
            const r = await estado(me(client, cookie), 200)
            assert.equal(
                new Date(r.body().expira_en).getTime(),
                Math.min(inicio.getTime() + (h + 12) * HORA, tope),
            )
        }
        fijarReloj(new Date(inicio.getTime() + 71 * HORA))
        const r = await estado(me(client, cookie), 200)
        assert.equal(new Date(r.body().expira_en).getTime(), tope)
        // ya en el tope: la cookie no se reemite (no hay nada que extender)
        assert.isNull(cookieSesion(r.header('set-cookie')))
        const enTope = await filaDe(valor)
        assert.equal(new Date(enTope.expires_at!).getTime(), tope)

        fijarReloj(new Date(tope + 1_000))
        const vencida = await estado(me(client, cookie), 401)
        assert.equal(vencida.body().type, 'urn:argosisp:problema:sesion_expirada')
    })

    test('expira por inactividad: 401 sesion_expirada y borra la cookie', async ({ client, assert }) => {
        const { cookie, inicio } = await loginPanel(client)

        fijarReloj(new Date(inicio.getTime() + 12 * HORA + 1_000))
        const r = await estado(me(client, cookie), 401)
        assert.equal(r.header('content-type')?.split(';')[0], 'application/problem+json')
        assert.equal(r.body().type, 'urn:argosisp:problema:sesion_expirada')
        const borrada = cookieSesion(r.header('set-cookie'))
        assert.isNotNull(borrada)
        assert.equal(borrada!.valor, '')

        // tras una renovación, vence 12 h después de la última petición que renovó
        const otra = await loginPanel(client)
        fijarReloj(new Date(otra.inicio.getTime() + 5 * HORA))
        await estado(me(client, otra.cookie), 200)
        fijarReloj(new Date(otra.inicio.getTime() + 17 * HORA - 1_000))
        await estado(me(client, otra.cookie), 200)
        fijarReloj(new Date(otra.inicio.getTime() + 29 * HORA))
        const r2 = await estado(me(client, otra.cookie), 401)
        assert.equal(r2.body().type, 'urn:argosisp:problema:sesion_expirada')
    })

    test('no escribe en la base de datos en cada petición: solo al pasar el umbral de 15 min', async ({
        client,
        assert,
    }) => {
        const { cookie, valor, inicio, fila: alLogin } = await loginPanel(client)
        assert.isNull(alLogin.last_used_at)

        for (const minutos of [1, 5, 10, 14]) {
            fijarReloj(new Date(inicio.getTime() + minutos * MIN))
            const r = await estado(me(client, cookie), 200)
            assert.isNull(cookieSesion(r.header('set-cookie')), `sin cookie nueva a los ${minutos} min`)
        }
        const sinCambios = await filaDe(valor)
        assert.deepEqual(
            [sinCambios.expires_at, sinCambios.last_used_at, sinCambios.updated_at],
            [alLogin.expires_at, alLogin.last_used_at, alLogin.updated_at],
        )

        const t = new Date(inicio.getTime() + 16 * MIN)
        fijarReloj(t)
        const r = await estado(me(client, cookie), 200)
        assert.isNotNull(cookieSesion(r.header('set-cookie')))
        const renovada = await filaDe(valor)
        assert.equal(new Date(renovada.expires_at!).getTime(), t.getTime() + 12 * HORA)
        assert.equal(new Date(renovada.last_used_at!).getTime(), t.getTime())
    })

    test('reglas puras: umbral, tope y configuración', ({ assert }) => {
        const cfg = configSesionPanel({})
        assert.deepEqual(cfg, { inactividadMs: 12 * HORA, maximaMs: 72 * HORA, umbralMs: 15 * MIN })
        // umbral = 10 % de la ventana con mínimo de 1 min
        assert.equal(configSesionPanel({ PANEL_SESION_INACTIVIDAD_H: '1' }).umbralMs, 6 * MIN)
        assert.equal(configSesionPanel({ PANEL_SESION_INACTIVIDAD_H: '0.05' }).umbralMs, MIN)
        // la inactividad nunca supera el tope; valores inválidos usan el por defecto
        assert.equal(configSesionPanel({ PANEL_SESION_INACTIVIDAD_H: '100' }).inactividadMs, 72 * HORA)
        assert.equal(configSesionPanel({ PANEL_SESION_MAXIMA_H: 'x' }).maximaMs, 72 * HORA)
        assert.equal(configSesionPanel({ PANEL_SESION_MAXIMA_H: '168' }).maximaMs, 168 * HORA)

        const creadaEn = new Date('2026-10-17T00:00:00Z')
        const en = (h: number) => new Date(creadaEn.getTime() + h * HORA)
        // si el tope baja por configuración, la sesión se acorta en la siguiente petición
        const acortada = decidirRenovacion({ creadaEn, expiraEn: en(30) }, en(20), {
            ...cfg,
            maximaMs: 24 * HORA,
        })
        assert.deepInclude(acortada, { estado: 'vigente', renovar: true })
        assert.equal(acortada.estado === 'vigente' && acortada.expiraEn.getTime(), en(24).getTime())
        // al acercarse al tope renueva una última vez aunque falte menos del umbral
        const ultima = decidirRenovacion({ creadaEn, expiraEn: en(71.9) }, en(70), cfg)
        assert.deepInclude(ultima, { estado: 'vigente', renovar: true, expiraEn: en(72) })
        assert.deepEqual(decidirRenovacion({ creadaEn, expiraEn: en(72) }, en(72), cfg), {
            estado: 'expirada',
        })
    })
})

test.group('Sesión del panel deslizante: Bearer intacto', (group) => {
    group.each.teardown(() => {
        relojSesion.ahora = relojReal
    })

    test('un Bearer de login no se renueva ni recibe cookie', async ({ client, assert }) => {
        const { usuario, password } = await usuarioConRoles(['admin'])
        const login = await estado(
            client.post('/api/v1/auth/login').json({ email: usuario.email, password }),
            200,
        )
        const token = login.body().token as string
        const antes = await filaDe(token)
        assert.notEqual(antes.name, NOMBRE_TOKEN_PANEL)

        fijarReloj(new Date(new Date(antes.created_at).getTime() + 11 * HORA))
        const r = await estado(client.get('/api/v1/me').bearerToken(token), 200)
        assert.isNull(cookieSesion(r.header('set-cookie')))
        assert.equal(new Date(r.body().expira_en).getTime(), new Date(antes.expires_at!).getTime())
        assert.equal(r.body().expira_max_en, r.body().expira_en)
        assert.notProperty(r.body(), 'csrf')

        const despues = await filaDe(token)
        assert.equal(new Date(despues.expires_at!).getTime(), new Date(antes.expires_at!).getTime())
    })

    test('un token Bearer de login puesto en la cookie tampoco se desliza', async ({ client, assert }) => {
        const { usuario, password } = await usuarioConRoles(['admin'])
        const login = await estado(
            client.post('/api/v1/auth/login').json({ email: usuario.email, password }),
            200,
        )
        const token = login.body().token as string
        const antes = await filaDe(token)

        fijarReloj(new Date(new Date(antes.created_at).getTime() + 6 * HORA))
        const r = await estado(me(client, `argos_sesion=${token}`), 200)
        assert.isNull(cookieSesion(r.header('set-cookie')))
        assert.equal(r.body().expira_max_en, r.body().expira_en)
        const despues = await filaDe(token)
        assert.equal(new Date(despues.expires_at!).getTime(), new Date(antes.expires_at!).getTime())
    })

    test('un token de API (atk_) responde expira_en null', async ({ client, assert }) => {
        const { usuario, password } = await usuarioConRoles(['admin'])
        const login = await estado(
            client.post('/api/v1/auth/login').json({ email: usuario.email, password }),
            200,
        )
        const creado = await estado(
            client
                .post('/api/v1/tokens')
                .bearerToken(login.body().token)
                .json({ usuario_id: usuario.id, nombre: unico('Token deslizante') }),
            201,
        )
        const r = await estado(client.get('/api/v1/me').bearerToken(creado.body().token), 200)
        assert.isNull(r.body().expira_en)
        assert.isNull(r.body().expira_max_en)
    })
})
