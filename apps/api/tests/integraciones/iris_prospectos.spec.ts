import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar } from '#shared/cifrado'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila } from '#tests/core/fabricas'
import { entregarProspectosIris, fijarFetchProspectosIris } from '#integraciones/iris/prospectos'
import RecibirWebhookIris from '#integraciones/iris/actions/recibir_webhook_iris'

/**
 * A44 (contrato Iris 0.10.0 §3.6): registrar desde Argos en Iris a alguien interesado. Cola de
 * pendientes con la misma Idempotency-Key y los mismos bytes, solo el vínculo en la bitácora y el
 * webhook `prospecto.estado_cambiado`.
 */

interface Llamada {
    url: string
    cabeceras: Record<string, string>
    cuerpo: string
}

let llamadas: Llamada[] = []

function irisFalso(respuestas: Array<{ status: number; cuerpo: unknown } | 'caido'>) {
    llamadas = []
    let i = 0
    fijarFetchProspectosIris(async (url, init) => {
        const h = new Headers(init?.headers)
        llamadas.push({
            url: String(url),
            cabeceras: Object.fromEntries(h.entries()),
            cuerpo: String(init?.body),
        })
        const r = respuestas[Math.min(i++, respuestas.length - 1)]!
        if (r === 'caido') throw new Error('ECONNREFUSED')
        return new Response(JSON.stringify(r.cuerpo), {
            status: r.status,
            headers: { 'content-type': 'application/json' },
        })
    })
}

async function fijarConector(contrato: string | null, activo = true) {
    await db.from('integraciones.iris_conector').delete()
    await db.table('integraciones.iris_conector').insert({
        id: 1,
        activo,
        url_base: 'https://iris.example.test',
        token_cifrado: cifrar(`iris_pat_${'Zx9Yw8Vu'.repeat(5)}`),
        contrato,
    })
}

const CUERPO = {
    origen: 'oficina',
    nombre: 'Marta López',
    telefonos: [
        { numero: '+50255123344', whatsapp: true, principal: true },
        {
            numero: '+50244556677',
            whatsapp: true,
            principal: false,
            nombre: 'Jorge López',
            relacion: 'familiar',
        },
    ],
    modo: 'residencial',
    direccion: '3a calle 4-50, zona 2, Mixco',
    coordenadas: '14.6349,-90.5069',
    comentario: 'Pregunta por 100 Mbps',
}

function registrar(client: any, token: string, cuerpo: Record<string, unknown> = CUERPO) {
    return client
        .post('/api/v1/integraciones/iris/prospectos')
        .bearerToken(token)
        .header('X-Empresa-Id', '1')
        .header('Idempotency-Key', unico('pros'))
        .json(cuerpo)
}

test.group('integraciones · iris · prospectos desde Argos (A44)', (group) => {
    group.each.setup(() => {
        return async () => {
            fijarFetchProspectosIris()
            await db.from('integraciones.iris_conector').delete()
        }
    })

    test('cajero registra: Iris responde 201 y Argos guarda solo el vínculo; cabeceras y cuerpo del contrato', async ({
        client,
        assert,
    }) => {
        await fijarConector('0.10.0')
        const { token, usuario } = await usuarioConRoles(['cajero'])
        irisFalso([
            {
                status: 201,
                cuerpo: {
                    prospecto_id: 'p-81',
                    numero: 'PR-000081',
                    estado: 'nuevo',
                    asignado: true,
                    url_iris: 'https://iris.example.test/comercial/prospectos/p-81#ticket=no',
                },
            },
        ])
        const r = await estado(registrar(client, token), 201)
        assert.include(r.body(), {
            entrega: 'enviado',
            prospecto_id: 'p-81',
            numero: 'PR-000081',
            estado_iris: 'nuevo',
            asignado: true,
            url_iris: 'https://iris.example.test/comercial/prospectos/p-81',
            telefonos: 2,
        })
        assert.lengthOf(llamadas, 1)
        const llamada = llamadas[0]!
        assert.equal(llamada.url, 'https://iris.example.test/api/v1/integraciones/argosisp/prospectos')
        assert.match(llamada.cabeceras['idempotency-key']!, /^argos:prospecto:[0-9a-f-]{36}$/)
        assert.equal(llamada.cabeceras['x-iris-empresa'], '1')
        assert.equal(llamada.cabeceras['x-iris-actor'], `usuario:${usuario.id}`)
        assert.deepEqual(JSON.parse(llamada.cuerpo), {
            ...CUERPO,
            zona_id: null,
            plan_interes_id: null,
            cliente_id: null,
        })

        // Solo el vínculo: sin cuerpo en la cola y la auditoría con los datos personales como ***
        const fila = await db.from('integraciones.iris_prospectos').where('id', r.body().id).first()
        assert.isNull(fila.cuerpo)
        const auditoria = await db
            .from('audit.acciones')
            .where({ accion: 'prospectos.registrar', entidad_id: r.body().id })
            .first()
        const texto = JSON.stringify(auditoria.entrada)
        assert.notInclude(texto, '+50255123344')
        assert.notInclude(texto, 'Marta')
        assert.notInclude(texto, 'Mixco')
    })

    test('Iris caído: queda pendiente y el worker reintenta con la misma clave y los mismos bytes', async ({
        client,
        assert,
    }) => {
        await fijarConector('0.10.0')
        const { token } = await usuarioConRoles(['soporte'])
        irisFalso(['caido', { status: 503, cuerpo: {} }, { status: 201, cuerpo: { prospecto_id: 'p-90' } }])
        const r = await estado(registrar(client, token), 201)
        assert.equal(r.body().entrega, 'pendiente')
        const id = r.body().id

        const despues = new Date(Date.now() + 61_000)
        const segundo = await entregarProspectosIris({ ahora: despues })
        assert.equal(segundo.reintentar, 1)
        const tercero = await entregarProspectosIris({ ahora: new Date(Date.now() + 3600_000) })
        assert.equal(tercero.enviados, 1)
        assert.lengthOf(llamadas, 3)
        assert.equal(new Set(llamadas.map((l) => l.cabeceras['idempotency-key'])).size, 1)
        assert.equal(new Set(llamadas.map((l) => l.cuerpo)).size, 1)
        const fila = await db.from('integraciones.iris_prospectos').where('id', id).first()
        assert.equal(fila.entrega, 'enviado')
        assert.equal(fila.prospecto_id, 'p-90')
        assert.isNull(fila.cuerpo)
    })

    test('409 prospecto_duplicado → duplicado con url; 422 → rechazado con el código; conector apagado espera', async ({
        client,
        assert,
    }) => {
        await fijarConector('0.10.0')
        const { token } = await usuarioConRoles(['admin'])
        irisFalso([
            {
                status: 409,
                cuerpo: {
                    type: 'urn:iris:problema:prospecto_duplicado',
                    url_iris: 'https://iris.example.test/comercial/prospectos/p-1',
                },
            },
        ])
        const dup = await estado(registrar(client, token), 201)
        assert.include(dup.body(), {
            entrega: 'duplicado',
            codigo_error: 'prospecto_duplicado',
            url_iris: 'https://iris.example.test/comercial/prospectos/p-1',
        })

        irisFalso([{ status: 422, cuerpo: { type: 'urn:iris:problema:plan_no_permitido' } }])
        const rech = await estado(registrar(client, token, { ...CUERPO, plan_interes_id: 7 }), 201)
        assert.include(rech.body(), { entrega: 'rechazado', codigo_error: 'plan_no_permitido' })

        // Pendiente con el conector apagado: no gasta intentos
        irisFalso(['caido'])
        const pend = await estado(registrar(client, token), 201)
        await fijarConector('0.10.0', false)
        const r = await entregarProspectosIris({ ahora: new Date(Date.now() + 3600_000) })
        assert.equal(r.en_espera, 1)
        const fila = await db.from('integraciones.iris_prospectos').where('id', pend.body().id).first()
        assert.equal(fila.intentos, 1)
    })

    test('validación local, Iris < 0.10.0 y permisos', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['soporte'])
        await fijarConector('0.9.0')
        const viejo = await estado(registrar(client, token), 409)
        assert.equal(viejo.body().type, 'urn:argosisp:problema:iris_no_disponible')
        const disp = await estado(
            client.get('/api/v1/integraciones/iris/prospectos/disponible').bearerToken(token),
            200,
        )
        assert.isFalse(disp.body().disponible)

        await fijarConector('0.10.0')
        const malo = await estado(
            registrar(client, token, {
                ...CUERPO,
                telefonos: [
                    { numero: '+50255123344', whatsapp: true, principal: true, relacion: 'familiar' },
                    { numero: '55123344', whatsapp: false, principal: true },
                    { numero: '+50255123344', whatsapp: true, principal: false, relacion: 'titular' },
                ],
            }),
            422,
        )
        assert.equal(malo.body().type, 'urn:argosisp:problema:telefonos_invalidos')
        assert.notInclude(JSON.stringify(malo.body().errors), '5123344')
        const campos = malo.body().errors.map((e: { field: string }) => e.field)
        assert.includeMembers(campos, [
            'telefonos',
            'telefonos.0.relacion',
            'telefonos.1.numero',
            'telefonos.2.numero',
            'telefonos.2.relacion',
        ])

        const { token: tecnico } = await usuarioConRoles(['tecnico'])
        await estado(registrar(client, tecnico), 403)
    })

    test('webhook prospecto.estado_cambiado: actualiza el vínculo, audita el diff e ignora los atrasados', async ({
        assert,
    }) => {
        await fijarConector('0.10.0')
        const { usuario } = await usuarioConRoles(['cajero'])
        const clienteId = await crearClienteFila()
        const prospectoId = `p-${randomUUID()}`
        const [fila] = await db
            .table('integraciones.iris_prospectos')
            .insert({
                idempotency_key: `argos:prospecto:${randomUUID()}`,
                empresa_id: 1,
                cliente_id: clienteId,
                registrado_por: usuario.id,
                origen: 'oficina',
                telefonos: 1,
                entrega: 'enviado',
                prospecto_id: prospectoId,
                estado_iris: 'nuevo',
            })
            .returning('id')
        const recibir = (ocurrido: string, a: string) =>
            new RecibirWebhookIris().execute(
                {
                    webhook_id: randomUUID(),
                    evento: 'prospecto.estado_cambiado',
                    ocurrido_en: ocurrido,
                    payload: {
                        prospecto_id: prospectoId,
                        empresa_id: 1,
                        de: 'nuevo',
                        a,
                        motivo_codigo: null,
                    },
                    cuerpo: {},
                },
                contextoPrueba(),
            )
        const r1 = await recibir('2026-11-21T10:00:00Z', 'factibilidad')
        assert.equal(r1.resultado, 'estado_aplicado')
        const r2 = await recibir('2026-11-21T09:00:00Z', 'perdido')
        assert.equal(r2.resultado, 'sin_cambio')
        const despues = await db.from('integraciones.iris_prospectos').where('id', fila.id).first()
        assert.equal(despues.estado_iris, 'factibilidad')
        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'prospecto_iris', entidad_id: fila.id, campo: 'estado_iris' })
        assert.lengthOf(cambios, 1)
        const desconocido = await new RecibirWebhookIris().execute(
            {
                webhook_id: randomUUID(),
                evento: 'prospecto.estado_cambiado',
                ocurrido_en: '2026-11-21T10:00:00Z',
                payload: { prospecto_id: 'no-existe', empresa_id: 1, de: 'a', a: 'b' },
                cuerpo: {},
            },
            contextoPrueba(),
        )
        assert.equal(desconocido.resultado, 'prospecto_no_encontrado')
    })
})
