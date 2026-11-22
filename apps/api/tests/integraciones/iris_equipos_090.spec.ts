import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar } from '#shared/cifrado'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearServicioFila } from '#tests/core/fabricas'
import { eventoOutbox } from '#tests/notify/ayudas_notify'
import GenerarTokenIris from '#core/actions/generar_token_iris'
import { PERMISOS_IRIS, PERMISOS_IRIS_090, ROL_IRIS, usuarioIris } from '#core/integraciones_iris'
import { ConsumidorIris } from '#integraciones/iris/consumidor'
import { EVENTOS_DESDE_090 } from '#integraciones/iris/envios'
import MigracionPermisosIris090 from '#database/migrations/1795279364216_create_permisos_iris_090_s_table'

/**
 * Contrato Iris 0.9.0 §12 del lado de Argos (A32, A33, A35 y A37). Sin SmartOLT ni ACS en Argos, las
 * rutas de equipos existen con la forma del contrato y responden su error de «sin capacidad»;
 * `capacidades.aprovisionamiento` sale en false. El reenvío de la bienvenida sí funciona.
 */

async function tokenIris() {
    const { token } = await new GenerarTokenIris().execute({ nombre: unico('Iris') }, contextoPrueba())
    const id = (await usuarioIris())!
    await db.from('core.usuarios').where('id', id).update({ activo: true, alcance_global: true })
    await db.from('core.usuarios_empresas').where('usuario_id', id).delete()
    return token
}

async function servicio(estadoServicio = 'activo') {
    const clienteId = await crearClienteFila()
    const servicioId = await crearServicioFila({ cliente_id: clienteId, empresa_id: 1 })
    await db
        .from('core.servicios')
        .where('id', servicioId)
        .update({
            estado: estadoServicio,
            ...(estadoServicio === 'pendiente_instalacion' ? { instalado_en: null } : {}),
        })
    return { clienteId, servicioId }
}

const UUID = () => `iris:test:${unico('k')}`

test.group('Iris 0.9.0 · equipos del cliente y bienvenida (§12)', (group) => {
    group.each.teardown(async () => {
        await db.from('integraciones.iris_conector').delete()
        await db.from('integraciones.iris_envios').delete()
    })

    test('permisos nuevos en el token de Iris y su migración, una sola vez', async ({ assert }) => {
        assert.includeMembers([...PERMISOS_IRIS], [...PERMISOS_IRIS_090])
        const vigente = await new GenerarTokenIris().execute({ nombre: unico('Iris') }, contextoPrueba())
        const usuarioId = (await usuarioIris())!
        const rol = await db.from('core.roles').where('nombre', ROL_IRIS).firstOrFail()
        const filas = await db
            .from('core.permisos')
            .whereIn('nombre', [...PERMISOS_IRIS_090])
            .select('id')
        const ids = filas.map((f) => f.id)
        assert.lengthOf(ids, PERMISOS_IRIS_090.length)
        await db.from('core.roles_permisos').where('role_id', rol.id).whereIn('permiso_id', ids).delete()
        for (const permiso of PERMISOS_IRIS_090) {
            await db.rawQuery(
                `UPDATE core.tokens_api SET alcances = jsonb_set(alcances, '{permisos}', (alcances -> 'permisos') - ?::text)
                  WHERE usuario_id = ?`,
                [permiso, usuarioId],
            )
        }
        const migrar = () =>
            db.transaction((trx) => new MigracionPermisosIris090(trx, 'permisos_iris_090', false).execUp())
        await migrar()
        await migrar()
        assert.lengthOf(
            await db.from('core.roles_permisos').where('role_id', rol.id).whereIn('permiso_id', ids),
            PERMISOS_IRIS_090.length,
        )
        const token = await db.from('core.tokens_api').where('id', vigente.datos.id).firstOrFail()
        for (const permiso of PERMISOS_IRIS_090) {
            assert.lengthOf(
                token.alcances.permisos.filter((p: string) => p === permiso),
                1,
            )
        }
    })

    test('estado: capacidades.aprovisionamiento en false para cada empresa activa', async ({
        client,
        assert,
    }) => {
        const iris = await tokenIris()
        const r = await estado(client.get('/api/v1/integraciones/iris/estado').bearerToken(iris), 200)
        const filas = r.body().capacidades.aprovisionamiento as Array<Record<string, unknown>>
        assert.isAtLeast(filas.length, 1)
        assert.deepEqual(filas[0], { empresa_id: 1, ftth: false, wireless: false, tr069: false })
    })

    test('GET equipo: 409 equipo_sin_gestion; con equipos en comodato salvo para el asistente', async ({
        client,
        assert,
    }) => {
        const iris = await tokenIris()
        const { servicioId } = await servicio()
        const ver = (actor: string | null) => {
            const p = client.get(`/api/v1/servicios/${servicioId}/equipo`).bearerToken(iris)
            if (actor) p.header('X-Iris-Actor', actor)
            return p
        }
        await estado(ver(null), 400)
        const persona = await estado(ver('usuario:57'), 409)
        assert.equal(persona.body().type, 'urn:argosisp:problema:equipo_sin_gestion')
        assert.deepEqual(persona.body().extensions, { equipos: [] })
        const ia = await estado(ver('asistente_ia'), 409)
        assert.notProperty(ia.body(), 'extensions')

        // sin el permiso: 403
        const { token: lectura } = await usuarioConRoles(['lectura'])
        await estado(client.get(`/api/v1/servicios/${servicioId}/equipo`).bearerToken(lectura), 403)
    })

    test('aprovisionar: valida y responde aprovisionamiento_no_disponible; la clave no se audita', async ({
        client,
        assert,
    }) => {
        const iris = await tokenIris()
        const { servicioId } = await servicio('pendiente_instalacion')
        const pedir = (cuerpo: Record<string, unknown>, actor = 'usuario:57') =>
            client
                .post(`/api/v1/servicios/${servicioId}/aprovisionar`)
                .bearerToken(iris)
                .header('X-Iris-Actor', actor)
                .header('Idempotency-Key', UUID())
                .json(cuerpo)
        const ont = {
            equipo: { tipo: 'ont', serie: 'ZTEGC8A1B2C3', mac: null, unidad_id: null, modelo: 'F670L' },
            planta: { olt: 'OLT-Centro', slot: 1, pon: 7, caja: 'CJ-118', puerto: 4 },
            wifi: { ssid: 'Familia Pérez', clave: 'clave-secreta-123' },
            tecnico: { id_externo: '57' },
            origen_tipo: 'iris_orden',
            origen_id: '9123',
        }
        // el asistente nunca aprovisiona
        await estado(pedir(ont, 'asistente_ia'), 403)
        const sinSerie = await estado(pedir({ ...ont, equipo: { tipo: 'ont' } }), 422)
        assert.equal(sinSerie.body().type, 'urn:argosisp:problema:equipo_invalido')
        const plantaWireless = await estado(
            pedir({ ...ont, equipo: { tipo: 'cpe_wireless', mac: 'AA:BB:CC:11:22:33' } }),
            422,
        )
        assert.equal(plantaWireless.body().type, 'urn:argosisp:problema:equipo_invalido')
        const wifi = await estado(pedir({ ...ont, wifi: { ssid: 'x', clave: 'corta' } }), 422)
        assert.equal(wifi.body().type, 'urn:argosisp:problema:wifi_invalido')
        assert.notInclude(JSON.stringify(wifi.body()), 'corta')
        const r = await estado(pedir(ont), 422)
        assert.equal(r.body().type, 'urn:argosisp:problema:aprovisionamiento_no_disponible')
        // sin Idempotency-Key: 400
        await estado(
            client
                .post(`/api/v1/servicios/${servicioId}/aprovisionar`)
                .bearerToken(iris)
                .header('X-Iris-Actor', 'usuario:57')
                .json(ont),
            400,
        )
        // un servicio activo: 409 servicio_no_pendiente
        const activo = await servicio()
        const r409 = await estado(
            client
                .post(`/api/v1/servicios/${activo.servicioId}/aprovisionar`)
                .bearerToken(iris)
                .header('X-Iris-Actor', 'usuario:57')
                .header('Idempotency-Key', UUID())
                .json(ont),
            409,
        )
        assert.equal(r409.body().type, 'urn:argosisp:problema:servicio_no_pendiente')

        const auditoria = await db
            .from('audit.acciones')
            .where('accion', 'servicios.aprovisionar')
            .orderBy('id', 'desc')
            .first()
        assert.notInclude(JSON.stringify(auditoria.entrada), 'clave-secreta-123')
        assert.equal(auditoria.entrada.wifi, '***')
        // GET de un aprovisionamiento: no existe ninguno
        await estado(
            client.get('/api/v1/aprovisionamientos/1').bearerToken(iris).header('X-Iris-Actor', 'usuario:57'),
            404,
        )
    })

    test('wifi: valida cuerpo y verificación; después 409 equipo_sin_gestion', async ({ client, assert }) => {
        const iris = await tokenIris()
        const { servicioId, clienteId } = await servicio()
        const pedir = (cuerpo: Record<string, unknown>, actor = 'usuario:57', conversacion?: string) => {
            const p = client
                .post(`/api/v1/servicios/${servicioId}/wifi`)
                .bearerToken(iris)
                .header('X-Iris-Actor', actor)
                .header('Idempotency-Key', UUID())
            if (conversacion) p.header('X-Iris-Conversacion', conversacion)
            return p.json(cuerpo)
        }
        const base = {
            ssid: 'Casa',
            clave: 'nueva-clave-9876',
            origen_tipo: 'iris_conversacion',
            origen_id: 'conv-1',
            verificacion: {
                metodo: 'codigo_telefono',
                verificado_en: new Date().toISOString(),
                cliente_id: clienteId,
            },
        }
        const nada = await estado(pedir({ ...base, ssid: null, clave: null }), 422)
        assert.equal(nada.body().type, 'urn:argosisp:problema:wifi_invalido')
        const sinVerif = await estado(pedir({ ...base, verificacion: null }), 422)
        assert.equal(sinVerif.body().type, 'urn:argosisp:problema:verificacion_requerida')
        const otroCliente = await estado(
            pedir({ ...base, verificacion: { ...base.verificacion, cliente_id: clienteId + 100000 } }),
            422,
        )
        assert.equal(otroCliente.body().type, 'urn:argosisp:problema:verificacion_requerida')
        // asistente: necesita la conversación, un método suyo y menos de 10 min
        await estado(pedir(base, 'asistente_ia'), 400)
        const presencial = await estado(
            pedir(
                { ...base, verificacion: { ...base.verificacion, metodo: 'presencial' } },
                'asistente_ia',
                'c-1',
            ),
            422,
        )
        assert.equal(presencial.body().type, 'urn:argosisp:problema:verificacion_requerida')
        const vieja = new Date(Date.now() - 11 * 60_000).toISOString()
        const r = await estado(
            pedir(
                { ...base, verificacion: { ...base.verificacion, verificado_en: vieja } },
                'asistente_ia',
                'c-1',
            ),
            422,
        )
        assert.equal(r.body().type, 'urn:argosisp:problema:verificacion_requerida')
        const ok = await estado(pedir(base, 'asistente_ia', 'c-1'), 409)
        assert.equal(ok.body().type, 'urn:argosisp:problema:equipo_sin_gestion')
        // una persona con verificación presencial también llega al 409
        await estado(pedir({ ...base, verificacion: { ...base.verificacion, metodo: 'presencial' } }), 409)

        const auditoria = await db
            .from('audit.acciones')
            .where('accion', 'servicios.cambiar_wifi')
            .orderBy('id', 'desc')
            .first()
        assert.equal(auditoria.entrada.clave, '***')
        assert.notInclude(JSON.stringify(auditoria.entrada), 'nueva-clave-9876')
    })

    test('reenviar bienvenida por la ruta: 202 en_cola; 409 si no está activo', async ({
        client,
        assert,
    }) => {
        const iris = await tokenIris()
        const { servicioId } = await servicio()
        const pedir = (id: number) =>
            client
                .post(`/api/v1/servicios/${id}/bienvenida/reenviar`)
                .bearerToken(iris)
                .header('X-Iris-Actor', 'usuario:57')
                .header('Idempotency-Key', `iris:bienvenida:ord-1:${unico('n')}`)
                .json({ origen_tipo: 'iris_orden', origen_id: 'ord-1', canales: ['whatsapp', 'correo'] })
        const r = await estado(pedir(servicioId), 202)
        assert.containsSubset(r.body(), { estado: 'en_cola' })
        const reciente = await estado(pedir(servicioId), 429)
        assert.equal(reciente.body().type, 'urn:argosisp:problema:bienvenida_reciente')
        assert.isAbove(Number(reciente.header('retry-after')), 0)
        const suspendido = await servicio('suspendido')
        const r409 = await estado(pedir(suspendido.servicioId), 409)
        assert.equal(r409.body().type, 'urn:argosisp:problema:servicio_no_activo')
    })

    test('webhook servicio.bienvenida_cambiada: solo con contrato ≥ 0.9.0, lista cerrada', async ({
        assert,
    }) => {
        assert.include([...EVENTOS_DESDE_090], 'servicio.bienvenida_cambiada')
        await tokenIris()
        const conector = async (contrato: string) => {
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
        const { clienteId, servicioId } = await servicio()
        const payload = {
            bienvenida_id: 1,
            servicio_id: servicioId,
            empresa_id: 1,
            cliente_id: clienteId,
            origen_tipo: 'iris_orden',
            origen_id: 'ord-1',
            canales: [
                { canal: 'whatsapp', estado: 'enviada', motivo: null, aviso_id: 'av-1', texto: 'no sale' },
                { canal: 'correo', estado: 'fallida', motivo: 'error_canal', aviso_id: null },
                { canal: 'telegram', estado: 'omitida', motivo: 'sin_canal', aviso_id: null },
            ],
            reenvio: false,
        }
        const enviar = async () => {
            const id = await eventoOutbox('servicio.bienvenida_cambiada', payload)
            await new ConsumidorIris().procesar({ id, evento: 'servicio.bienvenida_cambiada', payload })
            const envio = await db
                .from('integraciones.iris_envios')
                .where('evento_id', `argos-evt-${id}`)
                .first()
            return envio ? JSON.parse(envio.cuerpo).payload : null
        }
        await conector('0.8.1')
        assert.isNull(await enviar())
        await conector('0.9.0')
        const enviado = await enviar()
        assert.deepEqual(enviado, {
            servicio_id: servicioId,
            empresa_id: 1,
            cliente_id: clienteId,
            origen_tipo: 'iris_orden',
            origen_id: 'ord-1',
            canales: [
                { canal: 'whatsapp', estado: 'enviada', motivo: null, aviso_id: 'av-1' },
                { canal: 'correo', estado: 'fallida', motivo: 'error_canal', aviso_id: null },
                { canal: 'telegram', estado: 'omitida', motivo: 'sin_canal', aviso_id: null },
            ],
            reenvio: false,
        })
    })
})
