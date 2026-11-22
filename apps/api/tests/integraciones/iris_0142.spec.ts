import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado } from '#tests/ayudas'
import { crearClienteFila } from '#tests/core/fabricas'
import { tokenIris } from '#tests/core/ayudas_iris_0100'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { definirRuta, type Ruta } from '#shared/rutas'
import { montarRuta } from '#shared/montar_ruta'
import { registroRutas } from '#start/routes/index'
import { RUTAS_ACTOR_SISTEMA, validarActorSistemaIris } from '#integraciones/iris/atencion'
import {
    CONTRATO_CAPACIDADES_IRIS,
    disponibilidadSoporte,
    fijarConectorPortalIris,
    fijarFetchPortalIris,
    type ConectorPortalIris,
} from '#portal/soporte/iris_portal'

/**
 * Contrato Iris 0.14.2 (Argos A6):
 * - §7.1 `X-Iris-Actor: sistema` solo en la lista cerrada de lecturas (`GET /clientes/:id/contactos`,
 *   `GET /cuentas-bancarias`, `GET /bancos`), sin cabeceras de conversación ni de contacto, auditado
 *   con canal `sistema`; en otra ruta `403 actor_no_permitido` (`422` en una escritura).
 * - §4.3 capacidades de Iris por `GET /integraciones/argosisp/capacidades`.
 */

/** Acción de prueba: deja su fila en `audit.acciones` con el contexto de la petición. */
class LeerPrueba extends DomainAction<Record<string, never>, Record<string, unknown>> {
    readonly nombre = 'cuentas_bancarias.ver'

    protected async handle(_input: Record<string, never>, t: Transaccion) {
        return { canal: t.ctx.canal, actor: t.ctx.actor, iris: t.ctx.iris ?? null }
    }
}

const RUTA_LECTURA_SISTEMA = definirRuta({
    metodo: 'get',
    ruta: '/__pruebas/iris-0142/lectura',
    operacion: 'pruebasIris0142Lectura',
    resumen: 'prueba',
    etiqueta: 'pruebas',
    permiso: null,
    actorSistemaIris: true,
    respuesta: { status: 200, descripcion: 'ok' },
    handler: (ctx) => new LeerPrueba().execute({}, ctx.contextoAccion()),
})

const RUTA_ESCRITURA = definirRuta({
    metodo: 'post',
    ruta: '/__pruebas/iris-0142/escritura',
    operacion: 'pruebasIris0142Escritura',
    resumen: 'prueba',
    etiqueta: 'pruebas',
    permiso: null,
    respuesta: { status: 200, descripcion: 'ok' },
    handler: async () => ({ ok: true }),
})

// antes de que el servidor de pruebas haga commit del router
montarRuta(RUTA_LECTURA_SISTEMA)
montarRuta(RUTA_ESCRITURA)

function sistema(peticion: any, extra: Record<string, string> = {}) {
    peticion.header('X-Iris-Actor', 'sistema')
    for (const [nombre, valor] of Object.entries(extra)) peticion.header(nombre, valor)
    return peticion
}

async function problema(peticion: PromiseLike<any>, status: number, codigo: string) {
    const r = await estado(peticion, status)
    if (r.body().type !== `urn:argosisp:problema:${codigo}`) {
        throw new Error(`se esperaba ${codigo} y llegó ${JSON.stringify(r.body())}`)
    }
    return r
}

test.group('Iris 0.14.2 · X-Iris-Actor: sistema (§7.1)', () => {
    test('la lista cerrada del registro es exactamente la del contrato', ({ assert }) => {
        const declaradas = registroRutas
            .filter((r: Ruta) => r.actorSistemaIris)
            .map((r: Ruta) => `${r.metodo} ${r.ruta}`)
            .sort()
        assert.deepEqual(declaradas, [...RUTAS_ACTOR_SISTEMA].sort())
        assert.throws(() =>
            validarActorSistemaIris({ metodo: 'get', ruta: '/clientes/:id', actorSistemaIris: true }),
        )
        assert.throws(() =>
            validarActorSistemaIris({ metodo: 'post', ruta: '/cuentas-bancarias', actorSistemaIris: true }),
        )
    })

    test('se acepta en GET /clientes/:id/contactos, GET /cuentas-bancarias y GET /bancos', async ({
        client,
        assert,
    }) => {
        const token = await tokenIris()
        const clienteId = await crearClienteFila()
        const contactos = await estado(
            sistema(client.get(`/api/v1/clientes/${clienteId}/contactos`).bearerToken(token)),
            200,
        )
        assert.isArray(contactos.body().data)
        const cuentas = await estado(sistema(client.get('/api/v1/cuentas-bancarias').bearerToken(token)), 200)
        assert.isArray(cuentas.body())
        const bancos = await estado(sistema(client.get('/api/v1/bancos').bearerToken(token)), 200)
        assert.isArray(bancos.body())
    })

    test('otra ruta responde 403 actor_no_permitido; una escritura, 422', async ({ client }) => {
        const token = await tokenIris()
        const clienteId = await crearClienteFila()
        await problema(
            sistema(client.get(`/api/v1/clientes/${clienteId}`).bearerToken(token)),
            403,
            'actor_no_permitido',
        )
        // la búsqueda por teléfono queda fuera aunque sea una lectura de contactos
        await problema(
            sistema(client.get('/api/v1/contactos/buscar?telefono=%2B50255123344').bearerToken(token)),
            403,
            'actor_no_permitido',
        )
        await problema(
            sistema(client.post('/api/v1/__pruebas/iris-0142/escritura').bearerToken(token).json({})),
            422,
            'actor_no_permitido',
        )
    })

    test('con X-Iris-Conversacion o X-Iris-Contacto responde 400 cabecera_iris_requerida', async ({
        client,
    }) => {
        const token = await tokenIris()
        const clienteId = await crearClienteFila()
        await problema(
            sistema(client.get('/api/v1/bancos').bearerToken(token), { 'X-Iris-Conversacion': 'wa:c-1' }),
            400,
            'cabecera_iris_requerida',
        )
        await problema(
            sistema(client.get('/api/v1/cuentas-bancarias').bearerToken(token), {
                'X-Iris-Contacto': 'titular',
            }),
            400,
            'cabecera_iris_requerida',
        )
        await problema(
            sistema(client.get(`/api/v1/clientes/${clienteId}/contactos`).bearerToken(token), {
                'X-Iris-Conversacion': 'wa:c-1',
            }),
            400,
            'cabecera_iris_requerida',
        )
    })

    test('se audita con canal sistema, como el token del conector y sin persona', async ({
        client,
        assert,
    }) => {
        const token = await tokenIris()
        const requestId = randomUUID()
        const r = await estado(
            sistema(client.get('/api/v1/__pruebas/iris-0142/lectura').bearerToken(token)).header(
                'X-Request-Id',
                requestId,
            ),
            200,
        )
        assert.equal(r.body().canal, 'sistema')
        assert.equal(r.body().actor.tipo, 'token')
        const fila = await db.from('audit.acciones').where('request_id', requestId).firstOrFail()
        assert.equal(fila.canal, 'sistema')
        assert.equal(fila.actor_tipo, 'token')
        assert.equal(fila.iris_actor, 'sistema')
        assert.isNull(fila.iris_conversacion)
        assert.isNull(fila.via_token_id ?? null)
    })

    test('los otros actores de Iris siguen igual (asistente en la ruta de prueba: canal ia)', async ({
        client,
        assert,
    }) => {
        const token = await tokenIris()
        const r = await estado(
            client
                .get('/api/v1/__pruebas/iris-0142/lectura')
                .bearerToken(token)
                .header('X-Iris-Actor', 'asistente_ia'),
            200,
        )
        // la ruta no declara cabecerasIris: el actor de Iris no se lee y el canal es el del token
        assert.equal(r.body().canal, 'api')
    })
})

test.group('Iris 0.14.2 · capacidades por su ruta propia (§4.3)', (group) => {
    const TOKEN_PANEL = `iris_pat_${'Pn4Lq7Ws'.repeat(5)}`
    const CAPACIDADES = { portal_argos: true, solicitudes_servicio: true, adjuntos_ticket: false }
    let urls: string[] = []

    function conector(contrato: string): () => Promise<ConectorPortalIris> {
        return async () => ({
            activo: true,
            urlBase: 'https://iris.example.test',
            tokenPanel: TOKEN_PANEL,
            tokenPortal: `iris_pat_${'Pt7Rt8Lo'.repeat(5)}`,
            contrato,
        })
    }

    function irisResponde(status: number, cuerpo: unknown = null) {
        urls = []
        fijarFetchPortalIris(async (url, init) => {
            urls.push(String(url))
            if (status !== 200) {
                return new Response(JSON.stringify({ type: 'about:blank', status }), {
                    status,
                    headers: { 'content-type': 'application/problem+json' },
                })
            }
            const cabeceras = new Headers(init?.headers)
            if (cabeceras.get('authorization') !== `Bearer ${TOKEN_PANEL}`) {
                return new Response(null, { status: 401 })
            }
            return Response.json(cuerpo)
        })
    }

    group.each.teardown(() => {
        fijarConectorPortalIris()
        fijarFetchPortalIris()
    })

    test('con Iris ≥ 0.14.2 lee GET /integraciones/argosisp/capacidades con el token del panel', async ({
        assert,
    }) => {
        fijarConectorPortalIris(conector(CONTRATO_CAPACIDADES_IRIS))
        irisResponde(200, { contrato_iris: '0.14.2', capacidades: CAPACIDADES })
        const d = await disponibilidadSoporte()
        assert.deepEqual(urls, ['https://iris.example.test/api/v1/integraciones/argosisp/capacidades'])
        assert.equal(d.estado, 'disponible')
        assert.deepEqual(d.capacidades, CAPACIDADES)
    })

    test('403 y 404 son un error visible, sin capacidades supuestas', async ({ assert }) => {
        fijarConectorPortalIris(conector('0.14.2'))
        for (const status of [403, 404]) {
            irisResponde(status)
            const d = await disponibilidadSoporte()
            assert.equal(d.estado, 'sin_respuesta')
            assert.isNull(d.capacidades)
            assert.isFalse(d.contactos)
        }
    })

    test('un Iris anterior a 0.14.2 todavía se lee en …/estado', async ({ assert }) => {
        fijarConectorPortalIris(conector('0.12.1'))
        irisResponde(200, { capacidades: CAPACIDADES })
        const d = await disponibilidadSoporte()
        assert.deepEqual(urls, ['https://iris.example.test/api/v1/integraciones/argosisp/estado'])
        assert.equal(d.estado, 'disponible')
    })
})
