import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { estado, usuarioConRoles } from '#tests/ayudas'
import { TEMAS, verApariencia } from '#core/apariencia'

/** Apariencia de la instalación (contrato `.claude/integration/contratos/apariencia.md`). */

const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
)
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46])

async function restablecer() {
    await db.from('core.apariencia').where('id', 1).update({
        tema: 'indigo',
        modo_predeterminado: 'sistema',
        nombre_marca: 'ArgosIsp',
        eslogan: null,
        logo_login: null,
        logo_login_tipo: null,
        logo_login_tamano: null,
        logo_login_etag: null,
        fondo_login: null,
        fondo_login_tipo: null,
        fondo_login_tamano: null,
        fondo_login_etag: null,
        version: 1,
    })
}

function luminancia(hex: string): number {
    const c = [1, 3, 5]
        .map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
}
function contraste(a: string, b: string): number {
    const [x, y] = [luminancia(a), luminancia(b)]
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

test.group('Apariencia', (group) => {
    group.each.setup(restablecer)
    group.teardown(restablecer)

    test('los presets cumplen AA contra blanco y contra el fondo oscuro #0B0F1A', ({ assert }) => {
        for (const t of TEMAS) {
            assert.isAtLeast(contraste(t.claro, '#FFFFFF'), 4.5, `${t.id} claro`)
            assert.isAtLeast(contraste(t.oscuro, '#0B0F1A'), 4.5, `${t.id} oscuro`)
        }
    })

    test('pública sin token, con ETag y 304; por defecto índigo', async ({ client, assert }) => {
        const r = await estado(client.get('/api/v1/apariencia/publica'), 200)
        assert.deepEqual(r.body(), {
            tema: 'indigo',
            paleta: { color: 'indigo', claro: '#4F46E5', oscuro: '#818CF8' },
            modo_predeterminado: 'sistema',
            nombre_marca: 'ArgosIsp',
            eslogan: null,
            logo_login_url: null,
            fondo_login_url: null,
            version: 1,
        })
        const etag = r.header('etag') ?? ''
        assert.equal(etag, '"apariencia-1"')
        assert.equal(r.header('cache-control'), 'no-cache')
        const cache = await client.get('/api/v1/apariencia/publica').header('If-None-Match', etag)
        cache.assertStatus(304)
    })

    test('editar: cambia lo enviado, diff en audit.cambios, 409 con versión vieja, sin cambios no sube', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const r = await estado(
            client.put('/api/v1/apariencia').bearerToken(token).json({
                version: 1,
                tema: 'esmeralda',
                modo_predeterminado: 'oscuro',
                eslogan: '  Internet que sí llega ',
            }),
            200,
        )
        assert.include(r.body(), {
            tema: 'esmeralda',
            modo_predeterminado: 'oscuro',
            eslogan: 'Internet que sí llega',
            version: 2,
        })
        assert.deepEqual(r.body().paleta, { color: 'emerald', claro: '#047857', oscuro: '#34D399' })
        assert.lengthOf(r.body().temas, 7)

        const cambios = await db
            .from('audit.cambios')
            .where('entidad_tipo', 'apariencia')
            .where('entidad_id', 1)
            .orderBy('id', 'desc')
            .limit(3)
            .select('campo', 'antes', 'despues')
        assert.sameMembers(
            cambios.map((c) => c.campo),
            ['tema', 'modo_predeterminado', 'eslogan'],
        )

        await estado(
            client.put('/api/v1/apariencia').bearerToken(token).json({ version: 1, tema: 'rosa' }),
            409,
        )
        const igual = await estado(
            client.put('/api/v1/apariencia').bearerToken(token).json({ version: 2, tema: 'esmeralda' }),
            200,
        )
        assert.equal(igual.body().version, 2)
        const sinEslogan = await estado(
            client.put('/api/v1/apariencia').bearerToken(token).json({ version: 2, eslogan: '' }),
            200,
        )
        assert.isNull(sinEslogan.body().eslogan)

        const invalido = await estado(
            client.put('/api/v1/apariencia').bearerToken(token).json({ version: 3, tema: 'verde' }),
            422,
        )
        assert.equal(invalido.body().errors[0].field, 'tema')
    })

    test('logo PNG: se sube, se sirve con ETag e immutable, 304, versión vieja 409 y se quita', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const subida = await estado(
            client
                .post('/api/v1/apariencia/logo-login')
                .bearerToken(token)
                .field('version', '1')
                .file('archivo', PNG, { filename: 'x.png' }),
            200,
        )
        const url: string = subida.body().logo_login_url
        assert.match(url, /^\/api\/v1\/apariencia\/archivos\/logo-login-[0-9a-f]{16}\.png$/)
        assert.include(subida.body().logo_login, { tipo: 'image/png', tamano: PNG.length })
        assert.equal(subida.body().version, 2)

        const publica = await estado(client.get('/api/v1/apariencia/publica'), 200)
        assert.equal(publica.body().logo_login_url, url)

        const archivo = await estado(client.get(url), 200)
        assert.equal(archivo.header('content-type'), 'image/png')
        assert.include(archivo.header('cache-control') ?? '', 'immutable')
        const etag = archivo.header('etag') ?? ''
        assert.equal(etag, `"${subida.body().logo_login.etag}"`)
        const cache = await client.get(url).header('If-None-Match', etag)
        cache.assertStatus(304)
        // un nombre que no es el vigente: 404
        await estado(client.get('/api/v1/apariencia/archivos/logo-login-0000000000000000.png'), 404)

        await estado(
            client
                .post('/api/v1/apariencia/logo-login')
                .bearerToken(token)
                .field('version', '1')
                .file('archivo', PNG, { filename: 'x.png' }),
            409,
        )
        // el logo no admite JPG
        const jpg = await estado(
            client
                .post('/api/v1/apariencia/logo-login')
                .bearerToken(token)
                .field('version', '2')
                .file('archivo', JPG, { filename: 'x.jpg' }),
            422,
        )
        assert.include(jpg.body().errors[0], { field: 'archivo', rule: 'tipo' })

        const quitada = await estado(
            client.post('/api/v1/apariencia/logo-login/quitar').bearerToken(token).json({ version: 2 }),
            200,
        )
        assert.isNull(quitada.body().logo_login_url)
        assert.equal(quitada.body().version, 3)
        await estado(client.get(url), 404)

        const acciones = await db
            .from('audit.acciones')
            .whereIn('accion', ['apariencia.subir_logo_login', 'apariencia.quitar_logo_login'])
            .where('created_at', '>', db.raw(`now() - interval '1 minute'`))
            .select('accion', 'resultado', 'entrada')
        assert.includeMembers(
            acciones.map((a) => `${a.accion}:${a.resultado}`),
            [
                'apariencia.subir_logo_login:ok',
                'apariencia.subir_logo_login:error',
                'apariencia.quitar_logo_login:ok',
            ],
        )
        for (const a of acciones) assert.notInclude(JSON.stringify(a.entrada), 'iVBOR')
    })

    test('SVG malicioso se sanea y se sirve con CSP; fondo JPG; fondo de más de 1.5 MB 422', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const malicioso = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)">
  <script>alert('xss')</script>
  <image href="https://evil.example/r.png" width="1" height="1"/>
  <rect width="10" height="10" style="fill:red" onclick="x()"/>
  <circle cx="5" cy="5" r="4" fill="#4F46E5"/>
</svg>`
        const subida = await estado(
            client
                .post('/api/v1/apariencia/logo-login')
                .bearerToken(token)
                .field('version', '1')
                .file('archivo', Buffer.from(malicioso), { filename: 'logo.svg' }),
            200,
        )
        assert.equal(subida.body().logo_login.tipo, 'image/svg+xml')
        const servido = await estado(client.get(subida.body().logo_login_url), 200)
        assert.include(servido.header('content-security-policy') ?? '', "default-src 'none'")
        const texto = servido.text() || Buffer.from(servido.body()).toString('utf8')
        for (const prohibido of ['script', 'onload', 'onclick', 'evil.example', 'style']) {
            assert.notInclude(texto.toLowerCase(), prohibido)
        }
        assert.include(texto, '<circle')

        const fondo = await estado(
            client
                .post('/api/v1/apariencia/fondo-login')
                .bearerToken(token)
                .field('version', '2')
                .file('archivo', JPG, { filename: 'f.jpg' }),
            200,
        )
        assert.match(fondo.body().fondo_login_url, /fondo-login-[0-9a-f]{16}\.jpg$/)
        assert.isNotNull(fondo.body().logo_login_url)

        const grande = Buffer.concat([PNG, Buffer.alloc(1537 * 1024)])
        const pesado = await estado(
            client
                .post('/api/v1/apariencia/fondo-login')
                .bearerToken(token)
                .field('version', '3')
                .file('archivo', grande, { filename: 'g.png' }),
            422,
        )
        assert.equal(pesado.body().errors[0].rule, 'tamano')
    })

    test('permisos: 401 sin sesión, 403 sin apariencia.editar; lectura puede ver', async ({ client }) => {
        await estado(client.get('/api/v1/apariencia'), 401)
        const cajero = await usuarioConRoles(['cajero'])
        await estado(client.get('/api/v1/apariencia').bearerToken(cajero.token), 403)
        const lectura = await usuarioConRoles(['lectura'])
        await estado(client.get('/api/v1/apariencia').bearerToken(lectura.token), 200)
        await estado(
            client.put('/api/v1/apariencia').bearerToken(lectura.token).json({ version: 1, tema: 'rosa' }),
            403,
        )
        await estado(
            client
                .post('/api/v1/apariencia/logo-login/quitar')
                .bearerToken(lectura.token)
                .json({ version: 1 }),
            403,
        )
    })

    test('lectura y edición con los privilegios de la API (argosisp_app)', async ({ assert }) => {
        const trx: TransactionClientContract = await db.transaction()
        try {
            await trx.rawQuery('SET LOCAL ROLE argosisp_app')
            const a = await verApariencia(trx)
            assert.equal(a.tema, 'indigo')
            await trx.from('core.apariencia').where('id', 1).update({ tema: 'azul' })
            await trx.from('core.accesos_rapidos').select('*').limit(1)
            await trx.from('core.almacenamiento_mediciones').select('id').limit(1)
        } finally {
            await trx.rollback()
        }
    })
})
