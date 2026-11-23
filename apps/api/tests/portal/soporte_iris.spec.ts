import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import { cifrar } from '#shared/cifrado'
import { estado, soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { crearServicio, nitAleatorio, sesionDirecta } from '#tests/portal/ayudas_portal'
import { generarToken, hashToken } from '#portal/acceso/codigos'
import {
    fijarConectorPortalIris,
    fijarFetchPortalIris,
    idSesionIris,
    type ConectorPortalIris,
} from '#portal/soporte/iris_portal'

/**
 * Soporte del portal con Iris (contrato Iris 0.9.0 §11, A30 y A31): Argos llama a Iris servidor a
 * servidor con el `token_portal`, la empresa y la sesión del portal. Iris es un `fetch` falso que
 * guarda cada llamada; Postgres y Redis son reales.
 */

const VARIABLES = [
    'PORTAL_PROXIES_CONFIABLES',
    'PORTAL_REDIS_PREFIJO',
    'PORTAL_LIMITE_PETICIONES',
    'IRIS_TOKEN_PORTAL',
] as const
const TOKEN_PORTAL = `iris_pat_${'Pt7Rt8Lo'.repeat(5)}`
const TOKEN_PANEL = `iris_pat_${'Pn1Ln2Ko'.repeat(5)}`

interface Llamada {
    metodo: string
    url: string
    cabeceras: Record<string, string>
    cuerpo: unknown
}

let llamadas: Llamada[] = []
type Respuesta = {
    status: number
    cuerpo?: unknown
    cabeceras?: Record<string, string>
    binario?: Uint8Array
}
let responder: (l: Llamada) => Respuesta | 'caido' = () => ({ status: 500 })

const CAPACIDADES = { portal_argos: true, solicitudes_servicio: true, adjuntos_ticket: true }

function conector(parcial: Partial<ConectorPortalIris> = {}): () => Promise<ConectorPortalIris> {
    return async () => ({
        activo: true,
        urlBase: 'https://iris.example.test',
        tokenPanel: TOKEN_PANEL,
        tokenPortal: TOKEN_PORTAL,
        contrato: '0.9.0',
        ...parcial,
    })
}

function instalarIrisFalso() {
    llamadas = []
    fijarFetchPortalIris(async (url, init) => {
        const cabeceras = Object.fromEntries(new Headers(init?.headers).entries())
        let cuerpo: unknown = null
        if (init?.body instanceof FormData) {
            const partes: Record<string, unknown> = {}
            for (const [nombre, valor] of init.body.entries()) {
                const lista = (partes[nombre] as unknown[] | undefined) ?? []
                lista.push(
                    typeof valor === 'string'
                        ? valor
                        : {
                              nombre: valor.name,
                              tipo: valor.type,
                              tamano: valor.size,
                              texto: valor.type === 'application/json' ? await valor.text() : null,
                          },
                )
                partes[nombre] = lista
            }
            cuerpo = partes
        } else if (typeof init?.body === 'string') {
            cuerpo = JSON.parse(init.body)
        }
        const llamada = { metodo: init?.method ?? 'GET', url: String(url), cabeceras, cuerpo }
        llamadas.push(llamada)
        if (llamada.url.endsWith('/api/v1/integraciones/argosisp/estado')) {
            return Response.json({ capacidades: CAPACIDADES })
        }
        const r = responder(llamada)
        if (r === 'caido') throw new Error('ECONNREFUSED')
        if (r.binario) return new Response(r.binario, { status: r.status, headers: r.cabeceras })
        return new Response(r.cuerpo === undefined ? null : JSON.stringify(r.cuerpo), {
            status: r.status,
            headers: {
                'content-type': r.status >= 400 ? 'application/problem+json' : 'application/json',
                ...r.cabeceras,
            },
        })
    })
}

let ipSecuencia = 0
function ipNueva(): string {
    ipSecuencia += 1
    return `198.51.100.${(ipSecuencia % 250) + 1}`
}

function ticketIris(extra: Record<string, unknown> = {}) {
    return {
        id: 8812,
        numero: 'TK-008812',
        asunto: 'Sin internet desde la mañana',
        estado: 'abierto',
        categoria: { id: 3, codigo: 'sin_servicio', nombre: 'Sin servicio' },
        servicio_id: null,
        origen: 'portal_argos',
        afectado_por_incidente: false,
        puede_confirmar: false,
        resuelto_en: null,
        cerrado_en: null,
        version: 4,
        creado_en: '2026-11-21T14:03:11Z',
        actualizado_en: '2026-11-21T15:20:40Z',
        // lo que el portal nunca debe dejar pasar
        asignado_a: { id: 9, nombre: 'Ana López Pérez' },
        prioridad: 'alta',
        ...extra,
    }
}

async function clienteConSesion() {
    const s = await crearServicio({ nit: nitAleatorio(), sinFacturas: true, estado: 'activo' })
    const { cookie, sesionId } = await sesionDirecta(s.clienteId)
    return { ...s, cookie, sesionId }
}

/** Sesión de «Ver mi cuenta» en /corte (origen `corte`, con su servicio): método `ip`. */
async function sesionCorte(clienteId: number, servicioId: number) {
    const token = generarToken()
    const [fila] = await db
        .table('core.portal_sesiones')
        .insert({
            cliente_id: clienteId,
            token_hash: hashToken(token),
            origen: 'corte',
            servicio_id: servicioId,
            expira_en: db.raw("now() + interval '10 minutes'"),
            expira_max_en: db.raw("now() + interval '15 minutes'"),
        })
        .returning('id')
    return { cookie: `argos_portal=${token}`, sesionId: Number(fila.id) }
}

function get(client: ApiClient, ruta: string, cookie: string) {
    return client.get(ruta).header('Cookie', cookie).header('X-Forwarded-For', ipNueva())
}

function abrir(
    client: ApiClient,
    cookie: string,
    campos: Record<string, string>,
    clave: string = randomUUID(),
) {
    let peticion = client
        .post('/api/v1/portal/soporte/tickets')
        .header('Cookie', cookie)
        .header('X-Forwarded-For', ipNueva())
        .header('Idempotency-Key', clave)
    for (const [k, v] of Object.entries(campos)) peticion = peticion.field(k, v)
    return peticion
}

async function filasAuditoria(accion: string, clienteId: number) {
    return db
        .from('audit.acciones')
        .where('accion', accion)
        .where('actor_tipo', 'cliente')
        .where('actor_id', String(clienteId))
        .orderBy('id')
        .select('canal', 'entrada', 'entidad_tipo', 'entidad_id', 'resultado')
}

test.group('Portal: soporte con Iris (0.9.0 §11, A30 y A31)', (group) => {
    group.each.setup(async () => {
        const previo = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
        process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1'
        process.env.PORTAL_REDIS_PREFIJO = unico('prueba-soporte')
        delete process.env.PORTAL_LIMITE_PETICIONES
        delete process.env.IRIS_TOKEN_PORTAL
        fijarConectorPortalIris(conector())
        instalarIrisFalso()
        return async () => {
            fijarConectorPortalIris()
            fijarFetchPortalIris()
            await db.from('integraciones.iris_conector').delete()
            await soloEmpresaPrincipal()
            for (const variable of VARIABLES) {
                if (previo[variable] === undefined) delete process.env[variable]
                else process.env[variable] = previo[variable]
            }
        }
    })

    test('sin sesión: 401 en todas las rutas', async ({ client }) => {
        await estado(client.get('/api/v1/portal/soporte').header('X-Forwarded-For', ipNueva()), 401)
        await estado(client.get('/api/v1/portal/soporte/tickets').header('X-Forwarded-For', ipNueva()), 401)
        await estado(
            client
                .post('/api/v1/portal/soporte/tickets')
                .header('X-Forwarded-For', ipNueva())
                .header('Idempotency-Key', randomUUID())
                .field('asunto', 'Sin internet')
                .field('descripcion', 'x'),
            401,
        )
    })

    test('disponibilidad: sin Iris, apagado, contrato < 0.9.0, sin token y disponible', async ({
        client,
        assert,
    }) => {
        const c = await clienteConSesion()
        const leer = async () => {
            const r = await estado(get(client, '/api/v1/portal/soporte', c.cookie), 200)
            return r.body()
        }
        const leerEstado = async () => {
            const cuerpo = await leer()
            return cuerpo.estado
        }

        fijarConectorPortalIris(conector({ urlBase: null }))
        assert.equal(await leerEstado(), 'sin_iris')
        fijarConectorPortalIris(conector({ activo: false }))
        const apagado = await leer()
        assert.equal(apagado.estado, 'apagado')
        assert.isString(apagado.detalle)
        fijarConectorPortalIris(conector({ contrato: '0.8.1' }))
        assert.equal(await leerEstado(), 'version')
        fijarConectorPortalIris(conector({ tokenPortal: null }))
        assert.equal(await leerEstado(), 'sin_token')

        fijarConectorPortalIris(conector())
        const disponible = await leer()
        assert.equal(disponible.estado, 'disponible')
        assert.deepEqual(disponible.capacidades, CAPACIDADES)
        // contrato 0.9.0: sin tickets de servicios a cargo (§11.10 nace en 0.12.1)
        assert.isFalse(disponible.contactos)
        assert.equal(disponible.sesion, 'documento')
        assert.deepEqual(disponible.empresas, [1])
        // las capacidades se leen con el token del panel, nunca con el del portal
        const lectura = llamadas.find((l) => l.url.endsWith('/argosisp/estado'))!
        assert.equal(lectura.cabeceras.authorization, `Bearer ${TOKEN_PANEL}`)

        // Iris anterior a 0.9.0 que no informa portal_argos
        fijarFetchPortalIris(async () => Response.json({ capacidades: { portal_argos: false } }))
        assert.equal(await leerEstado(), 'version')
        fijarFetchPortalIris(async () => {
            throw new Error('ECONNREFUSED')
        })
        assert.equal(await leerEstado(), 'sin_respuesta')
    })

    test('el conector real: token_portal de IRIS_TOKEN_PORTAL mientras A1 no lo guarda', async ({
        client,
        assert,
    }) => {
        fijarConectorPortalIris()
        await db.from('integraciones.iris_conector').delete()
        await db.table('integraciones.iris_conector').insert({
            id: 1,
            activo: true,
            url_base: 'https://iris.example.test',
            token_cifrado: cifrar(TOKEN_PANEL),
            contrato: '0.9.0',
        })
        const c = await clienteConSesion()
        const leer = async () => {
            const r = await estado(get(client, '/api/v1/portal/soporte', c.cookie), 200)
            return r.body()
        }
        const leerEstado = async () => {
            const cuerpo = await leer()
            return cuerpo.estado
        }
        assert.equal(await leerEstado(), 'sin_token')
        process.env.IRIS_TOKEN_PORTAL = TOKEN_PORTAL
        assert.equal(await leerEstado(), 'disponible')
        await db.from('integraciones.iris_conector').update({ contrato: '0.8.1' })
        assert.equal(await leerEstado(), 'version')
    })

    test('con Iris apagado o anterior: 503 soporte_no_disponible y nada sale hacia Iris', async ({
        client,
        assert,
    }) => {
        const c = await clienteConSesion()
        fijarConectorPortalIris(conector({ activo: false }))
        const r = await estado(get(client, '/api/v1/portal/soporte/tickets', c.cookie), 503)
        assert.equal(r.body().type, 'urn:argosisp:problema:soporte_no_disponible')
        fijarConectorPortalIris(conector({ contrato: '0.8.1' }))
        await estado(abrir(client, c.cookie, { asunto: 'Sin internet', descripcion: 'Luz roja' }), 503)
        assert.lengthOf(llamadas, 0)
        // una abierta que falla por Iris queda auditada como error
        const filas = await filasAuditoria('portal.abrir_ticket', c.clienteId)
        assert.lengthOf(filas, 1)
        assert.equal(filas[0].resultado, 'error')
    })

    test('lista de tickets: cabeceras de §11.2, solo campos del contrato', async ({ client, assert }) => {
        const c = await clienteConSesion()
        responder = () => ({ status: 200, cuerpo: { data: [ticketIris()], nextCursor: 'abc' } })
        const r = await estado(
            get(client, '/api/v1/portal/soporte/tickets?estado=abierto,resuelto&limit=10', c.cookie),
            200,
        )
        const pagina = r.body()
        assert.equal(pagina.nextCursor, 'abc')
        assert.equal(pagina.data[0].numero, 'TK-008812')
        assert.notProperty(pagina.data[0], 'asignado_a')
        assert.notProperty(pagina.data[0], 'prioridad')

        const llamada = llamadas.at(-1)!
        assert.equal(
            llamada.url,
            `https://iris.example.test/api/v1/integraciones/argosisp/portal/clientes/${c.clienteId}/tickets?estado=abierto%2Cresuelto&limit=10`,
        )
        assert.equal(llamada.cabeceras.authorization, `Bearer ${TOKEN_PORTAL}`)
        assert.equal(llamada.cabeceras['x-iris-empresa'], '1')
        assert.equal(llamada.cabeceras['x-argos-portal-sesion'], `documento:${idSesionIris(c.sesionId)}`)
        // §11.10 (0.12.1): el titular siempre con `X-Iris-Contacto: titular` y sin versión
        assert.equal(llamada.cabeceras['x-iris-contacto'], 'titular')
        assert.notProperty(llamada.cabeceras, 'x-iris-contacto-version')
        assert.match(llamada.cabeceras['x-argos-portal-sesion'] ?? '', /^(documento|ip):[A-Za-z0-9_-]{8,64}$/)
        // nunca la cookie ni la IP del cliente
        assert.notInclude(JSON.stringify(llamada.cabeceras), c.cookie.split('=')[1] ?? '')
        assert.notProperty(llamada.cabeceras, 'x-forwarded-for')
    })

    test('empresa: solo una de los servicios del cliente', async ({ client }) => {
        const c = await clienteConSesion()
        responder = () => ({ status: 200, cuerpo: { data: [], nextCursor: null } })
        await estado(get(client, '/api/v1/portal/soporte/tickets?empresa_id=999', c.cookie), 404)
    })

    test('abrir ticket: idempotencia, adjuntos, auditoría y servicio del cliente', async ({
        client,
        assert,
    }) => {
        const c = await clienteConSesion()
        const otro = await crearServicio({ nit: nitAleatorio(), sinFacturas: true, estado: 'activo' })
        responder = () => ({ status: 201, cuerpo: ticketIris({ servicio_id: c.servicioId }) })

        // sin Idempotency-Key o con una que no es UUID: 400
        await estado(
            client
                .post('/api/v1/portal/soporte/tickets')
                .header('Cookie', c.cookie)
                .header('X-Forwarded-For', ipNueva())
                .field('asunto', 'Sin internet')
                .field('descripcion', 'x'),
            400,
        )
        await estado(abrir(client, c.cookie, { asunto: 'Sin internet', descripcion: 'x' }, 'no-es-uuid'), 400)
        // servicio de otro cliente: 422 sin llamar a Iris
        const ajeno = await estado(
            abrir(client, c.cookie, {
                asunto: 'Sin internet',
                descripcion: 'x',
                servicio_id: String(otro.servicioId),
            }),
            422,
        )
        assert.equal(ajeno.body().errors[0].field, 'servicio_id')
        assert.lengthOf(
            llamadas.filter((l) => l.metodo === 'POST'),
            0,
        )

        const clave = randomUUID()
        const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
        const r = await estado(
            abrir(
                client,
                c.cookie,
                {
                    asunto: 'Sin internet',
                    descripcion: 'La luz LOS está roja',
                    servicio_id: String(c.servicioId),
                    categoria_id: '3',
                },
                clave,
            ).file('archivos', png, { filename: '../foto.png', contentType: 'image/png' }),
            201,
        )
        assert.equal(r.body().numero, 'TK-008812')
        const llamada = llamadas.filter((l) => l.metodo === 'POST').at(-1)!
        assert.equal(llamada.cabeceras['idempotency-key'], `argos:portal:ticket:${clave}`)
        const partes = llamada.cuerpo as Record<string, Array<Record<string, unknown>>>
        const datos = JSON.parse(String(partes.datos![0]!.texto))
        assert.deepEqual(datos, {
            asunto: 'Sin internet',
            descripcion: 'La luz LOS está roja',
            categoria_id: 3,
            servicio_id: c.servicioId,
        })
        assert.equal(partes.archivos![0]!.nombre, 'foto.png')
        assert.equal(partes.archivos![0]!.tipo, 'image/png')

        const filas = await filasAuditoria('portal.abrir_ticket', c.clienteId)
        const exito = filas.find((f) => f.resultado === 'ok')!
        assert.equal(exito.canal, 'portal')
        assert.equal(exito.entidad_tipo, 'ticket_iris')
        assert.equal(Number(exito.entidad_id), 8812)
        assert.equal(exito.entrada.archivos, '***')
        assert.deepEqual(exito.entrada.auditoria.adjuntos, [
            { nombre: 'foto.png', mime: 'image/png', tamano: png.length },
        ])

        // un archivo que no es imagen ni PDF: 422 mime_no_permitido, sin llamar a Iris
        const antes = llamadas.length
        const malo = await estado(
            abrir(client, c.cookie, { asunto: 'Sin internet', descripcion: 'x' }).file(
                'archivos',
                Buffer.from('MZ ejecutable'),
                {
                    filename: 'foto.jpg',
                    contentType: 'image/jpeg',
                },
            ),
            422,
        )
        assert.equal(malo.body().type, 'urn:argosisp:problema:mime_no_permitido')
        assert.equal(llamadas.length, antes)

        // contrato 0.14.2 §11.6: WebP y HEIC ya no van a Iris (el navegador los convierte a JPEG)
        const webp = Buffer.concat([
            Buffer.from('RIFF'),
            Buffer.alloc(4),
            Buffer.from('WEBPVP8 '),
            Buffer.alloc(16),
        ])
        const heic = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic'), Buffer.alloc(16)])
        for (const [contenido, filename, contentType] of [
            [webp, 'foto.webp', 'image/webp'],
            [heic, 'foto.heic', 'image/heic'],
        ] as const) {
            const rechazada = await estado(
                abrir(client, c.cookie, { asunto: 'Sin internet', descripcion: 'x' }).file(
                    'archivos',
                    contenido,
                    {
                        filename,
                        contentType,
                    },
                ),
                422,
            )
            assert.equal(rechazada.body().type, 'urn:argosisp:problema:mime_no_permitido')
        }
        assert.equal(llamadas.length, antes)
    })

    test('errores de Iris: tope con Retry-After, validación y credencial rechazada', async ({
        client,
        assert,
    }) => {
        const c = await clienteConSesion()
        responder = () => ({
            status: 429,
            cuerpo: { type: 'urn:iris:problema:demasiados_tickets', title: 'x', status: 429 },
            cabeceras: { 'retry-after': '120' },
        })
        const tope = await estado(abrir(client, c.cookie, { asunto: 'Sin internet', descripcion: 'x' }), 429)
        assert.equal(tope.body().type, 'urn:argosisp:problema:demasiados_tickets')
        assert.equal(tope.header('retry-after'), '120')

        responder = () => ({
            status: 422,
            cuerpo: {
                type: 'urn:iris:problema:validacion',
                title: 'x',
                status: 422,
                errors: [{ field: 'categoria_id', rule: 'categoria', message: 'interno' }],
            },
        })
        const validacion = await estado(
            abrir(client, c.cookie, { asunto: 'Sin internet', descripcion: 'x', categoria_id: '77' }),
            422,
        )
        assert.deepEqual(validacion.body().errors, [
            { field: 'categoria_id', rule: 'categoria', message: 'Elige una categoría de la lista' },
        ])

        responder = () => ({
            status: 403,
            cuerpo: { type: 'urn:iris:problema:solo_integracion_argos', title: 'x', status: 403 },
        })
        const credencial = await estado(get(client, '/api/v1/portal/soporte/tickets', c.cookie), 503)
        assert.equal(credencial.body().type, 'urn:argosisp:problema:soporte_no_disponible')

        responder = () => 'caido'
        await estado(get(client, '/api/v1/portal/soporte/tickets', c.cookie), 503)
        // un Iris sin las rutas de §11 (404 en HTML)
        responder = () => ({ status: 404 })
        await estado(get(client, '/api/v1/portal/soporte/categorias', c.cookie), 503)
    })

    test('detalle, mensajes, responder y confirmar solución', async ({ client, assert }) => {
        const c = await clienteConSesion()
        responder = (l) => {
            if (l.url.endsWith('/mensajes')) {
                return {
                    status: 200,
                    cuerpo: {
                        data: [
                            {
                                id: 51230,
                                autor_tipo: 'agente',
                                autor_nombre: 'Ana',
                                cuerpo: '¿Puedes reiniciarlo?',
                                adjuntos: [
                                    { id: '0193a7c2-aa', nombre: 'foto.jpg', mime: 'image/jpeg', tamano: 10 },
                                ],
                                creado_en: '2026-11-21T15:20:40Z',
                                interno: true,
                            },
                        ],
                        nextCursor: null,
                    },
                }
            }
            if (l.url.endsWith('/responder')) {
                return {
                    status: 200,
                    cuerpo: {
                        ticket: ticketIris({ version: 5 }),
                        mensaje: {
                            id: 51231,
                            autor_tipo: 'cliente',
                            autor_nombre: 'María',
                            cuerpo: 'Listo',
                            adjuntos: [],
                            creado_en: '2026-11-21T16:00:00Z',
                        },
                    },
                }
            }
            if (l.url.endsWith('/confirmar-solucion')) {
                return { status: 200, cuerpo: ticketIris({ estado: 'cerrado', version: 6 }) }
            }
            if (l.url.includes('/adjuntos/')) {
                return {
                    status: 200,
                    binario: new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
                    cabeceras: {
                        'content-type': 'image/jpeg',
                        'content-disposition': "attachment; filename*=UTF-8''foto.jpg",
                    },
                }
            }
            return { status: 200, cuerpo: ticketIris() }
        }
        const ticket = await estado(get(client, '/api/v1/portal/soporte/tickets/8812', c.cookie), 200)
        assert.equal(ticket.body().id, 8812)
        const mensajes = await estado(
            get(client, '/api/v1/portal/soporte/tickets/8812/mensajes', c.cookie),
            200,
        )
        assert.notProperty(mensajes.body().data[0], 'interno')

        const adjunto = await estado(
            get(client, '/api/v1/portal/soporte/tickets/8812/adjuntos/0193a7c2-aa', c.cookie),
            200,
        )
        assert.equal(adjunto.header('x-content-type-options'), 'nosniff')
        assert.equal(adjunto.header('content-security-policy'), 'sandbox')
        assert.match(adjunto.header('content-disposition') ?? '', /^attachment/)

        const clave = randomUUID()
        const respuesta = await estado(
            client
                .post('/api/v1/portal/soporte/tickets/8812/responder')
                .header('Cookie', c.cookie)
                .header('X-Forwarded-For', ipNueva())
                .header('Idempotency-Key', clave)
                .field('cuerpo', 'Listo')
                .field('version', '4'),
            200,
        )
        assert.equal(respuesta.body().ticket.version, 5)
        const llamadaResponder = llamadas.find((l) => l.url.endsWith('/responder'))!
        assert.equal(llamadaResponder.cabeceras['idempotency-key'], `argos:portal:respuesta:${clave}`)
        assert.deepEqual(llamadaResponder.cuerpo, { cuerpo: 'Listo', version: 4 })

        const confirmado = await estado(
            client
                .post('/api/v1/portal/soporte/tickets/8812/confirmar-solucion')
                .header('Cookie', c.cookie)
                .header('X-Forwarded-For', ipNueva())
                .json({ version: 5 }),
            200,
        )
        assert.equal(confirmado.body().estado, 'cerrado')
        const llamadaConfirmar = llamadas.find((l) => l.url.endsWith('/confirmar-solucion'))!
        assert.equal(llamadaConfirmar.cabeceras['idempotency-key'], 'argos:portal:confirmar:8812:5')

        assert.lengthOf(await filasAuditoria('portal.responder_ticket', c.clienteId), 1)
        assert.lengthOf(await filasAuditoria('portal.confirmar_solucion', c.clienteId), 1)

        responder = () => ({
            status: 422,
            cuerpo: { type: 'urn:iris:problema:transicion_invalida', title: 'x', status: 422 },
        })
        const cerrado = await estado(
            client
                .post('/api/v1/portal/soporte/tickets/8812/confirmar-solucion')
                .header('Cookie', c.cookie)
                .header('X-Forwarded-For', ipNueva())
                .json({ version: 6 }),
            422,
        )
        assert.equal(cerrado.body().type, 'urn:argosisp:problema:transicion_invalida')
    })

    test('sesión ip (Ver mi cuenta en /corte): lista reducida, abrir sin adjuntos, nada más', async ({
        client,
        assert,
    }) => {
        const c = await clienteConSesion()
        const corte = await sesionCorte(c.clienteId, c.servicioId)
        responder = (l) =>
            l.metodo === 'POST'
                ? { status: 201, cuerpo: ticketIris({ servicio_id: c.servicioId }) }
                : { status: 200, cuerpo: { data: [ticketIris()], nextCursor: null } }

        const leida = await estado(get(client, '/api/v1/portal/soporte', corte.cookie), 200)
        const soporte = leida.body()
        assert.equal(soporte.sesion, 'ip')
        const lista = await estado(get(client, '/api/v1/portal/soporte/tickets', corte.cookie), 200)
        assert.isNull(lista.body().data[0].asunto)
        assert.equal(
            llamadas.at(-1)!.cabeceras['x-argos-portal-sesion'],
            `ip:${idSesionIris(corte.sesionId)}`,
        )

        for (const ruta of ['/tickets/8812', '/tickets/8812/mensajes', '/solicitudes']) {
            const r = await estado(get(client, `/api/v1/portal/soporte${ruta}`, corte.cookie), 403)
            assert.equal(r.body().type, 'urn:argosisp:problema:sesion_insuficiente')
        }
        await estado(get(client, '/api/v1/portal/contactos', corte.cookie), 403)
        const sinAdjuntos = await estado(
            abrir(client, corte.cookie, { asunto: 'Sin internet', descripcion: 'x' }).file(
                'archivos',
                Buffer.from([0xff, 0xd8, 0xff, 0x00]),
                { filename: 'a.jpg' },
            ),
            422,
        )
        assert.equal(sinAdjuntos.body().type, 'urn:argosisp:problema:adjuntos_no_permitidos')

        await estado(abrir(client, corte.cookie, { asunto: 'Sin internet', descripcion: 'x' }), 201)
        // sin elegirlo, va el servicio de la sesión
        const datos = llamadas.filter((l) => l.metodo === 'POST').at(-1)!.cuerpo as Record<string, unknown>
        assert.equal(datos.servicio_id, c.servicioId)
    })

    test('solicitudes de servicio: reglas por tipo, 409 solicitud_abierta y lista', async ({
        client,
        assert,
    }) => {
        const c = await clienteConSesion()
        const solicitud = {
            id: 731,
            numero: 'PR-000731',
            tipo: 'traslado',
            servicio_id: c.servicioId,
            estado_cliente: 'recibida',
            comentario: 'Me mudo',
            creado_en: '2026-11-21T16:02:00Z',
            actualizado_en: '2026-11-21T16:02:00Z',
            vendedor: 'nunca',
        }
        responder = (l) =>
            l.metodo === 'POST'
                ? { status: 201, cuerpo: solicitud }
                : { status: 200, cuerpo: { data: [solicitud], nextCursor: null } }
        const pedir = (cuerpo: Record<string, unknown>, clave = randomUUID()) =>
            client
                .post('/api/v1/portal/soporte/solicitudes')
                .header('Cookie', c.cookie)
                .header('X-Forwarded-For', ipNueva())
                .header('Idempotency-Key', clave)
                .json(cuerpo)

        const sinServicio = await estado(pedir({ tipo: 'traslado', direccion: 'x' }), 422)
        assert.equal(sinServicio.body().type, 'urn:argosisp:problema:servicio_requerido')
        const sinDireccion = await estado(pedir({ tipo: 'alta' }), 422)
        assert.equal(sinDireccion.body().errors[0].field, 'direccion')
        assert.lengthOf(
            llamadas.filter((l) => l.metodo === 'POST'),
            0,
        )

        const clave = randomUUID()
        const r = await estado(
            pedir(
                {
                    tipo: 'traslado',
                    servicio_id: c.servicioId,
                    direccion: '5a avenida 10-20, zona 1, Mixco',
                    coordenadas: '14.6349, -90.5069',
                    comentario: 'Me mudo',
                },
                clave,
            ),
            201,
        )
        assert.notProperty(r.body(), 'vendedor')
        const llamada = llamadas.filter((l) => l.metodo === 'POST').at(-1)!
        assert.equal(llamada.cabeceras['idempotency-key'], `argos:portal:solicitud:${clave}`)
        assert.deepEqual(llamada.cuerpo, {
            tipo: 'traslado',
            servicio_id: c.servicioId,
            direccion: '5a avenida 10-20, zona 1, Mixco',
            coordenadas: '14.6349,-90.5069',
            comentario: 'Me mudo',
        })
        const filas = await filasAuditoria('portal.solicitar_servicio', c.clienteId)
        assert.equal(Number(filas[0].entidad_id), 731)

        responder = () => ({
            status: 409,
            cuerpo: {
                type: 'urn:iris:problema:solicitud_abierta',
                title: 'x',
                status: 409,
                extensions: { solicitud_id: 731 },
            },
        })
        const abierta = await estado(
            pedir({ tipo: 'traslado', servicio_id: c.servicioId, direccion: 'x' }),
            409,
        )
        assert.equal(abierta.body().solicitud_id, 731)

        responder = () => ({ status: 200, cuerpo: { data: [solicitud], nextCursor: null } })
        const lista = await estado(get(client, '/api/v1/portal/soporte/solicitudes', c.cookie), 200)
        assert.equal(lista.body().data[0].estado_cliente, 'recibida')
    })
})
