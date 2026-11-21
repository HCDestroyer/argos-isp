import { createHash } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar } from '#shared/cifrado'
import { contextoPrueba } from '#tests/ayudas'
import CrearContactoCliente from '#core/actions/crear_contacto_cliente'
import RegistrarConsentimientoWhatsapp from '#notify/actions/registrar_consentimiento_whatsapp'
import { ConsumidorNotify, EVENTOS_NOTIFICABLES } from '#notify/consumidor'
import { entregarConsentimientosIris, fijarFetchConsentimientosIris } from '#notify/consentimientos'
import { recargarConfiguracion } from '#notify/configuracion'
import {
    enmascararSerie,
    enmascararTelefono,
    fijarProveedorContactos,
    type ContactoAviso,
} from '#notify/contactos'
import { registrarCanal, reiniciarCanales } from '#notify/canales/registro'
import {
    CanalFalso,
    ColaFalsa,
    crearCliente,
    crearFactura,
    crearServicio,
    eventoOutbox,
} from '#tests/notify/ayudas_notify'

/**
 * Avisos a contactos (contrato Iris 0.10.0 §3.5 y §6.4, A42; §3.4.4 A39; §3.10 A48). Los contactos
 * son de A1 y notify los lee por `ProveedorContactos`: aquí con un proveedor en memoria.
 */

const contactos = new Map<number, ContactoAviso>()

function contacto(
    datos: Partial<ContactoAviso> & { contacto_id: number; cliente_id: number },
): ContactoAviso {
    const c: ContactoAviso = {
        nombre: 'Luis Pérez',
        relacion: 'familiar',
        es_titular: false,
        servicios: null,
        permisos: { consultar: true, reportar: true, pagar: true, avisos: true },
        telefonos: [{ numero: '+50255123344', whatsapp: true, principal: true }],
        email: null,
        telegram_chat_id: null,
        ...datos,
    }
    contactos.set(c.contacto_id, c)
    return c
}

async function programar(evento: string, payload: Record<string, unknown>) {
    const outboxId = await eventoOutbox(evento, payload)
    await new ConsumidorNotify(new ColaFalsa()).procesar({ id: outboxId, evento, payload })
    return db.from('notify.envios').whereLike('origen', `outbox:${outboxId}%`).orderBy('id')
}

async function fijarConector(contrato: string) {
    await db.from('integraciones.iris_conector').delete()
    await db.table('integraciones.iris_conector').insert({
        id: 1,
        activo: true,
        url_base: 'https://iris.example.test',
        token_cifrado: cifrar(`iris_pat_${'Qw3Er4Ty'.repeat(5)}`),
        contrato,
    })
    await db.from('notify.configuracion_canales').delete()
    await db
        .table('notify.configuracion_canales')
        .insert({ empresa_id: null, hereda: false, whatsapp_activo: true })
    await recargarConfiguracion()
}

test.group('notify · contactos del cliente', (group) => {
    group.each.setup(() => {
        contactos.clear()
        registrarCanal('correo', new CanalFalso('correo'))
        fijarProveedorContactos({
            contactosDe: async (_c, clienteId) =>
                [...contactos.values()].filter((c) => c.cliente_id === clienteId),
            contacto: async (_c, id) => contactos.get(id) ?? null,
        })
        return async () => {
            reiniciarCanales()
            fijarProveedorContactos()
            fijarFetchConsentimientosIris()
            await db.from('notify.consentimientos_iris').delete()
            await db.from('integraciones.iris_conector').delete()
            await db.from('notify.configuracion_canales').delete()
            await recargarConfiguracion()
        }
    })

    test('máscaras: número y serie', ({ assert }) => {
        assert.equal(enmascararTelefono('+50255123344'), '+502 ****-3344')
        assert.equal(enmascararSerie('ZTEGC8A1B2C3'), '…B2C3')
        assert.includeMembers([...EVENTOS_NOTIFICABLES] as string[], [
            'cliente.contactos_cambiados',
            'servicio.titular_cambiado',
            'inventario.recuperacion_intentada',
        ])
    })

    test('contacto agregado o con número nuevo: aviso al titular con el número enmascarado; quitado no avisa', async ({
        assert,
    }) => {
        const titular = await crearCliente({ email: 'titular@prueba.local' })
        contacto({ contacto_id: 9001, cliente_id: titular })
        const envios = await programar('cliente.contactos_cambiados', {
            cliente_id: titular,
            empresa_id: 1,
            contacto_id: 9001,
            accion: 'creado',
            campos: ['nombre', 'telefonos'],
        })
        assert.lengthOf(envios, 1)
        assert.equal(envios[0].evento, 'contacto.agregado')
        assert.equal(envios[0].destino, 'titular@prueba.local')
        assert.include(envios[0].cuerpo, '+502 ****-3344')
        assert.include(envios[0].cuerpo, 'Luis Pérez')
        assert.notInclude(envios[0].cuerpo, '55123344')

        const cambio = await programar('cliente.contactos_cambiados', {
            cliente_id: titular,
            empresa_id: 1,
            contacto_id: 9001,
            accion: 'editado',
            campos: ['telefonos'],
        })
        assert.equal(cambio[0].evento, 'contacto.telefono_agregado')

        assert.lengthOf(
            await programar('cliente.contactos_cambiados', {
                cliente_id: titular,
                empresa_id: 1,
                contacto_id: 9001,
                accion: 'editado',
                campos: ['permisos'],
            }),
            0,
        )
        assert.lengthOf(
            await programar('cliente.contactos_cambiados', {
                cliente_id: titular,
                empresa_id: 1,
                contacto_id: 9001,
                accion: 'quitado',
                campos: [],
            }),
            0,
        )
    })

    test('con el proveedor del núcleo (A1): el alta real de un contacto avisa al titular enmascarado', async ({
        assert,
    }) => {
        fijarProveedorContactos()
        const titular = await crearCliente({ email: 'nucleo@prueba.local' })
        await crearServicio(titular)
        const creado = await new CrearContactoCliente().execute(
            {
                cliente_id: titular,
                nombre: 'Rosa Pérez',
                relacion: 'familiar',
                telefonos: [{ numero: '+50255998877', whatsapp: true, principal: true }],
            },
            contextoPrueba(),
        )
        const fila = await db
            .from('audit.outbox')
            .where('evento', 'cliente.contactos_cambiados')
            .whereRaw(`(payload->>'contacto_id')::bigint = ?`, [creado.contacto_id])
            .firstOrFail()
        const payload = typeof fila.payload === 'string' ? JSON.parse(fila.payload) : fila.payload
        await new ConsumidorNotify(new ColaFalsa()).procesar({
            id: Number(fila.id),
            evento: 'cliente.contactos_cambiados',
            payload,
        })
        const envios = await db.from('notify.envios').where('origen', `outbox:${fila.id}`)
        assert.lengthOf(envios, 1)
        assert.equal(envios[0].evento, 'contacto.agregado')
        assert.equal(envios[0].destino, 'nucleo@prueba.local')
        assert.include(envios[0].cuerpo, '+502 ****-8877')
        assert.notInclude(envios[0].cuerpo, '55998877')
    })

    test('servicio a tu nombre (A39, existente) e intento de recuperación (A48) con la serie enmascarada', async ({
        assert,
    }) => {
        const anterior = await crearCliente()
        const titular = await crearCliente({ email: 'existente@prueba.local' })
        const servicioId = await crearServicio(titular)
        const asignado = await programar('servicio.titular_cambiado', {
            servicio_id: servicioId,
            empresa_id: 1,
            de_cliente_id: anterior,
            a_cliente_id: titular,
            existente: true,
            motivo_codigo: 'otro',
        })
        assert.lengthOf(asignado, 1)
        assert.equal(asignado[0].evento, 'servicio.asignado_a_tu_nombre')
        assert.equal(asignado[0].cliente_id, titular)
        assert.lengthOf(
            await programar('servicio.titular_cambiado', {
                servicio_id: servicioId,
                empresa_id: 1,
                de_cliente_id: anterior,
                a_cliente_id: titular,
                existente: false,
            }),
            0,
        )

        const intento = await programar('inventario.recuperacion_intentada', {
            intento_id: 1,
            unidad_id: 812,
            empresa_id: 1,
            servicio_id: servicioId,
            cliente_id: titular,
            serie: 'ZTEGC8A1B2C3',
            intento_n: 2,
            motivo: 'cliente_ausente',
        })
        assert.equal(intento[0].evento, 'equipo.intento_recuperacion')
        assert.include(intento[0].cuerpo, '…B2C3')
        assert.notInclude(intento[0].cuerpo, 'ZTEGC8A1')
    })

    test('aviso de cobro: también al contacto con avisos del servicio (correo propio); nunca por WhatsApp desde Argos', async ({
        assert,
    }) => {
        const titular = await crearCliente({ email: 'paga@prueba.local', nombre: 'Ana Titular' })
        const servicioId = await crearServicio(titular)
        const otroServicio = await crearServicio(titular)
        const facturaId = await crearFactura(titular, servicioId, { estado: 'vencida', vence: '2026-10-15' })
        contacto({ contacto_id: 9101, cliente_id: titular, nombre: 'Luis', email: 'luis@prueba.local' })
        contacto({
            contacto_id: 9102,
            cliente_id: titular,
            email: 'sinavisos@prueba.local',
            permisos: { consultar: true, reportar: true, pagar: true, avisos: false },
        })
        contacto({
            contacto_id: 9103,
            cliente_id: titular,
            email: 'otro@prueba.local',
            servicios: [otroServicio],
        })
        contacto({ contacto_id: 9104, cliente_id: titular, email: null })

        const envios = await programar('factura.vencida', {
            factura_id: facturaId,
            empresa_id: 1,
            servicio_id: servicioId,
            cliente_id: titular,
            total: '150.00',
            vence: '2026-10-15',
        })
        const correos = envios.filter((e) => e.canal === 'correo')
        assert.sameMembers(
            correos.map((e) => e.destino),
            ['paga@prueba.local', 'luis@prueba.local'],
        )
        const alContacto = correos.find((e) => e.destino === 'luis@prueba.local')!
        assert.match(alContacto.origen, /^outbox:\d+:contacto:9101$/)
        assert.equal(alContacto.cliente_id, titular)
        assert.include(alContacto.cuerpo, 'Hola Luis')
        assert.isFalse(envios.some((e) => e.origen.includes(':contacto:') && e.canal === 'whatsapp'))

        // Idempotente: el mismo evento otra vez no duplica nada
        const outbox = Number(/^outbox:(\d+)/.exec(alContacto.origen)![1])
        await new ConsumidorNotify(new ColaFalsa()).procesar({
            id: outbox,
            evento: 'factura.vencida',
            payload: { factura_id: facturaId, empresa_id: 1, servicio_id: servicioId, cliente_id: titular },
        })
        assert.lengthOf(
            await db.from('notify.envios').whereLike('origen', `outbox:${outbox}%`),
            envios.length,
        )

        // Un aviso que no es de cobro (factura emitida) no sale a los contactos
        const emitida = await programar('factura.emitida', {
            factura_id: facturaId,
            empresa_id: 1,
            servicio_id: servicioId,
            cliente_id: titular,
        })
        assert.isFalse(emitida.some((e) => e.origen.includes(':contacto:')))
    })

    test('permiso de WhatsApp por número: clave con el número, espera a Iris ≥ 0.10.0 y sale con telefono', async ({
        assert,
    }) => {
        const clienteId = await crearCliente()
        const r = await new RegistrarConsentimientoWhatsapp().execute(
            {
                cliente_id: clienteId,
                estado: 'acepta',
                origen: 'argos_panel',
                empresa_id: 1,
                telefono: '+50244556677',
                ocurrido_en: '2026-11-21T15:00:00.000Z',
            },
            contextoPrueba(),
        )
        assert.equal(
            r.idempotency_key,
            `argos:consentimiento:1:${clienteId}:whatsapp:${createHash('sha256').update('+50244556677').digest('hex').slice(0, 16)}:2026-11-21T15:00:00.000Z`,
        )
        assert.notInclude(r.idempotency_key, '44556677')
        // El número no queda en claro en la auditoría
        const auditadas = await db
            .from('audit.acciones')
            .where('accion', 'notificaciones.registrar_consentimiento')
            .where('entidad_id', clienteId)
        assert.isNotEmpty(auditadas)
        for (const a of auditadas) assert.notInclude(JSON.stringify(a), '44556677')
        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'cliente', entidad_id: clienteId })
        for (const c of cambios) assert.notInclude(JSON.stringify(c), '44556677')
        assert.equal(r.telefono, '+50244556677')
        // No cambia el estado de contacto del cliente
        assert.isNull(await db.from('notify.contacto_iris').where('cliente_id', clienteId).first())
        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'cliente', entidad_id: clienteId, campo: 'avisos_whatsapp_numero' })
            .first()
        assert.include(JSON.stringify(cambio.valor_nuevo ?? cambio), '****-6677')

        const cuerpos: string[] = []
        fijarFetchConsentimientosIris(async (_url, init) => {
            cuerpos.push(String(init?.body))
            return new Response(JSON.stringify({ consentimiento_id: 'c-9', estado_vigente: 'acepta' }), {
                status: 201,
            })
        })
        await fijarConector('0.9.0')
        assert.containsSubset(await entregarConsentimientosIris(), { en_espera: 1, enviados: 0 })
        await fijarConector('0.10.0')
        assert.containsSubset(await entregarConsentimientosIris(), { enviados: 1 })
        assert.deepEqual(JSON.parse(cuerpos[0]!), {
            empresa_id: 1,
            cliente_id: clienteId,
            canal: 'whatsapp',
            estado: 'acepta',
            origen: 'argos_panel',
            ocurrido_en: '2026-11-21T15:00:00.000Z',
            telefono: '+50244556677',
        })
    })
})
