import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import type { ApiClient, ApiRequest } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import { cifrar } from '#shared/cifrado'
import { contextoPrueba, estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { cuentaBancariaPrueba, eventosDe, servicioCortado, unicoBd } from '#tests/billing/ayudas_billing'
import GenerarTokenIris from '#core/actions/generar_token_iris'
import { usuarioIris } from '#core/integraciones_iris'
import { ConsumidorIris } from '#integraciones/iris/consumidor'

/**
 * Contrato Iris 0.7.1 (A24, §7.2 y §7.7): los webhooks `comprobante.aprobado` y
 * `comprobante.rechazado` que Argos manda a Iris traen `verificado_iris_actor`: el `X-Iris-Actor`
 * de quien decidió desde Iris, o null si decidió caja en el panel. Flujo completo contra Postgres
 * real: Iris sube la boleta, se decide (desde Iris o desde el panel) por las rutas reales y el
 * evento del outbox pasa por el consumidor de Iris hasta `integraciones.iris_envios`.
 */

const consumidor = new ConsumidorIris()
const CONVERSACION = 'wa:5025512-3344:a24'
const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('IHDR-boleta-a24'),
])

async function fijarConector(contrato: string) {
    await db.from('integraciones.iris_conector').delete()
    await db.table('integraciones.iris_conector').insert({
        id: 1,
        activo: true,
        url_base: 'http://127.0.0.1:9',
        token_cifrado: cifrar(`iris_pat_${'Zx9Yw8Vu'.repeat(5)}`),
        webhook_salida_url: 'http://127.0.0.1:9/api/v1/integraciones/argosisp/webhook/c-1',
        webhook_salida_secreto_cifrado: cifrar('secreto-del-receptor-de-iris-0123456789'),
        contrato,
    })
}

/** Token `atk_` del usuario técnico Iris (alcance global). */
async function tokenIris() {
    const generado = await new GenerarTokenIris().execute({ nombre: unico('Iris') }, contextoPrueba())
    const id = (await usuarioIris())!
    await db.from('core.usuarios').where('id', id).update({ activo: true, alcance_global: true })
    await db.from('core.usuarios_empresas').where('usuario_id', id).delete()
    return generado.token
}

/** Usuario de Argos vinculado a un id de Iris nuevo (`usuario:<id>`). */
async function operador() {
    const local = await usuarioConRoles(['cajero'])
    const idIris = unico('op').replace(/[^A-Za-z0-9_-]/g, '_')
    await db.table('core.vinculaciones_externas').insert({
        conector: 'iris',
        id_externo: idIris,
        usuario_id: local.usuario.id,
    })
    return `usuario:${idIris}`
}

function conIris(peticion: ApiRequest, actor: string | null, clave: string) {
    let p = peticion.header('X-Request-Id', randomUUID()).header('Idempotency-Key', clave)
    if (actor !== null) p = p.header('X-Iris-Actor', actor).header('X-Iris-Conversacion', CONVERSACION)
    return p
}

/** Servicio cortado con una boleta subida por Iris (`canal = iris`). */
async function boletaDeIris(client: ApiClient, token: string) {
    const datos = await servicioCortado()
    const cuenta = await cuentaBancariaPrueba()
    const campos: Record<string, string | number> = {
        cliente_id: datos.clienteId,
        servicio_id: datos.servicioId,
        metodo: 'deposito',
        cuenta_bancaria_id: cuenta.id,
        referencia: await unicoBd('boleta-a24'),
        monto: '300.00',
        fecha_deposito: '2026-10-08',
        canal_contacto: 'whatsapp',
        leido_por: 'ia',
    }
    let p = client.post('/api/v1/comprobantes').bearerToken(token)
    for (const [nombre, valor] of Object.entries(campos)) p = p.field(nombre, String(valor))
    p = p.file('archivo', PNG, { filename: 'boleta.png' })
    const r = await estado(conIris(p, 'asistente_ia', unico('iris:boleta')), 201)
    return r.body().id as number
}

function decidir(
    client: ApiClient,
    token: string,
    id: number,
    decision: 'aprobar' | 'rechazar',
    actor: string | null,
) {
    const cuerpo = decision === 'aprobar' ? {} : { motivo: 'No aparece en el banco', causa: 'no_aparece' }
    const p = client.post(`/api/v1/comprobantes/${id}/${decision}`).bearerToken(token).json(cuerpo)
    return estado(conIris(p, actor, unico(`k:${decision}:${id}`)), 200)
}

/**
 * Pasa el evento del outbox por el consumidor (con un conector 0.7.1 solo mientras tanto, para que
 * las rutas HTTP de la prueba no hablen con un Iris inexistente) y devuelve el payload del webhook.
 */
async function webhook(nombre: string, comprobanteId: number, quitarClave = false) {
    const [ev] = await eventosDe(nombre, 'comprobante_id', comprobanteId)
    const payload = { ...(typeof ev.payload === 'string' ? JSON.parse(ev.payload) : ev.payload) }
    if (quitarClave) delete payload.verificado_iris_actor
    await fijarConector('0.7.1')
    try {
        await consumidor.procesar({ id: Number(ev.id), evento: nombre, payload })
        const fila = await db
            .from('integraciones.iris_envios')
            .where('evento_id', `argos-evt-${ev.id}`)
            .firstOrFail()
        return JSON.parse(fila.cuerpo).payload as Record<string, unknown>
    } finally {
        await db.from('integraciones.iris_envios').delete()
        await db.from('integraciones.iris_conector').delete()
    }
}

test.group('integraciones · iris · webhooks 0.7.1 (verificado_iris_actor)', (group) => {
    group.each.setup(async () => {
        await db.from('integraciones.iris_enlaces').delete()
        await db.from('integraciones.iris_envios').delete()
        await db.from('integraciones.iris_conector').delete()
    })
    group.teardown(async () => {
        await soloEmpresaPrincipal()
    })

    test('decidido desde Iris: el webhook trae el X-Iris-Actor de quien aprobó o rechazó', async ({
        client,
        assert,
    }) => {
        const token = await tokenIris()

        const cajero = await operador()
        const aprobado = await boletaDeIris(client, token)
        const r = await decidir(client, token, aprobado, 'aprobar', cajero)
        assert.equal(r.body().verificado_iris_actor, cajero)
        const wa = await webhook('comprobante.aprobado', aprobado)
        assert.containSubset(wa, {
            comprobante_id: aprobado,
            canal: 'iris',
            causa: null,
            verificado_iris_actor: cajero,
        })
        assert.notProperty(wa, 'iris_actor')
        assert.notProperty(wa, 'origen')

        const otro = await operador()
        const rechazado = await boletaDeIris(client, token)
        const rr = await decidir(client, token, rechazado, 'rechazar', otro)
        assert.equal(rr.body().verificado_iris_actor, otro)
        const wr = await webhook('comprobante.rechazado', rechazado)
        assert.containSubset(wr, {
            comprobante_id: rechazado,
            canal: 'iris',
            pago_id: null,
            causa: 'no_aparece',
            verificado_iris_actor: otro,
        })
    })

    test('decidido en el panel: el webhook trae verificado_iris_actor null', async ({ client, assert }) => {
        const token = await tokenIris()
        const caja = await usuarioConRoles(['cajero'])

        const aprobado = await boletaDeIris(client, token)
        const r = await decidir(client, caja.token, aprobado, 'aprobar', null)
        assert.isNull(r.body().verificado_iris_actor)
        const wa = await webhook('comprobante.aprobado', aprobado)
        assert.property(wa, 'verificado_iris_actor')
        assert.isNull(wa.verificado_iris_actor)
        assert.containSubset(wa, { comprobante_id: aprobado, canal: 'iris' })

        const rechazado = await boletaDeIris(client, token)
        const rr = await decidir(client, caja.token, rechazado, 'rechazar', null)
        assert.isNull(rr.body().verificado_iris_actor)
        const wr = await webhook('comprobante.rechazado', rechazado)
        assert.property(wr, 'verificado_iris_actor')
        assert.isNull(wr.verificado_iris_actor)
    })

    test('evento anterior a 0.7.1 (sin la clave): se completa con la fila', async ({ client, assert }) => {
        const token = await tokenIris()
        const cajero = await operador()
        const id = await boletaDeIris(client, token)
        await decidir(client, token, id, 'aprobar', cajero)
        const enviado = await webhook('comprobante.aprobado', id, true)
        assert.equal(enviado.verificado_iris_actor, cajero)
    })
})
