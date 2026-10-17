import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { sanearSvg, SvgInvalido } from '#core/svg'

/**
 * Multiempresa, tarea 1: `core.empresas` (CRUD, NIT único entre activas, logo PNG o SVG saneado
 * servido con ETag) y la empresa 1 migrada desde `core.empresa`.
 */

/** NIT válido (módulo 11) a partir de un cuerpo de 7 dígitos. */
export function nitValidoDe(cuerpo: string): string {
    let factor = cuerpo.length + 1
    let total = 0
    for (const c of cuerpo) {
        total += Number(c) * factor
        factor--
    }
    const modulo = (11 - (total % 11)) % 11
    return `${cuerpo}${modulo === 10 ? 'K' : modulo}`
}

export function nitAleatorio(): string {
    return nitValidoDe(String(Math.floor(1_000_000 + Math.random() * 8_999_999)))
}

const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
)

test.group('Empresas: core.empresas', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('la empresa 1 existe tras la migración y es la principal', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const lista = await estado(client.get('/api/v1/empresas').bearerToken(token), 200)
        const principal = lista.body().find((e: { id: number }) => e.id === 1)
        assert.include(principal, { id: 1, principal: true, activa: true })
        assert.isNull(principal.logo_url)
    })

    test('crear, editar con version (409) y desactivar con auditoría', async ({ client, assert }) => {
        const { token, usuario } = await usuarioConRoles(['admin'])
        const nit = nitAleatorio()
        const creada = await estado(
            client
                .post('/api/v1/empresas')
                .bearerToken(token)
                .json({
                    nit: `${nit.slice(0, -1)}-${nit.slice(-1)}`,
                    razon_social: 'Telecomunicaciones del Norte, S.A.',
                    nombre_comercial: unico('Norte'),
                    color_marca: '#0e7c86',
                    regimen_isr: 'sujeto_pagos_trimestrales',
                    codigo_establecimiento: 2,
                }),
            201,
        )
        const empresa = creada.body()
        assert.include(empresa, { nit, activa: true, principal: false, version: 1, color_marca: '#0E7C86' })

        const accion = await db
            .from('audit.acciones')
            .where('accion', 'empresas.crear')
            .where('entidad_id', empresa.id)
            .firstOrFail()
        assert.include(accion, { resultado: 'ok', actor_id: usuario.id, entidad_tipo: 'empresa' })

        // NIT repetido entre activas: 409
        await estado(
            client.post('/api/v1/empresas').bearerToken(token).json({
                nit,
                razon_social: 'Otra',
                nombre_comercial: 'Otra',
            }),
            409,
        )
        // NIT inválido: 422
        await estado(
            client
                .post('/api/v1/empresas')
                .bearerToken(token)
                .json({ nit: '1234567-0', razon_social: 'X', nombre_comercial: 'X' }),
            422,
        )

        const editada = await estado(
            client
                .put(`/api/v1/empresas/${empresa.id}`)
                .bearerToken(token)
                .json({ version: 1, municipio: 'Huehuetenango', telefono: '7764-0000' }),
            200,
        )
        assert.include(editada.body(), { version: 2, municipio: 'Huehuetenango' })
        await estado(
            client
                .put(`/api/v1/empresas/${empresa.id}`)
                .bearerToken(token)
                .json({ version: 1, municipio: 'Tarde' }),
            409,
        )
        const cambios = await db
            .from('audit.cambios')
            .where('entidad_tipo', 'empresa')
            .where('entidad_id', empresa.id)
            .select('campo')
        assert.includeMembers(
            cambios.map((c) => c.campo),
            ['municipio', 'telefono', 'nit', 'razon_social'],
        )

        const desactivada = await estado(
            client
                .post(`/api/v1/empresas/${empresa.id}/desactivar`)
                .bearerToken(token)
                .json({ version: 2, motivo: 'Fusión con la principal' }),
            200,
        )
        assert.isFalse(desactivada.body().activa)
        // su NIT queda libre para una empresa activa
        await estado(
            client
                .post('/api/v1/empresas')
                .bearerToken(token)
                .json({
                    nit,
                    razon_social: 'Sucesora',
                    nombre_comercial: unico('Sucesora'),
                }),
            201,
        )
        const activas = await estado(client.get('/api/v1/empresas?activas=true').bearerToken(token), 200)
        assert.notInclude(
            activas.body().map((e: { id: number }) => e.id),
            empresa.id,
        )
    })

    test('la empresa principal no se desactiva; sin permiso 403', async ({ client }) => {
        const { token } = await usuarioConRoles(['admin'])
        const principal = await estado(client.get('/api/v1/empresas/1').bearerToken(token), 200)
        await estado(
            client
                .post('/api/v1/empresas/1/desactivar')
                .bearerToken(token)
                .json({ version: Math.max(principal.body().version, 1), motivo: 'no se puede' }),
            422,
        )
        const cajero = await usuarioConRoles(['cajero'])
        await estado(
            client
                .post('/api/v1/empresas')
                .bearerToken(cajero.token)
                .json({ nit: nitAleatorio(), razon_social: 'X', nombre_comercial: 'X' }),
            403,
        )
        await estado(client.get('/api/v1/empresas').bearerToken(cajero.token), 403)
    })
})

test.group('Empresas: logo', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('PNG: se sube, se sirve con ETag, 304 con If-None-Match y se quita', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const creada = await estado(
            client
                .post('/api/v1/empresas')
                .bearerToken(token)
                .json({ nit: nitAleatorio(), razon_social: 'Logo S.A.', nombre_comercial: unico('Logo') }),
            201,
        )
        const id = creada.body().id

        // sin logo: 404 público
        await estado(client.get(`/api/v1/empresas/${id}/logo`), 404)

        const subida = await estado(
            client
                .post(`/api/v1/empresas/${id}/logo`)
                .bearerToken(token)
                .field('version', '1')
                .file('logo', PNG, { filename: 'logo.png' }),
            200,
        )
        assert.include(subida.body(), { logo_tipo: 'image/png', version: 2 })
        assert.match(subida.body().logo_url, new RegExp(`^/api/v1/empresas/${id}/logo\\?v=`))

        const logo = await estado(client.get(`/api/v1/empresas/${id}/logo`), 200)
        assert.equal(logo.header('content-type'), 'image/png')
        const etag = logo.header('etag') ?? ''
        assert.match(etag, /^"[0-9a-f]{64}"$/)
        assert.include(logo.header('cache-control') ?? '', 'max-age')

        const cache = await client.get(`/api/v1/empresas/${id}/logo`).header('If-None-Match', etag)
        cache.assertStatus(304)

        // versión vieja: 409
        await estado(
            client
                .post(`/api/v1/empresas/${id}/logo`)
                .bearerToken(token)
                .field('version', '1')
                .file('logo', PNG, { filename: 'logo.png' }),
            409,
        )

        const quitada = await estado(
            client
                .post(`/api/v1/empresas/${id}/logo`)
                .bearerToken(token)
                .field('version', '2')
                .field('quitar', 'true'),
            200,
        )
        assert.isNull(quitada.body().logo_url)
        await estado(client.get(`/api/v1/empresas/${id}/logo`), 404)

        const acciones = await db
            .from('audit.acciones')
            .where('accion', 'empresas.cambiar_logo')
            .where('entidad_id', id)
            .select('resultado')
        assert.deepEqual(acciones.map((a) => a.resultado).sort(), ['error', 'ok', 'ok'])
    })

    test('SVG con script se sanea; otro tipo o más de 512 KB se rechaza', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const creada = await estado(
            client
                .post('/api/v1/empresas')
                .bearerToken(token)
                .json({ nit: nitAleatorio(), razon_social: 'Svg S.A.', nombre_comercial: unico('Svg') }),
            201,
        )
        const id = creada.body().id
        const malicioso = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" onload="alert(1)">
  <script>alert('xss')</script>
  <style>@import url(https://evil.example/x.css);</style>
  <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hola</div></foreignObject>
  <a href="javascript:alert(1)"><rect width="5" height="5"/></a>
  <image href="https://evil.example/rastreo.png" width="1" height="1"/>
  <use xlink:href="https://evil.example/s.svg#a"/>
  <rect width="10" height="10" fill="url(https://evil.example/p)" style="fill:red" onclick="x()"/>
  <circle cx="5" cy="5" r="4" fill="#0E7C86"/>
</svg>`
        const subida = await estado(
            client
                .post(`/api/v1/empresas/${id}/logo`)
                .bearerToken(token)
                .field('version', '1')
                .file('logo', Buffer.from(malicioso), { filename: 'logo.svg' }),
            200,
        )
        assert.equal(subida.body().logo_tipo, 'image/svg+xml')

        const servido = await estado(client.get(`/api/v1/empresas/${id}/logo`), 200)
        assert.include(servido.header('content-type') ?? '', 'image/svg+xml')
        assert.include(servido.header('content-security-policy') ?? '', "default-src 'none'")
        const texto = servido.text() || Buffer.from(servido.body()).toString('utf8')
        for (const prohibido of [
            'script',
            'onload',
            'onclick',
            'javascript',
            'evil.example',
            'foreignObject',
            'style',
        ]) {
            assert.notInclude(texto.toLowerCase(), prohibido.toLowerCase())
        }
        assert.include(texto, '<circle cx="5" cy="5" r="4" fill="#0E7C86"/>')

        // DOCTYPE con entidades (XXE): 422
        const xxe = `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>`
        const rechazo = await estado(
            client
                .post(`/api/v1/empresas/${id}/logo`)
                .bearerToken(token)
                .field('version', '2')
                .file('logo', Buffer.from(xxe), { filename: 'x.svg' }),
            422,
        )
        assert.equal(rechazo.body().errors[0].field, 'logo')

        // JPG (ni PNG ni SVG): 422
        await estado(
            client
                .post(`/api/v1/empresas/${id}/logo`)
                .bearerToken(token)
                .field('version', '2')
                .file('logo', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), { filename: 'x.jpg' }),
            422,
        )
        // más de 512 KB: 422
        const grande = Buffer.concat([PNG, Buffer.alloc(513 * 1024)])
        const pesado = await estado(
            client
                .post(`/api/v1/empresas/${id}/logo`)
                .bearerToken(token)
                .field('version', '2')
                .file('logo', grande, { filename: 'g.png' }),
            422,
        )
        assert.equal(pesado.body().errors[0].rule, 'tamano')
    })

    test('sanearSvg: estructura válida, raíz svg y sin referencias externas', ({ assert }) => {
        assert.equal(
            sanearSvg('<svg viewBox="0 0 1 1"><g><path d="M0 0h1"/></g></svg>'),
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><g><path d="M0 0h1"/></g></svg>',
        )
        assert.equal(
            sanearSvg('<svg xmlns="http://www.w3.org/2000/svg"><use href="#a"/><rect fill="url(#g)"/></svg>'),
            '<svg xmlns="http://www.w3.org/2000/svg"><use href="#a"/><rect fill="url(#g)"/></svg>',
        )
        assert.equal(
            sanearSvg('<svg><rect fill="url(&#x68;ttp://x)" href="&#x6a;avascript:1"/></svg>'),
            '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
        )
        assert.equal(
            sanearSvg('<svg><text>a &lt; b <script>x</script></text></svg>'),
            '<svg xmlns="http://www.w3.org/2000/svg"><text>a &lt; b </text></svg>',
        )
        for (const malo of [
            '<html><svg/></html>',
            '<svg><g></svg>',
            '<svg><![CDATA[x]]></svg>',
            '<svg></svg><svg></svg>',
            'texto',
        ]) {
            assert.throws(() => sanearSvg(malo), SvgInvalido)
        }
    })
})
