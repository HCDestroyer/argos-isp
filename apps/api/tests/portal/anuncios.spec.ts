import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { crearEmpresaFila } from '#tests/core/fabricas'
import { crearServicio, crearSesion, sesionDirecta } from '#tests/portal/ayudas_portal'
import { programaConReglas } from '#tests/lealtad/ayudas_lealtad'
import AjustarPuntos from '#lealtad/actions/ajustar_puntos'
import { audienciaAplica, urlBotonValida } from '#portal/anuncios'
import { prepararImagenAnuncio } from '#portal/anuncios_imagenes'

/**
 * Anuncios del portal (contrato `anuncios.md`) contra Postgres real: CRUD del panel con versión,
 * acciones explícitas y auditoría, imagen validada por firma, audiencia y vigencia en el portal,
 * métricas idempotentes sin datos personales.
 */

/** PNG de `ancho`×`alto`: firma + IHDR (lo que leen la validación y el portal). */
function png(ancho: number, alto: number): Buffer {
    const ihdr = Buffer.alloc(25)
    ihdr.writeUInt32BE(13, 0)
    ihdr.write('IHDR', 4, 'latin1')
    ihdr.writeUInt32BE(ancho, 8)
    ihdr.writeUInt32BE(alto, 12)
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        ihdr,
        Buffer.alloc(16),
    ])
}

/** JPEG mínimo con SOF0 de `ancho`×`alto`. */
function jpeg(ancho: number, alto: number): Buffer {
    const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00])
    const sof = Buffer.alloc(11)
    sof.writeUInt16BE(0xffc0, 0)
    sof.writeUInt16BE(9, 2)
    sof[4] = 8
    sof.writeUInt16BE(alto, 5)
    sof.writeUInt16BE(ancho, 7)
    return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(8)])
}

const VARIABLES = ['PORTAL_PROXIES_CONFIABLES', 'PORTAL_REDIS_PREFIJO', 'PORTAL_LIMITE_PETICIONES'] as const

function entorno() {
    const previo = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
    process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1'
    process.env.PORTAL_REDIS_PREFIJO = unico('prueba-anuncios')
    delete process.env.PORTAL_LIMITE_PETICIONES
    return () => {
        for (const v of VARIABLES) {
            if (previo[v] === undefined) delete process.env[v]
            else process.env[v] = previo[v]
        }
    }
}

let ipSecuencia = 0
function ipNueva(): string {
    ipSecuencia += 1
    return `198.51.110.${(ipSecuencia % 250) + 1}`
}

/** Crea y (si se pide) publica un anuncio por la API, en la empresa `empresaId`. */
async function anuncio(
    client: ApiClient,
    token: string,
    datos: Record<string, unknown>,
    opciones: { publicar?: boolean; empresaId?: number } = {},
) {
    const empresa = String(opciones.empresaId ?? 1)
    const creado = await estado(
        client
            .post('/api/v1/anuncios')
            .bearerToken(token)
            .header('X-Empresa-Id', empresa)
            .json({ titulo: unico('Promo'), lugares: ['pagina_corte', 'portal_inicio'], ...datos }),
        201,
    )
    if (!opciones.publicar) return creado.body()
    const publicado = await estado(
        client
            .post(`/api/v1/anuncios/${creado.body().id}/publicar`)
            .bearerToken(token)
            .header('X-Empresa-Id', empresa)
            .json({ version: creado.body().version }),
        200,
    )
    return publicado.body()
}

test.group('Anuncios: reglas sin base de datos', () => {
    test('URL del botón: http(s) o ruta del portal; nunca javascript:, data:, // ni credenciales', ({
        assert,
    }) => {
        for (const ok of ['https://argos.example/promo', 'http://argos.example', '/cuenta', '/corte#pagar']) {
            assert.isTrue(urlBotonValida(ok), ok)
        }
        for (const malo of [
            'javascript:alert(1)',
            'data:text/html,hola',
            '//malo.example',
            '/\\malo.example',
            'https://usuario:clave@malo.example',
            'ftp://archivos.example',
            'https:// espacio.example',
            'cuenta',
            '',
        ]) {
            assert.isFalse(urlBotonValida(malo), malo)
        }
    })

    test('audiencia: todos, suspendidos, al día y con puntos', ({ assert }) => {
        const base = { empresaId: 1, suspendido: false, conVencidas: false, puntos: 0 }
        assert.isTrue(audienciaAplica('todos', base))
        assert.isTrue(audienciaAplica('al_dia', base))
        assert.isFalse(audienciaAplica('al_dia', { ...base, conVencidas: true }))
        assert.isFalse(audienciaAplica('al_dia', { ...base, suspendido: true }))
        assert.isTrue(audienciaAplica('suspendidos', { ...base, suspendido: true }))
        assert.isFalse(audienciaAplica('suspendidos', base))
        assert.isTrue(audienciaAplica('con_puntos', { ...base, puntos: 1 }))
        assert.isFalse(audienciaAplica('con_puntos', base))
    })

    test('imagen: PNG y JPEG por firma con su tamaño; lo demás, 422', ({ assert }) => {
        assert.deepInclude(prepararImagenAnuncio(png(800, 400)), { tipo: 'image/png', ancho: 800, alto: 400 })
        assert.deepInclude(prepararImagenAnuncio(jpeg(640, 360)), {
            tipo: 'image/jpeg',
            ancho: 640,
            alto: 360,
        })
        for (const malo of [
            Buffer.from('GIF89a-no-soportado-aqui-0000000000'),
            Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
            png(10, 10),
            png(5000, 100),
            Buffer.alloc(0),
        ]) {
            assert.throws(() => prepararImagenAnuncio(malo))
        }
        assert.throws(() => prepararImagenAnuncio(Buffer.concat([png(100, 100), Buffer.alloc(1024 * 1024)])))
    })
})

test.group('Anuncios: panel', (group) => {
    group.each.setup(() => soloEmpresaPrincipal())

    test('crear, editar con versión, publicar y archivar, con auditoría y diff', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const creado = await estado(
            client
                .post('/api/v1/anuncios')
                .bearerToken(token)
                .json({
                    titulo: 'Mes de la fibra',
                    texto: 'Duplica tu velocidad\nsin costo por 3 meses',
                    boton_texto: 'Ver más',
                    boton_url: '/cuenta',
                    audiencia: 'al_dia',
                    lugares: ['portal_inicio'],
                }),
            201,
        )
        const a = creado.body()
        assert.containsSubset(a, {
            empresa_id: 1,
            estado: 'borrador',
            vigente: false,
            boton: { texto: 'Ver más', url: '/cuenta' },
            imagen: null,
            audiencia: 'al_dia',
            lugares: ['portal_inicio'],
            version: 1,
        })

        const editado = await estado(
            client
                .put(`/api/v1/anuncios/${a.id}`)
                .bearerToken(token)
                .json({ version: 1, titulo: 'Mes de la fibra 2x', boton_texto: null, boton_url: null }),
            200,
        )
        assert.equal(editado.body().titulo, 'Mes de la fibra 2x')
        assert.isNull(editado.body().boton)
        assert.equal(editado.body().version, 2)
        await estado(
            client.put(`/api/v1/anuncios/${a.id}`).bearerToken(token).json({ version: 1, titulo: 'viejo' }),
            409,
        )

        const publicado = await estado(
            client.post(`/api/v1/anuncios/${a.id}/publicar`).bearerToken(token).json({ version: 2 }),
            200,
        )
        assert.equal(publicado.body().estado, 'publicado')
        assert.isTrue(publicado.body().vigente)
        assert.isNotNull(publicado.body().publicado_en)

        const archivado = await estado(
            client.post(`/api/v1/anuncios/${a.id}/archivar`).bearerToken(token).json({ version: 3 }),
            200,
        )
        assert.equal(archivado.body().estado, 'archivado')
        assert.isFalse(archivado.body().vigente)
        const r = await estado(
            client.put(`/api/v1/anuncios/${a.id}`).bearerToken(token).json({ version: 4, titulo: 'x' }),
            422,
        )
        assert.equal(r.body().type, 'urn:argosisp:problema:anuncio_archivado')

        const acciones = await db
            .from('audit.acciones')
            .where('entidad_tipo', 'anuncio')
            .where('entidad_id', a.id)
            .where('resultado', 'ok')
            .orderBy('id')
            .select('accion')
        assert.deepEqual(
            acciones.map((x) => x.accion),
            ['anuncios.crear', 'anuncios.editar', 'anuncios.publicar', 'anuncios.archivar'],
        )
        const estados = await db
            .from('audit.cambios')
            .where('entidad_tipo', 'anuncio')
            .where('entidad_id', a.id)
            .where('campo', 'estado')
            .orderBy('id')
        assert.deepEqual(
            estados.map((c) => [c.antes, c.despues]),
            [
                [null, 'borrador'],
                ['borrador', 'publicado'],
                ['publicado', 'archivado'],
            ],
        )

        const lista = await estado(client.get('/api/v1/anuncios?estado=archivado').bearerToken(token), 200)
        assert.isTrue(lista.body().data.some((x: { id: number }) => x.id === a.id))
    })

    test('422: botón incompleto o con URL peligrosa, fin antes del inicio, HTML no se interpreta', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        for (const [cuerpo, campo] of [
            [{ boton_texto: 'Ir' }, 'boton_url'],
            [{ boton_texto: 'Ir', boton_url: 'javascript:alert(1)' }, 'boton_url'],
            [{ boton_texto: 'Ir', boton_url: '//malo.example' }, 'boton_url'],
            [{ inicio: '2026-11-10T00:00:00Z', fin: '2026-11-01T00:00:00Z' }, 'fin'],
            [{ lugares: [] }, 'lugares'],
            [{ audiencia: 'vip' }, 'audiencia'],
            [{ titulo: '' }, 'titulo'],
        ] as const) {
            const r = await estado(
                client
                    .post('/api/v1/anuncios')
                    .bearerToken(token)
                    .json({ titulo: 'T', ...cuerpo }),
                422,
            )
            assert.equal(r.body().errors[0].field, campo, JSON.stringify(cuerpo))
        }
        const conHtml = await estado(
            client
                .post('/api/v1/anuncios')
                .bearerToken(token)
                .json({ titulo: '<b>Hola</b>', texto: '<script>x</script>' }),
            201,
        )
        // se guarda tal cual: es texto plano y el portal lo pinta como texto (Vue escapa)
        assert.equal(conHtml.body().titulo, '<b>Hola</b>')
    })

    test('publicar con fin pasado: 422 anuncio_vencido', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const a = await anuncio(client, token, {
            inicio: '2020-01-01T00:00:00Z',
            fin: '2020-02-01T00:00:00Z',
        })
        const r = await estado(
            client.post(`/api/v1/anuncios/${a.id}/publicar`).bearerToken(token).json({ version: a.version }),
            422,
        )
        assert.equal(r.body().type, 'urn:argosisp:problema:anuncio_vencido')
    })

    test('imagen: sube PNG con alt, rechaza sin alt o con otro tipo, y la sirve con ETag', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const a = await anuncio(client, token, {})
        const sinAlt = await estado(
            client
                .post(`/api/v1/anuncios/${a.id}/imagen`)
                .bearerToken(token)
                .field('version', String(a.version))
                .file('imagen', png(800, 400), { filename: 'promo.png' }),
            422,
        )
        assert.equal(sinAlt.body().errors[0].field, 'alt')
        const gif = await estado(
            client
                .post(`/api/v1/anuncios/${a.id}/imagen`)
                .bearerToken(token)
                .field('version', String(a.version))
                .field('alt', 'Router nuevo')
                .file('imagen', Buffer.from('GIF89a-no-soportado-aqui-0000000000'), { filename: 'x.png' }),
            422,
        )
        assert.equal(gif.body().errors[0].field, 'imagen')

        const conImagen = await estado(
            client
                .post(`/api/v1/anuncios/${a.id}/imagen`)
                .bearerToken(token)
                .field('version', String(a.version))
                .field('alt', 'Router wifi 6 sobre una mesa')
                .file('imagen', png(800, 400), { filename: 'promo.png' }),
            200,
        )
        const imagen = conImagen.body().imagen
        assert.containsSubset(imagen, {
            tipo: 'image/png',
            ancho: 800,
            alto: 400,
            alt: 'Router wifi 6 sobre una mesa',
        })
        assert.match(imagen.url, new RegExp(`^/api/v1/anuncios/${a.id}/imagen\\?v=[0-9a-f]{16}$`))
        const cambio = await db
            .from('audit.cambios')
            .where('entidad_tipo', 'anuncio')
            .where('entidad_id', a.id)
            .where('campo', 'imagen')
            .firstOrFail()
        assert.match(String(cambio.despues), /^[0-9a-f]{64}$/)

        const servida = await estado(client.get(imagen.url).bearerToken(token), 200)
        assert.equal(servida.header('content-type'), 'image/png')
        assert.equal(servida.header('x-content-type-options'), 'nosniff')
        const etag = String(servida.header('etag'))
        await estado(client.get(imagen.url).bearerToken(token).header('If-None-Match', etag), 304)
        // en el portal no se sirve mientras no esté publicado
        await estado(client.get(`/api/v1/portal/anuncios/${a.id}/imagen`), 404)

        const sinImagen = await estado(
            client
                .post(`/api/v1/anuncios/${a.id}/imagen`)
                .bearerToken(token)
                .field('version', String(conImagen.body().version))
                .field('quitar', 'true'),
            200,
        )
        assert.isNull(sinImagen.body().imagen)
    })

    test('permisos: lectura ve pero no administra; cajero y técnico no ven', async ({ client }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const a = await anuncio(client, admin, {})
        const { token: lectura } = await usuarioConRoles(['lectura'])
        await estado(client.get('/api/v1/anuncios').bearerToken(lectura), 200)
        await estado(client.get(`/api/v1/anuncios/${a.id}/metricas`).bearerToken(lectura), 200)
        await estado(client.post('/api/v1/anuncios').bearerToken(lectura).json({ titulo: 'x' }), 403)
        await estado(
            client.post(`/api/v1/anuncios/${a.id}/publicar`).bearerToken(lectura).json({ version: 1 }),
            403,
        )
        for (const rol of ['cajero', 'tecnico']) {
            const { token } = await usuarioConRoles([rol])
            await estado(client.get('/api/v1/anuncios').bearerToken(token), 403)
        }
        await estado(client.get('/api/v1/anuncios'), 401)
    })
})

test.group('Anuncios: portal', (group) => {
    group.each.setup(async () => {
        await soloEmpresaPrincipal()
        return entorno()
    })

    test('página de corte: solo publicados, vigentes y de su audiencia, en orden; sin identificar, nada', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const s = await crearServicio()
        const ip = ipNueva()
        await crearSesion(s, { ipv4: ip })

        const todos = await anuncio(client, token, { titulo: 'Para todos', orden: 0 }, { publicar: true })
        const suspendidos = await anuncio(
            client,
            token,
            { titulo: 'Paga y gana', audiencia: 'suspendidos', orden: 5 },
            { publicar: true },
        )
        await anuncio(client, token, { titulo: 'Al día', audiencia: 'al_dia' }, { publicar: true })
        await anuncio(client, token, { titulo: 'Con puntos', audiencia: 'con_puntos' }, { publicar: true })
        await anuncio(client, token, { titulo: 'Borrador' })
        await anuncio(
            client,
            token,
            { titulo: 'Solo inicio', lugares: ['portal_inicio'] },
            { publicar: true },
        )
        await anuncio(client, token, { titulo: 'Futuro', inicio: '2099-01-01T00:00:00Z' }, { publicar: true })
        const vencido = await anuncio(client, token, { titulo: 'Ya pasó' }, { publicar: true })
        await estado(
            client.put(`/api/v1/anuncios/${vencido.id}`).bearerToken(token).json({
                version: vencido.version,
                inicio: '2020-01-01T00:00:00Z',
                fin: '2020-01-02T00:00:00Z',
            }),
            200,
        )
        const archivado = await anuncio(client, token, { titulo: 'Archivado' }, { publicar: true })
        await estado(
            client
                .post(`/api/v1/anuncios/${archivado.id}/archivar`)
                .bearerToken(token)
                .json({ version: archivado.version }),
            200,
        )

        const r = await estado(
            client.get('/api/v1/portal/anuncios?lugar=pagina_corte').header('X-Forwarded-For', ip),
            200,
        )
        assert.deepEqual(
            r.body().data.map((x: { id: number }) => x.id),
            [suspendidos.id, todos.id],
        )
        assert.deepEqual(Object.keys(r.body().data[0]).sort(), [
            'boton',
            'empresa_id',
            'id',
            'imagen',
            'texto',
            'titulo',
        ])
        assert.equal(r.header('cache-control'), 'no-store')

        const nadie = await estado(
            client
                .get('/api/v1/portal/anuncios?lugar=pagina_corte')
                .header('X-Forwarded-For', '203.0.113.200'),
            200,
        )
        assert.deepEqual(nadie.body().data, [])
        await estado(client.get('/api/v1/portal/anuncios?lugar=otro').header('X-Forwarded-For', ip), 422)
    })

    test('inicio del portal con sesión: al día ve lo suyo; sin sesión, nada', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const s = await crearServicio({ estado: 'activo', sinFacturas: true })
        const alDia = await anuncio(
            client,
            token,
            { titulo: 'Gracias por pagar a tiempo', audiencia: 'al_dia', lugares: ['portal_inicio'] },
            { publicar: true },
        )
        await anuncio(
            client,
            token,
            { titulo: 'Solo suspendidos', audiencia: 'suspendidos', lugares: ['portal_inicio'] },
            { publicar: true },
        )
        const { cookie } = await sesionDirecta(s.clienteId)
        const r = await estado(
            client.get('/api/v1/portal/anuncios?lugar=portal_inicio').header('Cookie', cookie),
            200,
        )
        const ids = r.body().data.map((x: { id: number }) => x.id)
        assert.include(ids, alDia.id)
        assert.notInclude(
            r.body().data.map((x: { titulo: string }) => x.titulo),
            'Solo suspendidos',
        )
        const sinSesion = await estado(client.get('/api/v1/portal/anuncios?lugar=portal_inicio'), 200)
        assert.deepEqual(sinSesion.body().data, [])
    })

    test('multiempresa y con_puntos: cada cliente ve los de su empresa, y los de puntos si tiene', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const otra = await crearEmpresaFila()
        try {
            const s = await crearServicio({ empresaId: otra, sinFacturas: true, estado: 'activo' })
            const { cookie } = await sesionDirecta(s.clienteId)
            const deLaPrincipal = await anuncio(client, token, { titulo: 'De la 1' }, { publicar: true })
            const deLaOtra = await anuncio(
                client,
                token,
                { titulo: 'De la otra' },
                { publicar: true, empresaId: otra },
            )
            const puntos = await anuncio(
                client,
                token,
                { titulo: 'Canjea tus puntos', audiencia: 'con_puntos' },
                { publicar: true, empresaId: otra },
            )
            const leer = async () => {
                const r = await estado(
                    client.get('/api/v1/portal/anuncios?lugar=portal_inicio').header('Cookie', cookie),
                    200,
                )
                return r.body().data.map((x: { id: number }) => x.id)
            }

            let ids = await leer()
            assert.include(ids, deLaOtra.id)
            assert.notInclude(ids, deLaPrincipal.id)
            assert.notInclude(ids, puntos.id)

            await programaConReglas(otra, contextoPrueba())
            await new AjustarPuntos().execute(
                { empresa_id: otra, cliente_id: s.clienteId, puntos: 120, motivo: 'Prueba de anuncios' },
                contextoPrueba(),
            )
            ids = await leer()
            assert.include(ids, puntos.id)
        } finally {
            await soloEmpresaPrincipal()
        }
    })

    test('vistas y clics: idempotentes por visitante, sin auditoría por evento; métricas en el panel', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const s = await crearServicio()
        const ip = ipNueva()
        await crearSesion(s, { ipv4: ip })
        const a = await anuncio(client, token, { lugares: ['pagina_corte'] }, { publicar: true })
        const borrador = await anuncio(client, token, {})
        const evento = (id: number, cuerpo: Record<string, unknown>) =>
            client.post(`/api/v1/portal/anuncios/${id}/eventos`).header('X-Forwarded-For', ip).json(cuerpo)
        const v1 = '6f7e1c2a-1d4b-4b8a-9c3e-1a2b3c4d5e6f'
        const v2 = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'

        await estado(evento(a.id, { tipo: 'vista', visitante: v1, lugar: 'pagina_corte' }), 204)
        await estado(evento(a.id, { tipo: 'vista', visitante: v1, lugar: 'pagina_corte' }), 204)
        await estado(evento(a.id, { tipo: 'vista', visitante: v2, lugar: 'pagina_corte' }), 204)
        await estado(evento(a.id, { tipo: 'clic', visitante: v1, lugar: 'pagina_corte' }), 204)
        await estado(evento(a.id, { tipo: 'clic', visitante: v1, lugar: 'pagina_corte' }), 204)
        await estado(evento(a.id, { tipo: 'vista', visitante: 'no-uuid', lugar: 'pagina_corte' }), 422)
        await estado(evento(a.id, { tipo: 'vista', visitante: v1, lugar: 'portal_inicio' }), 404)
        await estado(evento(borrador.id, { tipo: 'vista', visitante: v1, lugar: 'pagina_corte' }), 404)

        const m = await estado(client.get(`/api/v1/anuncios/${a.id}/metricas`).bearerToken(token), 200)
        assert.containsSubset(m.body(), {
            anuncio_id: a.id,
            vistas: 2,
            clics: 1,
            por_lugar: [{ lugar: 'pagina_corte', vistas: 2, clics: 1 }],
        })
        assert.lengthOf(m.body().por_dia, 1)
        assert.match(m.body().por_dia[0].dia, /^\d{4}-\d{2}-\d{2}$/)

        const auditados = await db
            .from('audit.acciones')
            .where('accion', 'anuncios.registrar_evento')
            .where('entidad_id', a.id)
            .where('resultado', 'ok')
        assert.lengthOf(auditados, 0)
    })

    test('imagen del portal: solo de anuncios vigentes, mismo origen, con caché', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const s = await crearServicio()
        const ip = ipNueva()
        await crearSesion(s, { ipv4: ip })
        const a = await anuncio(client, token, { lugares: ['pagina_corte'] })
        await estado(
            client
                .post(`/api/v1/anuncios/${a.id}/imagen`)
                .bearerToken(token)
                .field('version', String(a.version))
                .field('alt', 'Familia viendo una película')
                .file('imagen', jpeg(1200, 600), { filename: 'promo.jpg' }),
            200,
        )
        await estado(
            client
                .post(`/api/v1/anuncios/${a.id}/publicar`)
                .bearerToken(token)
                .json({ version: a.version + 1 }),
            200,
        )
        const lista = await estado(
            client.get('/api/v1/portal/anuncios?lugar=pagina_corte').header('X-Forwarded-For', ip),
            200,
        )
        const visto = lista.body().data.find((x: { id: number }) => x.id === a.id)
        assert.containsSubset(visto.imagen, { ancho: 1200, alto: 600, alt: 'Familia viendo una película' })
        assert.match(
            visto.imagen.url,
            new RegExp(`^/api/v1/portal/anuncios/${a.id}/imagen\\?v=[0-9a-f]{16}$`),
        )
        const imagen = await estado(client.get(visto.imagen.url), 200)
        assert.equal(imagen.header('content-type'), 'image/jpeg')
        assert.include(imagen.header('cache-control'), 'public')
    })
})
