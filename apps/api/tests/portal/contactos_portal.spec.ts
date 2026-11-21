import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { crearServicio, nitAleatorio, sesionDirecta } from '#tests/portal/ayudas_portal'
import { fijarConectorPortalIris, fijarFetchPortalIris } from '#portal/soporte/iris_portal'

/**
 * «Mis contactos» (contrato Iris 0.10.0 §3.5, A42; decisión del PM «También el titular desde el
 * portal») y «Está a cargo de» (0.10.1 §3.8, A46) en el portal, contra Postgres real.
 */

const VARIABLES = ['PORTAL_PROXIES_CONFIABLES', 'PORTAL_REDIS_PREFIJO', 'PORTAL_LIMITE_PETICIONES'] as const

let ipSecuencia = 0
function ipNueva(): string {
    ipSecuencia += 1
    return `198.51.100.${(ipSecuencia % 250) + 1}`
}

async function clienteConSesion(nombre = 'María José García López') {
    const s = await crearServicio({ nit: nitAleatorio(), sinFacturas: true, estado: 'activo', nombre })
    const { cookie } = await sesionDirecta(s.clienteId)
    return { ...s, cookie }
}

function get(client: ApiClient, ruta: string, cookie: string) {
    return client.get(ruta).header('Cookie', cookie).header('X-Forwarded-For', ipNueva())
}

function post(client: ApiClient, ruta: string, cookie: string, cuerpo: Record<string, unknown>) {
    return client
        .post(ruta)
        .header('Cookie', cookie)
        .header('X-Forwarded-For', ipNueva())
        .header('Idempotency-Key', unico('contacto'))
        .json(cuerpo)
}

/** Contacto de `clienteId` que es la persona `personaId` (A46), directo en la tabla de A1. */
async function vincular(
    clienteId: number,
    personaId: number,
    opciones: { servicios?: number[] | null; permisos?: Record<string, boolean> } = {},
) {
    const [fila] = await db
        .table('core.contactos_cliente')
        .insert({
            cliente_id: clienteId,
            nombre: 'José García',
            relacion: 'familiar',
            es_titular: false,
            servicios: opciones.servicios ?? null,
            permisos: JSON.stringify({
                consultar: true,
                reportar: true,
                pagar: true,
                avisos: true,
                ...opciones.permisos,
            }),
            persona_cliente_id: personaId,
            origen: 'argos',
        })
        .returning('id')
    return Number(fila.id)
}

async function filas(accion: string, clienteId: number) {
    return db
        .from('audit.acciones')
        .where('accion', accion)
        .where('actor_tipo', 'cliente')
        .where('actor_id', String(clienteId))
        .orderBy('id')
        .select('canal', 'resultado', 'entidad_tipo', 'entidad_id')
}

test.group('Portal: mis contactos y servicios a cargo (Iris 0.10.x §3.5 y §3.8)', (group) => {
    group.each.setup(async () => {
        const previo = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
        process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1'
        process.env.PORTAL_REDIS_PREFIJO = unico('prueba-contactos')
        delete process.env.PORTAL_LIMITE_PETICIONES
        return async () => {
            fijarConectorPortalIris()
            fijarFetchPortalIris()
            await soloEmpresaPrincipal()
            for (const variable of VARIABLES) {
                if (previo[variable] === undefined) delete process.env[variable]
                else process.env[variable] = previo[variable]
            }
        }
    })

    test('el titular agrega, cambia y quita un contacto; auditado como cliente por el portal', async ({
        client,
        assert,
    }) => {
        const c = await clienteConSesion()
        const inicial = await estado(get(client, '/api/v1/portal/contactos', c.cookie), 200)
        assert.lengthOf(inicial.body().data, 1)
        assert.isTrue(inicial.body().data[0].es_titular)

        const creado = await estado(
            post(client, '/api/v1/portal/contactos', c.cookie, {
                nombre: 'Luis Pérez',
                relacion: 'inquilino',
                servicios: [c.servicioId],
                permisos: { pagar: false },
                telefonos: [
                    { numero: '5512-3344', whatsapp: true, principal: true },
                    { numero: '+50244556677', whatsapp: false, principal: false },
                ],
            }),
            201,
        )
        const contacto = creado.body()
        assert.deepEqual(contacto.permisos, { consultar: true, reportar: true, pagar: false, avisos: true })
        assert.equal(contacto.telefonos[0].numero, '+50255123344')
        assert.deepEqual(contacto.servicios, [c.servicioId])
        const origen = await db.from('core.contactos_cliente').where('id', contacto.contacto_id).first()
        assert.equal(origen.origen, 'portal')
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'cliente.contactos_cambiados')
            .whereRaw("(payload->>'contacto_id')::bigint = ?", [contacto.contacto_id])
            .first()
        assert.equal(evento.payload.accion, 'creado')

        const cambiado = await estado(
            client
                .put(`/api/v1/portal/contactos/${contacto.contacto_id}`)
                .header('Cookie', c.cookie)
                .header('X-Forwarded-For', ipNueva())
                .json({ version: contacto.version, permisos: { pagar: true }, nombre: 'Luis Pérez M.' }),
            200,
        )
        assert.isTrue(cambiado.body().permisos.pagar)
        // versión vieja: 409
        await estado(
            client
                .put(`/api/v1/portal/contactos/${contacto.contacto_id}`)
                .header('Cookie', c.cookie)
                .header('X-Forwarded-For', ipNueva())
                .json({ version: contacto.version, nombre: 'Otro' }),
            409,
        )
        await estado(
            post(client, `/api/v1/portal/contactos/${contacto.contacto_id}/quitar`, c.cookie, {
                version: cambiado.body().version,
            }),
            204,
        )
        const final = await estado(get(client, '/api/v1/portal/contactos', c.cookie), 200)
        assert.lengthOf(final.body().data, 1)

        for (const accion of [
            'portal.agregar_contacto',
            'portal.cambiar_contacto',
            'portal.quitar_contacto',
        ]) {
            const registradas = await filas(accion, c.clienteId)
            assert.isAtLeast(registradas.length, 1, accion)
            assert.equal(registradas[0].canal, 'portal')
        }
    })

    test('números inválidos y titular: 422 por posición, sin repetir el número', async ({
        client,
        assert,
    }) => {
        const c = await clienteConSesion()
        const r = await estado(
            post(client, '/api/v1/portal/contactos', c.cookie, {
                nombre: 'Luis',
                relacion: 'familiar',
                telefonos: [{ numero: '12-34-56-78-xx', principal: true }],
            }),
            422,
        )
        assert.equal(r.body().errors[0].field, 'telefonos.0.numero')
        assert.notInclude(JSON.stringify(r.body()), '12-34-56-78-xx')
        // relacion titular no está entre las que acepta el portal
        await estado(
            post(client, '/api/v1/portal/contactos', c.cookie, {
                nombre: 'Luis',
                relacion: 'titular',
                telefonos: [{ numero: '55123344' }],
            }),
            422,
        )
        // un servicio de otro cliente
        const otro = await crearServicio({ nit: nitAleatorio(), sinFacturas: true, estado: 'activo' })
        await estado(
            post(client, '/api/v1/portal/contactos', c.cookie, {
                nombre: 'Luis',
                relacion: 'familiar',
                servicios: [otro.servicioId],
                telefonos: [{ numero: '55123344' }],
            }),
            422,
        )
    })

    test('nadie toca los contactos de otra cuenta ni el titular: 404', async ({ client }) => {
        const a = await clienteConSesion()
        const b = await clienteConSesion()
        const ajeno = await vincular(b.clienteId, a.clienteId)
        await estado(
            client
                .put(`/api/v1/portal/contactos/${ajeno}`)
                .header('Cookie', a.cookie)
                .header('X-Forwarded-For', ipNueva())
                .json({ version: 1, nombre: 'Robado' }),
            404,
        )
        await estado(post(client, `/api/v1/portal/contactos/${ajeno}/quitar`, a.cookie, { version: 1 }), 404)
        const titular = await db
            .from('core.contactos_cliente')
            .where({ cliente_id: a.clienteId, es_titular: true })
            .first()
        await estado(
            post(client, `/api/v1/portal/contactos/${titular.id}/quitar`, a.cookie, { version: 1 }),
            404,
        )
    })

    test('está a cargo de: solo el servicio, con saldo solo con consultar; sin datos del dueño', async ({
        client,
        assert,
    }) => {
        const mama = await crearServicio({ nit: nitAleatorio(), estado: 'suspendido', nombre: 'Rosa García' })
        await db.from('core.servicios').where('id', mama.servicioId).update({ nombre: 'Casa' })
        const otroDeMama = await crearServicio({
            clienteId: mama.clienteId,
            sinFacturas: true,
            estado: 'activo',
        })
        const jose = await clienteConSesion('José García')

        const sinVinculo = await estado(get(client, '/api/v1/portal/a-cargo', jose.cookie), 200)
        assert.lengthOf(sinVinculo.body().data, 0)

        const contactoId = await vincular(mama.clienteId, jose.clienteId, {
            servicios: [mama.servicioId],
            permisos: { consultar: false },
        })
        const r = await estado(get(client, '/api/v1/portal/a-cargo', jose.cookie), 200)
        const [aCargo] = r.body().data
        assert.equal(aCargo.contacto_id, contactoId)
        assert.lengthOf(aCargo.servicios, 1)
        assert.equal(aCargo.servicios[0].id, mama.servicioId)
        assert.equal(aCargo.servicios[0].nombre, 'Casa')
        assert.match(aCargo.servicios[0].codigo, /^S-\d+$/)
        assert.isNull(aCargo.servicios[0].monto_adeudado)
        const texto = JSON.stringify(r.body())
        assert.notInclude(texto, 'Rosa')
        assert.notInclude(texto, String(otroDeMama.servicioId) + ',')

        await db
            .from('core.contactos_cliente')
            .where('id', contactoId)
            .update({
                permisos: JSON.stringify({ consultar: true, reportar: true, pagar: true, avisos: true }),
            })
        const conSaldo = await estado(get(client, '/api/v1/portal/a-cargo', jose.cookie), 200)
        assert.equal(conSaldo.body().data[0].servicios[0].monto_adeudado, '399.75')
    })

    test('está a cargo de: reportar una falla abre el ticket en la cuenta del dueño con su permiso', async ({
        client,
        assert,
    }) => {
        const mama = await crearServicio({ nit: nitAleatorio(), estado: 'activo', sinFacturas: true })
        const jose = await clienteConSesion('José García')
        const contactoId = await vincular(mama.clienteId, jose.clienteId, { permisos: { reportar: false } })
        const urls: string[] = []
        const cabeceras: Array<Record<string, string>> = []
        fijarConectorPortalIris(async () => ({
            activo: true,
            urlBase: 'https://iris.example.test',
            tokenPanel: null,
            tokenPortal: `iris_pat_${'Pt7Rt8Lo'.repeat(5)}`,
            contrato: '0.12.1',
        }))
        fijarFetchPortalIris(async (url, init) => {
            urls.push(String(url))
            cabeceras.push(Object.fromEntries(new Headers(init?.headers).entries()))
            return Response.json(
                {
                    id: 9001,
                    numero: 'TK-009001',
                    asunto: 'Sin internet',
                    estado: 'nuevo',
                    categoria: null,
                    servicio_id: mama.servicioId,
                    origen: 'portal_argos',
                    afectado_por_incidente: false,
                    puede_confirmar: false,
                    resuelto_en: null,
                    cerrado_en: null,
                    version: 1,
                    creado_en: '2026-11-21T14:03:11Z',
                    actualizado_en: '2026-11-21T14:03:11Z',
                },
                { status: 201 },
            )
        })
        const abrir = () =>
            client
                .post('/api/v1/portal/soporte/tickets')
                .header('Cookie', jose.cookie)
                .header('X-Forwarded-For', ipNueva())
                .header('Idempotency-Key', randomUUID())
                .field('asunto', 'Sin internet en casa de mi mamá')
                .field('descripcion', 'No hay luz en el módem')
                .field('servicio_id', String(mama.servicioId))
                .field('contacto_id', String(contactoId))

        const sinPermiso = await estado(abrir(), 403)
        assert.equal(sinPermiso.body().type, 'urn:argosisp:problema:permiso_de_contacto')
        assert.lengthOf(urls, 0)

        await db
            .from('core.contactos_cliente')
            .where('id', contactoId)
            .update({
                permisos: JSON.stringify({ consultar: true, reportar: true, pagar: true, avisos: true }),
            })
        await estado(abrir(), 201)
        assert.include(urls[0]!, `/portal/clientes/${mama.clienteId}/tickets`)
        assert.equal(cabeceras[0]!['x-iris-contacto'], String(contactoId))
        assert.equal(cabeceras[0]!['x-iris-contacto-version'], '1')
        const fila = await db
            .from('audit.acciones')
            .where('accion', 'portal.abrir_ticket')
            .where('actor_id', String(jose.clienteId))
            .where('resultado', 'ok')
            .first()
        assert.equal(fila.entrada.auditoria.contacto_id, contactoId)
        assert.equal(fila.entrada.auditoria.cliente_id, mama.clienteId)

        // con un contacto que no apunta a esta persona: 404
        const ajeno = await clienteConSesion('Otro')
        await estado(
            client
                .post('/api/v1/portal/soporte/tickets')
                .header('Cookie', ajeno.cookie)
                .header('X-Forwarded-For', ipNueva())
                .header('Idempotency-Key', randomUUID())
                .field('asunto', 'Sin internet')
                .field('descripcion', 'x')
                .field('servicio_id', String(mama.servicioId))
                .field('contacto_id', String(contactoId)),
            404,
        )
    })
})

test.group('Portal: tickets del servicio a cargo (Iris 0.12.1 §11.10)', (group) => {
    let llamadas: Array<{ url: string; metodo: string; cabeceras: Record<string, string> }> = []
    let respuesta: () => Response = () => Response.json({ data: [], nextCursor: null })

    function conector(contrato: string) {
        fijarConectorPortalIris(async () => ({
            activo: true,
            urlBase: 'https://iris.example.test',
            tokenPanel: null,
            tokenPortal: `iris_pat_${'Pt7Rt8Lo'.repeat(5)}`,
            contrato,
        }))
    }

    group.each.setup(async () => {
        const previo = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
        process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1'
        process.env.PORTAL_REDIS_PREFIJO = unico('prueba-a-cargo')
        delete process.env.PORTAL_LIMITE_PETICIONES
        llamadas = []
        respuesta = () => Response.json({ data: [], nextCursor: null })
        conector('0.12.1')
        fijarFetchPortalIris(async (url, init) => {
            if (String(url).endsWith('/argosisp/estado')) {
                return Response.json({
                    capacidades: { portal_argos: true, solicitudes_servicio: true, adjuntos_ticket: true },
                })
            }
            llamadas.push({
                url: String(url),
                metodo: init?.method ?? 'GET',
                cabeceras: Object.fromEntries(new Headers(init?.headers).entries()),
            })
            return respuesta()
        })
        return async () => {
            fijarConectorPortalIris()
            fijarFetchPortalIris()
            await soloEmpresaPrincipal()
            for (const variable of VARIABLES) {
                if (previo[variable] === undefined) delete process.env[variable]
                else process.env[variable] = previo[variable]
            }
        }
    })

    async function escenario(permisos: Record<string, boolean> = {}) {
        const mama = await crearServicio({ nit: nitAleatorio(), estado: 'activo', sinFacturas: true })
        const jose = await clienteConSesion('José García')
        const contactoId = await vincular(mama.clienteId, jose.clienteId, {
            servicios: [mama.servicioId],
            permisos,
        })
        return { mama, jose, contactoId }
    }

    function lista(client: ApiClient, cookie: string, consulta: string) {
        return get(client, `/api/v1/portal/soporte/tickets?${consulta}`, cookie)
    }

    test('la lista del servicio a cargo va con X-Iris-Contacto, su versión y servicio_id', async ({
        client,
        assert,
    }) => {
        const { mama, jose, contactoId } = await escenario({ reportar: false })
        await estado(
            lista(client, jose.cookie, `contacto_id=${contactoId}&servicio_id=${mama.servicioId}`),
            200,
        )
        const llamada = llamadas.at(-1)!
        assert.equal(
            llamada.url,
            `https://iris.example.test/api/v1/integraciones/argosisp/portal/clientes/${mama.clienteId}/tickets?servicio_id=${mama.servicioId}`,
        )
        assert.equal(llamada.cabeceras['x-iris-contacto'], String(contactoId))
        assert.equal(llamada.cabeceras['x-iris-contacto-version'], '1')

        // sin servicio_id: 422 sin llamar a Iris
        const antes = llamadas.length
        const sinServicio = await estado(lista(client, jose.cookie, `contacto_id=${contactoId}`), 422)
        assert.equal(sinServicio.body().errors[0].field, 'servicio_id')
        assert.equal(llamadas.length, antes)
    })

    test('sin reportar ni consultar no ve nada; con un Iris anterior a 0.12.1, 503', async ({
        client,
        assert,
    }) => {
        const { mama, jose, contactoId } = await escenario({ reportar: false, consultar: false })
        const r = await estado(
            lista(client, jose.cookie, `contacto_id=${contactoId}&servicio_id=${mama.servicioId}`),
            403,
        )
        assert.equal(r.body().type, 'urn:argosisp:problema:permiso_de_contacto')

        await db
            .from('core.contactos_cliente')
            .where('id', contactoId)
            .update({
                permisos: JSON.stringify({ consultar: true, reportar: true, pagar: true, avisos: true }),
            })
        conector('0.12.0')
        const viejo = await estado(
            lista(client, jose.cookie, `contacto_id=${contactoId}&servicio_id=${mama.servicioId}`),
            503,
        )
        assert.equal(viejo.body().type, 'urn:argosisp:problema:soporte_no_disponible')
        assert.lengthOf(llamadas, 0)
        const soporte = await estado(get(client, '/api/v1/portal/soporte', jose.cookie), 200)
        assert.isFalse(soporte.body().contactos)
        conector('0.12.1')
        const nuevo = await estado(get(client, '/api/v1/portal/soporte', jose.cookie), 200)
        assert.isTrue(nuevo.body().contactos)
    })

    test('responder y confirmar como contacto exigen reportar y llevan sus cabeceras', async ({
        client,
        assert,
    }) => {
        const { mama, jose, contactoId } = await escenario({ reportar: false })
        const responder = () =>
            client
                .post('/api/v1/portal/soporte/tickets/9001/responder')
                .header('Cookie', jose.cookie)
                .header('X-Forwarded-For', ipNueva())
                .header('Idempotency-Key', randomUUID())
                .field('cuerpo', 'Sigue sin luz')
                .field('contacto_id', String(contactoId))
                .field('servicio_id', String(mama.servicioId))
        await estado(responder(), 403)
        assert.lengthOf(llamadas, 0)

        await db
            .from('core.contactos_cliente')
            .where('id', contactoId)
            .update({
                permisos: JSON.stringify({ consultar: true, reportar: true, pagar: true, avisos: true }),
            })
        const ticket = {
            id: 9001,
            numero: 'TK-009001',
            asunto: 'Sin internet',
            estado: 'abierto',
            categoria: null,
            servicio_id: mama.servicioId,
            origen: 'portal_argos',
            afectado_por_incidente: false,
            puede_confirmar: false,
            resuelto_en: null,
            cerrado_en: null,
            version: 2,
            creado_en: '2026-11-21T14:03:11Z',
            actualizado_en: '2026-11-21T14:03:11Z',
        }
        respuesta = () =>
            Response.json({
                ticket,
                mensaje: {
                    id: 1,
                    autor_tipo: 'cliente',
                    autor_nombre: 'José',
                    cuerpo: 'Sigue sin luz',
                    adjuntos: [],
                    creado_en: '2026-11-21T14:03:11Z',
                },
            })
        await estado(responder(), 200)
        assert.equal(llamadas.at(-1)!.cabeceras['x-iris-contacto'], String(contactoId))

        // Iris: no es un ticket suyo, o el servicio ya no está a su cargo
        respuesta = () =>
            Response.json(
                { type: 'urn:iris:problema:servicio_fuera_del_contacto', title: 'x', status: 403 },
                { status: 403 },
            )
        const fuera = await estado(
            client
                .post('/api/v1/portal/soporte/tickets/9001/confirmar-solucion')
                .header('Cookie', jose.cookie)
                .header('X-Forwarded-For', ipNueva())
                .json({ version: 2, contacto_id: contactoId, servicio_id: mama.servicioId }),
            403,
        )
        assert.equal(fuera.body().type, 'urn:argosisp:problema:servicio_fuera_del_contacto')

        // Iris pide la cabecera (un Argos mal configurado): 503, sin detalles internos
        respuesta = () =>
            Response.json(
                { type: 'urn:iris:problema:cabecera_iris_requerida', title: 'x', status: 400 },
                { status: 400 },
            )
        const cabecera = await estado(
            lista(client, jose.cookie, `contacto_id=${contactoId}&servicio_id=${mama.servicioId}`),
            503,
        )
        assert.equal(cabecera.body().type, 'urn:argosisp:problema:soporte_no_disponible')
    })
})
