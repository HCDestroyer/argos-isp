import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import { cifrar } from '#shared/cifrado'
import { estado, soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { crearEmpresaFila } from '#tests/core/fabricas'
import { crearServicio, nitAleatorio, sesionDirecta } from '#tests/portal/ayudas_portal'
import { recargarConfiguracion } from '#notify/configuracion'
import { MOTIVO_NO_DISPONIBLE } from '#portal/whatsapp'

/**
 * «Acepta avisos por WhatsApp» desde el portal (contrato Iris 0.6.0 §6.4) contra Postgres y Redis
 * reales: `GET/POST /portal/whatsapp` con la sesión del cliente, sobre `verWhatsappCliente` y
 * `RegistrarConsentimientoWhatsapp` de A6. No hace falta un Iris: la marca queda en la cola
 * `notify.consentimientos_iris` (la entrega la prueba A6 en `tests/notify/whatsapp_iris.spec.ts`).
 */

const VARIABLES = ['PORTAL_PROXIES_CONFIABLES', 'PORTAL_REDIS_PREFIJO', 'PORTAL_LIMITE_PETICIONES'] as const

let ipSecuencia = 0
function ipNueva(): string {
    ipSecuencia += 1
    return `198.51.100.${(ipSecuencia % 250) + 1}`
}

async function fijarConector(activo = true, contrato: string | null = '0.6.0') {
    await db.from('integraciones.iris_conector').delete()
    await db.table('integraciones.iris_conector').insert({
        id: 1,
        activo,
        url_base: 'http://127.0.0.1:9',
        token_cifrado: cifrar(`iris_pat_${'Qw3Er4Ty'.repeat(5)}`),
        webhook_entrada_secreto_cifrado: cifrar('whsec_secreto-de-prueba-del-portal'),
        contrato,
    })
}

/** Interruptor `whatsapp.activo`: global y, si se pide, por empresa (sin heredar). */
async function fijarWhatsapp(global: boolean, porEmpresa: Record<number, boolean> = {}) {
    await db.from('notify.configuracion_canales').delete()
    await db
        .table('notify.configuracion_canales')
        .insert({ empresa_id: null, hereda: false, whatsapp_activo: global })
    for (const [empresaId, activo] of Object.entries(porEmpresa)) {
        await db
            .table('notify.configuracion_canales')
            .insert({ empresa_id: Number(empresaId), hereda: false, whatsapp_activo: activo })
    }
    await recargarConfiguracion()
}

async function limpiar() {
    await db.from('integraciones.iris_conector').delete()
    await db.from('notify.consentimientos_iris').delete()
    await db.from('notify.contacto_iris').delete()
    await db.from('notify.configuracion_canales').delete()
    await recargarConfiguracion()
}

async function clienteConSesion(opciones: Parameters<typeof crearServicio>[0] = {}) {
    const s = await crearServicio({ nit: nitAleatorio(), sinFacturas: true, estado: 'activo', ...opciones })
    const { cookie } = await sesionDirecta(s.clienteId)
    return { ...s, cookie }
}

function leer(client: ApiClient, cookie?: string) {
    const peticion = client.get('/api/v1/portal/whatsapp').header('X-Forwarded-For', ipNueva())
    return cookie ? peticion.header('Cookie', cookie) : peticion
}

function marcar(
    client: ApiClient,
    cookie: string,
    valor: 'acepta' | 'baja',
    extra: Record<string, string> = {},
) {
    return client
        .post('/api/v1/portal/whatsapp')
        .header('Cookie', cookie)
        .header('X-Forwarded-For', ipNueva())
        .headers(extra)
        .json({ estado: valor })
}

async function cuerpo(peticion: Parameters<typeof estado>[0], status: number) {
    const respuesta = await estado(peticion, status)
    return respuesta.body()
}

async function consentimientos(clienteId: number) {
    return db
        .from('notify.consentimientos_iris')
        .where('cliente_id', clienteId)
        .orderBy('id')
        .select('empresa_id', 'estado', 'origen', 'entrega', 'idempotency_key', 'registrado_por')
}

test.group('Portal: avisos por WhatsApp (Iris 0.6.0 §6.4)', (group) => {
    group.each.setup(async () => {
        const previo = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
        process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1'
        process.env.PORTAL_REDIS_PREFIJO = unico('prueba-whatsapp')
        delete process.env.PORTAL_LIMITE_PETICIONES
        await limpiar()
        return async () => {
            await limpiar()
            await soloEmpresaPrincipal()
            for (const variable of VARIABLES) {
                if (previo[variable] === undefined) delete process.env[variable]
                else process.env[variable] = previo[variable]
            }
        }
    })

    test('sin sesión: 401 al leer y al marcar', async ({ client }) => {
        await fijarWhatsapp(true)
        await estado(leer(client), 401)
        await estado(
            client
                .post('/api/v1/portal/whatsapp')
                .header('X-Forwarded-For', ipNueva())
                .json({ estado: 'acepta' }),
            401,
        )
    })

    test('con WhatsApp apagado no se muestra ni se puede marcar (422 whatsapp_no_disponible)', async ({
        client,
        assert,
    }) => {
        await fijarConector()
        await fijarWhatsapp(false)
        const c = await clienteConSesion()
        await db.table('notify.contacto_iris').insert({
            cliente_id: c.clienteId,
            canal: 'whatsapp',
            estado: 'acepta',
            ocurrido_en: new Date(),
            origen: 'argos_panel',
        })
        const r = await cuerpo(leer(client, c.cookie), 200)
        assert.deepEqual(r, {
            visible: false,
            disponible: false,
            motivo: null,
            empresas: [],
            estado: null,
            ocurrido_en: null,
            origen: null,
            baja_de_iris: false,
            entrega: null,
        })
        const rechazo = await cuerpo(marcar(client, c.cookie, 'acepta'), 422)
        assert.equal(rechazo.type, 'urn:argosisp:problema:whatsapp_no_disponible')
        assert.lengthOf(await consentimientos(c.clienteId), 0)
    })

    test('conector apagado: visible pero no disponible, con el motivo para el cliente', async ({
        client,
        assert,
    }) => {
        await fijarConector(false)
        await fijarWhatsapp(true)
        const c = await clienteConSesion()
        const r = await cuerpo(leer(client, c.cookie), 200)
        assert.isTrue(r.visible)
        assert.isFalse(r.disponible)
        assert.equal(r.motivo, MOTIVO_NO_DISPONIBLE)
        assert.notInclude(JSON.stringify(r), 'conector Iris')

        // Contrato anterior a 0.6.0: igual de no disponible
        await fijarConector(true, '0.5.0')
        const viejo = await cuerpo(leer(client, c.cookie), 200)
        assert.isFalse(viejo.disponible)
    })

    test('acepta y baja: consentimiento argos_portal en la cola, estado vigente y auditoría del cliente', async ({
        client,
        assert,
    }) => {
        await fijarConector()
        await fijarWhatsapp(true)
        const c = await clienteConSesion()
        const inicial = await cuerpo(leer(client, c.cookie), 200)
        assert.isTrue(inicial.visible)
        assert.isTrue(inicial.disponible)
        assert.isNull(inicial.estado)
        assert.lengthOf(inicial.empresas, 1)

        const req = unico('req')
        const acepta = await cuerpo(marcar(client, c.cookie, 'acepta', { 'X-Request-Id': req }), 200)
        assert.equal(acepta.estado, 'acepta')
        assert.equal(acepta.origen, 'argos_portal')
        assert.equal(acepta.entrega, 'pendiente')
        assert.isFalse(acepta.baja_de_iris)

        const filas = await consentimientos(c.clienteId)
        assert.lengthOf(filas, 1)
        assert.equal(filas[0].estado, 'acepta')
        assert.equal(filas[0].origen, 'argos_portal')
        assert.equal(Number(filas[0].empresa_id), inicial.empresas[0].id)
        assert.isNull(filas[0].registrado_por)
        assert.match(filas[0].idempotency_key, new RegExp(`^argos:consentimiento:${c.clienteId}:whatsapp:`))

        const acciones = await db
            .from('audit.acciones')
            .where('request_id', req)
            .select('accion', 'canal', 'actor_tipo', 'actor_id')
        assert.sameMembers(
            acciones.map((a) => a.accion),
            ['portal.registrar_whatsapp', 'notificaciones.registrar_consentimiento'],
        )
        assert.isTrue(acciones.every((a) => a.canal === 'portal'))
        assert.isTrue(acciones.every((a) => a.actor_tipo === 'cliente' && Number(a.actor_id) === c.clienteId))

        const baja = await cuerpo(marcar(client, c.cookie, 'baja'), 200)
        assert.equal(baja.estado, 'baja')
        assert.isFalse(baja.baja_de_iris)
        const contacto = await db
            .from('notify.contacto_iris')
            .where('cliente_id', c.clienteId)
            .where('canal', 'whatsapp')
            .firstOrFail()
        assert.equal(contacto.estado, 'baja')
        assert.lengthOf(await consentimientos(c.clienteId), 2)
    })

    test('una baja dada en Iris se muestra como tal, sin entrega de Argos', async ({ client, assert }) => {
        await fijarConector()
        await fijarWhatsapp(true)
        const c = await clienteConSesion()
        await estado(marcar(client, c.cookie, 'acepta'), 200)
        // Lo que deja el receptor de A6 al recibir `contacto.baja` (§6.6)
        await db
            .from('notify.contacto_iris')
            .where('cliente_id', c.clienteId)
            .where('canal', 'whatsapp')
            .update({ estado: 'baja', origen: 'iris_cliente', ocurrido_en: new Date(Date.now() + 1000) })
        const r = await cuerpo(leer(client, c.cookie), 200)
        assert.equal(r.estado, 'baja')
        assert.equal(r.origen, 'iris_cliente')
        assert.isTrue(r.baja_de_iris)
        assert.isNull(r.entrega)
    })

    test('entrega fallida a Iris: el portal la ve para ofrecer reintentar', async ({ client, assert }) => {
        await fijarConector()
        await fijarWhatsapp(true)
        const c = await clienteConSesion()
        await estado(marcar(client, c.cookie, 'acepta'), 200)
        await db
            .from('notify.consentimientos_iris')
            .where('cliente_id', c.clienteId)
            .update({ entrega: 'fallido', ultimo_error: 'Iris 422 {}' })
        const r = await cuerpo(leer(client, c.cookie), 200)
        assert.equal(r.entrega, 'fallido')
        assert.equal(r.estado, 'acepta')
        assert.notInclude(JSON.stringify(r), 'Iris 422')

        // Reintentar = volver a marcar: nueva fila pendiente
        const otra = await cuerpo(marcar(client, c.cookie, 'acepta'), 200)
        assert.equal(otra.entrega, 'pendiente')
    })

    test('Idempotency-Key: repetir el mismo POST no crea otra marca', async ({ client, assert }) => {
        await fijarConector()
        await fijarWhatsapp(true)
        const c = await clienteConSesion()
        const clave = unico('clave')
        await estado(marcar(client, c.cookie, 'acepta', { 'Idempotency-Key': clave }), 200)
        await estado(marcar(client, c.cookie, 'acepta', { 'Idempotency-Key': clave }), 200)
        assert.lengthOf(await consentimientos(c.clienteId), 1)
    })

    test('estado inválido: 422 sin marca', async ({ client, assert }) => {
        await fijarConector()
        await fijarWhatsapp(true)
        const c = await clienteConSesion()
        await estado(
            client
                .post('/api/v1/portal/whatsapp')
                .header('Cookie', c.cookie)
                .header('X-Forwarded-For', ipNueva())
                .json({ estado: 'quizas' }),
            422,
        )
        assert.lengthOf(await consentimientos(c.clienteId), 0)
    })

    test('multiempresa: solo las empresas con WhatsApp encendido, una marca por empresa', async ({
        client,
        assert,
    }) => {
        await fijarConector()
        const norte = await crearEmpresaFila({ nombre_comercial: unico('Cable Norte') })
        const sur = await crearEmpresaFila({ nombre_comercial: unico('Fibra Sur') })
        const c = await clienteConSesion({ empresaId: norte })
        await crearServicio({ clienteId: c.clienteId, empresaId: sur, sinFacturas: true, estado: 'activo' })

        // Solo Fibra Sur lo tiene encendido
        await fijarWhatsapp(false, { [sur]: true })
        const soloSur = await cuerpo(leer(client, c.cookie), 200)
        assert.isTrue(soloSur.visible)
        assert.deepEqual(
            soloSur.empresas.map((e: { id: number }) => e.id),
            [sur],
        )
        await estado(marcar(client, c.cookie, 'acepta'), 200)
        let filas = await consentimientos(c.clienteId)
        assert.deepEqual(
            filas.map((f) => Number(f.empresa_id)),
            [sur],
        )

        // Las dos: una marca por empresa, cada una con su clave
        await fijarWhatsapp(false, { [norte]: true, [sur]: true })
        await estado(marcar(client, c.cookie, 'baja'), 200)
        filas = await consentimientos(c.clienteId)
        const bajas = filas.filter((f) => f.estado === 'baja')
        assert.sameMembers(
            bajas.map((f) => Number(f.empresa_id)),
            [norte, sur],
        )
        assert.notEqual(bajas[0].idempotency_key, bajas[1].idempotency_key)
    })
})
