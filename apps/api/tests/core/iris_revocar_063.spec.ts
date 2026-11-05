import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { ejecutarCronCore } from '#core/jobs'
import { descifrar } from '#shared/cifrado'
import { CONTRATO_IRIS, PLAZO_CONFIRMAR_CANJE_IRIS_MS } from '#integraciones/iris/configuracion'

/**
 * Contrato Iris 0.6.3: un `atk_` canjeado no queda huérfano (revisión de iris#106).
 * - (a) `POST /integraciones/iris/conexion/revocar`: Iris revoca su propio token (204) y el
 *   conector queda desconectado sin borrar el historial; repetirlo → 401.
 * - (b) cron `iris_canjes_sin_uso`: el canje cuyo token nadie usó en 24 h vence solo (token
 *   revocado, conector desconectado); uno usado (PUT del contrato, lectura o escritura) queda
 *   confirmado y sigue funcionando: un Iris anterior a 0.6.3 no nota nada.
 */

const BASE_IRIS = '/api/v1/integraciones/iris'
const IRIS = 'https://iris.isp.example'
const ARGOS = 'https://api.argos.isp.example'

function canje(codigo: string, extra: Record<string, unknown> = {}) {
    return {
        codigo,
        sistema: 'iris',
        base_url: IRIS,
        token: `iris_pat_${'Qa1Ws2Ed'.repeat(5)}`,
        webhook: {
            url: `${IRIS}/api/v1/integraciones/argosisp/webhook/c-1`,
            secreto: 'secreto-del-receptor-de-iris-0123456789',
        },
        contrato: '0.6.2',
        receptor_argos: true,
        ...extra,
    }
}

async function limpiarIris() {
    await db.from('integraciones.iris_enlaces').delete()
    await db.from('integraciones.iris_conector').delete()
}

async function canjear(client: any, admin: string, extra: Record<string, unknown> = {}) {
    const r = await estado(client.post(`${BASE_IRIS}/enlace`).bearerToken(admin), 201)
    const codigo = (r.body().enlace as string).split('#')[1]!
    const cuerpo = canje(codigo, extra)
    const c = await estado(client.post(`${BASE_IRIS}/conexion/canjear`).json(cuerpo), 200)
    return { cuerpo, atk: c.body().token as string, respuesta: c.body() }
}

async function vista(client: any, admin: string) {
    const r = await estado(client.get(BASE_IRIS).bearerToken(admin), 200)
    return r.body()
}

async function estadoCanje(client: any, admin: string) {
    const v = await vista(client, admin)
    return v.estado_canje
}

async function tokenDelConector(): Promise<number> {
    const fila = await filaConector()
    return Number(fila.token_argos_id)
}

async function pendienteDelConector(): Promise<number | null> {
    const fila = await filaConector()
    return fila.pendiente_token_argos_id
}

async function filaConector() {
    return db.from('integraciones.iris_conector').where('id', 1).first()
}

async function tokenRevocado(id: number): Promise<boolean> {
    const fila = await db.from('core.tokens_api').where('id', id).select('revocado_en').first()
    return fila?.revocado_en !== null
}

function despuesDe(ms: number): Date {
    return new Date(Date.now() + ms)
}

test.group('Iris 0.6.3 · token huérfano de un canje', (group) => {
    group.each.setup(async () => {
        process.env.API_PUBLIC_URL = ARGOS
        await limpiarIris()
        return async () => {
            await limpiarIris()
            delete process.env.API_PUBLIC_URL
            await soloEmpresaPrincipal()
        }
    })

    test('Argos habla el contrato 0.6.3', async ({ assert }) => {
        assert.equal(CONTRATO_IRIS, '0.6.3')
    })

    test('el canje queda pendiente de confirmar, con su vencimiento a 24 h', async ({ client, assert }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        await canjear(client, admin)
        const v = await vista(client, admin)
        assert.equal(v.estado_canje, 'pendiente')
        const canjeado = new Date(v.conectado_por_enlace_en).getTime()
        assert.equal(new Date(v.canje_vence_en).getTime(), canjeado + PLAZO_CONFIRMAR_CANJE_IRIS_MS)
        assert.isNull(v.desconectado_en)
        assert.isNull(v.motivo_desconexion)
    })

    test('revocar: 204, token revocado, conector desconectado y auditado; repetir → 401', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const { cuerpo, atk } = await canjear(client, admin)
        const antes = await filaConector()
        const tokenId = Number(antes.token_argos_id)

        const r = await estado(client.post(`${BASE_IRIS}/conexion/revocar`).bearerToken(atk), 204)
        assert.equal(r.text(), '')
        assert.isTrue(await tokenRevocado(tokenId))

        const fila = await filaConector()
        assert.isFalse(fila.activo)
        assert.isNull(fila.token_cifrado)
        assert.isNull(fila.webhook_salida_secreto_cifrado)
        assert.isNull(fila.webhook_entrada_secreto_cifrado)
        assert.equal(fila.motivo_desconexion, 'revocado_por_iris')
        assert.isNotNull(fila.desconectado_en)
        // historial: la URL, el receptor, el conector_id y el token entregado se conservan
        assert.equal(fila.url_base, IRIS)
        assert.equal(fila.webhook_salida_url, cuerpo.webhook.url)
        assert.equal(fila.conector_id, antes.conector_id)
        assert.equal(Number(fila.token_argos_id), tokenId)

        const v = await vista(client, admin)
        assert.equal(v.estado_canje, 'desconectado')
        assert.equal(v.motivo_desconexion, 'revocado_por_iris')
        assert.isNull(v.canje_vence_en)
        assert.isNull(v.token)

        const accion = await db
            .from('audit.acciones')
            .where('accion', 'iris.revocar_conexion')
            .orderBy('id', 'desc')
            .first()
        assert.equal(accion.resultado, 'ok')
        assert.equal(accion.entidad_tipo, 'conector_iris')
        assert.isNotNull(accion.actor_id)
        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'conector_iris', entidad_id: 1, campo: 'motivo_desconexion' })
            .orderBy('id', 'desc')
            .first()
        assert.equal(String(cambio?.despues).replaceAll('"', ''), 'revocado_por_iris')
        const revocacion = await db
            .from('audit.acciones')
            .where('accion', 'iris.revocar_token')
            .where('entidad_id', tokenId)
            .first()
        assert.exists(revocacion)

        // el token ya no autentica: repetir la revocación o usarlo → 401
        await estado(client.post(`${BASE_IRIS}/conexion/revocar`).bearerToken(atk), 401)
        await estado(client.put(`${BASE_IRIS}/contrato`).bearerToken(atk).json({ contrato: '0.6.3' }), 401)
        // la misma petición de canje ya no devuelve el token revocado
        await estado(client.post(`${BASE_IRIS}/conexion/canjear`).json(cuerpo), 410)
        // el conector desconectado no se enciende sin token
        await estado(
            client
                .put(BASE_IRIS)
                .bearerToken(admin)
                .json({ version: Number(fila.version), activo: true }),
            422,
        )
        // el cron no vuelve a tocarlo
        const corrida = await ejecutarCronCore(
            'iris_canjes_sin_uso',
            despuesDe(2 * PLAZO_CONFIRMAR_CANJE_IRIS_MS),
        )
        assert.isNull(corrida.resultado)
    })

    test('revocar: 403 a un token que no es de Iris; un token de Iris hecho a mano solo se revoca él', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        await canjear(client, admin)
        await estado(client.post(`${BASE_IRIS}/conexion/revocar`).bearerToken(admin), 403)
        await estado(client.post(`${BASE_IRIS}/conexion/revocar`), 401)

        const otro = await estado(
            client.post(`${BASE_IRIS}/tokens`).bearerToken(admin).json({ nombre: 'Iris (a mano)' }),
            201,
        )
        await estado(client.post(`${BASE_IRIS}/conexion/revocar`).bearerToken(otro.body().token), 204)
        assert.isTrue(await tokenRevocado(Number(otro.body().datos.id)))
        const fila = await filaConector()
        assert.isNull(fila.desconectado_en)
        assert.isFalse(await tokenRevocado(Number(fila.token_argos_id)))
        assert.equal(await estadoCanje(client, admin), 'pendiente')
    })

    test('cron: sin uso en 24 h el canje vence (token revocado, conector desconectado)', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const { atk } = await canjear(client, admin)
        const tokenId = await tokenDelConector()

        const temprano = await ejecutarCronCore(
            'iris_canjes_sin_uso',
            despuesDe(PLAZO_CONFIRMAR_CANJE_IRIS_MS - 60_000),
        )
        assert.isFalse(temprano.omitido)
        assert.isNull(temprano.resultado)
        assert.isFalse(await tokenRevocado(tokenId))

        const corrida = await ejecutarCronCore(
            'iris_canjes_sin_uso',
            despuesDe(PLAZO_CONFIRMAR_CANJE_IRIS_MS + 60_000),
        )
        assert.deepEqual(corrida.resultado, { resultado: 'desconectado', reconexion: null })
        assert.isTrue(await tokenRevocado(tokenId))
        const fila = await filaConector()
        assert.isFalse(fila.activo)
        assert.isNull(fila.token_cifrado)
        assert.equal(fila.motivo_desconexion, 'canje_sin_uso')
        const v = await vista(client, admin)
        assert.equal(v.estado_canje, 'desconectado')
        assert.equal(v.motivo_desconexion, 'canje_sin_uso')
        await estado(client.put(`${BASE_IRIS}/contrato`).bearerToken(atk).json({ contrato: '0.6.2' }), 401)

        const accion = await db
            .from('audit.acciones')
            .where('accion', 'iris.vencer_canje')
            .orderBy('id', 'desc')
            .first()
        assert.equal(accion.resultado, 'ok')
        assert.equal(accion.canal, 'cron')
        // todo lo pendiente ya se procesó: otra corrida no hace nada ni audita
        const total = await db.from('audit.acciones').where('accion', 'iris.vencer_canje').count('* as n')
        const otra = await ejecutarCronCore(
            'iris_canjes_sin_uso',
            despuesDe(3 * PLAZO_CONFIRMAR_CANJE_IRIS_MS),
        )
        assert.isNull(otra.resultado)
        const despues = await db.from('audit.acciones').where('accion', 'iris.vencer_canje').count('* as n')
        assert.equal(Number(despues[0].n), Number(total[0].n))
    })

    test('Iris anterior a 0.6.3: usa el token tras el canje (PUT del contrato) y nada vence', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const { atk } = await canjear(client, admin)
        const tokenId = await tokenDelConector()
        // lo que hace Iris al activar su conector: PUT del contrato (nunca llama a revocar)
        await estado(client.put(`${BASE_IRIS}/contrato`).bearerToken(atk).json({ contrato: '0.6.2' }), 200)

        // la primera llamada ya lo confirmó (guard): el cron no tiene nada que hacer
        assert.equal(await estadoCanje(client, admin), 'confirmado')
        const confirmacion = await db
            .from('audit.acciones')
            .where('accion', 'iris.confirmar_canje')
            .orderBy('id', 'desc')
            .first()
        assert.equal(confirmacion.resultado, 'ok')
        assert.equal(confirmacion.actor_tipo, 'token')
        const corrida = await ejecutarCronCore('iris_canjes_sin_uso', despuesDe(60_000))
        assert.isNull(corrida.resultado)

        const tarde = await ejecutarCronCore(
            'iris_canjes_sin_uso',
            despuesDe(2 * PLAZO_CONFIRMAR_CANJE_IRIS_MS),
        )
        assert.isNull(tarde.resultado)
        assert.isFalse(await tokenRevocado(tokenId))
        const fila = await filaConector()
        assert.isNull(fila.desconectado_en)
        assert.isNotNull(fila.token_cifrado)
        await estado(client.get(`${BASE_IRIS}/estado`).bearerToken(atk), 200)
    })

    test('cualquier lectura autenticada cuenta como uso', async ({ client, assert }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const { atk } = await canjear(client, admin)
        await estado(client.get(`${BASE_IRIS}/estado`).bearerToken(atk), 200)
        assert.equal(await estadoCanje(client, admin), 'confirmado')
        const corrida = await ejecutarCronCore(
            'iris_canjes_sin_uso',
            despuesDe(PLAZO_CONFIRMAR_CANJE_IRIS_MS + 60_000),
        )
        assert.isNull(corrida.resultado)
        assert.isFalse(await tokenRevocado(await tokenDelConector()))
    })

    test('respaldo: si el guard no alcanzó a confirmar, el cron confirma por ultimo_uso', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        await canjear(client, admin)
        const tokenId = await tokenDelConector()
        await db
            .from('core.tokens_api')
            .where('id', tokenId)
            .update({ ultimo_uso: db.knexRawQuery('now()') })
        const corrida = await ejecutarCronCore(
            'iris_canjes_sin_uso',
            despuesDe(PLAZO_CONFIRMAR_CANJE_IRIS_MS + 60_000),
        )
        assert.deepEqual(corrida.resultado, { resultado: 'confirmado', reconexion: null })
        assert.isFalse(await tokenRevocado(tokenId))
    })

    test('un conector existente (confirmado por la migración) nunca vence', async ({ client, assert }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        await canjear(client, admin)
        await db
            .from('integraciones.iris_conector')
            .where('id', 1)
            .update({ canje_confirmado_en: db.knexRawQuery('now()') })
        const corrida = await ejecutarCronCore(
            'iris_canjes_sin_uso',
            despuesDe(2 * PLAZO_CONFIRMAR_CANJE_IRIS_MS),
        )
        assert.isNull(corrida.resultado)
        assert.isFalse(await tokenRevocado(await tokenDelConector()))
    })

    test('un canje nuevo revoca el token anterior y vuelve a quedar pendiente', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const primero = await canjear(client, admin)
        const primerId = await tokenDelConector()
        await estado(client.post(`${BASE_IRIS}/conexion/revocar`).bearerToken(primero.atk), 204)
        assert.equal(await estadoCanje(client, admin), 'desconectado')

        await canjear(client, admin)
        const fila = await filaConector()
        assert.notEqual(Number(fila.token_argos_id), primerId)
        assert.isNull(fila.desconectado_en)
        assert.isNull(fila.motivo_desconexion)
        assert.isNotNull(fila.token_cifrado)
        assert.equal(await estadoCanje(client, admin), 'pendiente')

        // y sin revocar: el canje siguiente revoca el anterior
        const segundoId = Number(fila.token_argos_id)
        await canjear(client, admin)
        assert.isTrue(await tokenRevocado(segundoId))
    })

    test('encender a mano un conector desconectado: queda sin canje y el barrido no lo vuelve a tocar', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        await canjear(client, admin)
        const corrida = await ejecutarCronCore(
            'iris_canjes_sin_uso',
            despuesDe(PLAZO_CONFIRMAR_CANJE_IRIS_MS + 60_000),
        )
        assert.equal(corrida.resultado?.resultado, 'desconectado')
        const antes = await filaConector()

        const tokenNuevo = `iris_pat_${'Mn5Op4Qr'.repeat(5)}`
        const r = await estado(
            client
                .put(BASE_IRIS)
                .bearerToken(admin)
                .json({ version: Number(antes.version), token: tokenNuevo, activo: true }),
            200,
        )
        const v = r.body()
        assert.isTrue(v.activo)
        assert.equal(v.token, '***')
        assert.isNull(v.estado_canje)
        assert.isNull(v.canje_vence_en)
        assert.isNull(v.desconectado_en)
        assert.isNull(v.motivo_desconexion)
        assert.isNull(v.conectado_por_enlace_en)
        assert.isNull(v.token_argos_id)
        assert.deepEqual(await vista(client, admin), v)

        const tarde = await ejecutarCronCore(
            'iris_canjes_sin_uso',
            despuesDe(3 * PLAZO_CONFIRMAR_CANJE_IRIS_MS),
        )
        assert.isNull(tarde.resultado)
        const fila = await filaConector()
        assert.isTrue(fila.activo)
        assert.equal(descifrar(fila.token_cifrado), tokenNuevo)

        // conector a mano: Iris usa un atk_ creado en el panel
        const otro = await estado(
            client.post(`${BASE_IRIS}/tokens`).bearerToken(admin).json({ nombre: 'Iris (a mano)' }),
            201,
        )
        await estado(
            client.put(`${BASE_IRIS}/contrato`).bearerToken(otro.body().token).json({ contrato: '0.6.3' }),
            200,
        )
        // y un canje nuevo sobre él es una reconexión: el conector sigue hasta la primera llamada
        await canjear(client, admin)
        const conPendiente = await filaConector()
        assert.isNotNull(conPendiente.pendiente_token_argos_id)
        assert.equal(descifrar(conPendiente.token_cifrado), tokenNuevo)
    })

    test('dos corridas a la vez: una sola desconecta', async ({ client, assert }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        await canjear(client, admin)
        const tarde = despuesDe(PLAZO_CONFIRMAR_CANJE_IRIS_MS + 60_000)
        const corridas = await Promise.all([
            ejecutarCronCore('iris_canjes_sin_uso', tarde),
            ejecutarCronCore('iris_canjes_sin_uso', tarde),
        ])
        const desconectadas = corridas.filter((c) => c.resultado?.resultado === 'desconectado')
        assert.lengthOf(desconectadas, 1)
    })
})

test.group('Iris 0.6.3 · reconexión: el atk_ anterior se revoca al confirmar el canje nuevo', (group) => {
    group.each.setup(async () => {
        process.env.API_PUBLIC_URL = ARGOS
        await limpiarIris()
        return async () => {
            await limpiarIris()
            delete process.env.API_PUBLIC_URL
            await soloEmpresaPrincipal()
        }
    })

    const NUEVO = {
        token: `iris_pat_${'Nv7Bc6Xz'.repeat(5)}`,
        webhook: {
            url: `${IRIS}/api/v1/integraciones/argosisp/webhook/c-2`,
            secreto: 'secreto-nuevo-del-receptor-de-iris-987654',
        },
        contrato: '0.6.3',
        receptor_argos: true,
    }

    /** Conector en uso: canjeado, confirmado (Iris lo usó), encendido y con receptor_argos false. */
    async function conectorEnUso(client: any, admin: string) {
        const viejo = await canjear(client, admin, { receptor_argos: false })
        await estado(client.get(`${BASE_IRIS}/estado`).bearerToken(viejo.atk), 200)
        const fila = await filaConector()
        await estado(
            client
                .put(BASE_IRIS)
                .bearerToken(admin)
                .json({ version: Number(fila.version), activo: true }),
            200,
        )
        return { ...viejo, tokenId: Number(fila.token_argos_id), fila: await filaConector() }
    }

    /** Lo que se conserva del conector mientras la reconexión está pendiente. */
    function enUso(fila: any) {
        return {
            activo: fila.activo,
            url_base: fila.url_base,
            token: descifrar(fila.token_cifrado),
            webhook_salida_url: fila.webhook_salida_url,
            webhook_salida_secreto: descifrar(fila.webhook_salida_secreto_cifrado),
            webhook_entrada_secreto: descifrar(fila.webhook_entrada_secreto_cifrado),
            token_argos_id: Number(fila.token_argos_id),
            contrato: fila.contrato,
            receptor_argos: fila.receptor_argos,
            conectado_por_enlace_en: new Date(fila.conectado_por_enlace_en).toISOString(),
            canje_confirmado_en: new Date(fila.canje_confirmado_en).toISOString(),
        }
    }

    test('reconectar y confirmar: el anterior sigue hasta la primera llamada del nuevo', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const viejo = await conectorEnUso(client, admin)

        const nuevo = await canjear(client, admin, NUEVO)
        const pendiente = await filaConector()
        assert.deepEqual(enUso(pendiente), enUso(viejo.fila))
        assert.isNotNull(pendiente.pendiente_token_argos_id)
        assert.isFalse(await tokenRevocado(viejo.tokenId))
        const v = await vista(client, admin)
        assert.equal(v.estado_canje, 'confirmado')
        assert.isNotNull(v.reconexion_pendiente_desde)
        assert.equal(
            new Date(v.reconexion_vence_en).getTime(),
            new Date(v.reconexion_pendiente_desde).getTime() + PLAZO_CONFIRMAR_CANJE_IRIS_MS,
        )
        // el atk_ anterior sigue funcionando (varias llamadas) y no confirma nada
        await estado(client.get(`${BASE_IRIS}/estado`).bearerToken(viejo.atk), 200)
        await estado(
            client.put(`${BASE_IRIS}/contrato`).bearerToken(viejo.atk).json({ contrato: '0.6.2' }),
            200,
        )
        assert.isNotNull(await pendienteDelConector())
        // la primera llamada del atk_ nuevo lo confirma: aquí el PUT del contrato, que Iris hace al activar
        await estado(
            client.put(`${BASE_IRIS}/contrato`).bearerToken(nuevo.atk).json({ contrato: '0.6.3' }),
            200,
        )
        assert.isTrue(await tokenRevocado(viejo.tokenId))
        await estado(client.get(`${BASE_IRIS}/estado`).bearerToken(viejo.atk), 401)

        const fila = await filaConector()
        assert.isTrue(fila.activo)
        assert.equal(descifrar(fila.token_cifrado), NUEVO.token)
        assert.equal(fila.webhook_salida_url, NUEVO.webhook.url)
        assert.equal(descifrar(fila.webhook_salida_secreto_cifrado), NUEVO.webhook.secreto)
        assert.equal(descifrar(fila.webhook_entrada_secreto_cifrado), nuevo.respuesta.webhook.secreto)
        assert.equal(fila.contrato, '0.6.3')
        assert.isTrue(fila.receptor_argos)
        assert.isNotNull(fila.canje_confirmado_en)
        assert.isNull(fila.pendiente_token_argos_id)
        assert.isNull(fila.pendiente_secreto_cifrado)
        assert.notEqual(Number(fila.token_argos_id), viejo.tokenId)
        const vista2 = await vista(client, admin)
        assert.isNull(vista2.reconexion_pendiente_desde)
        assert.isFalse(vista2.requiere_reconectar)

        const confirmacion = await db
            .from('audit.acciones')
            .where('accion', 'iris.confirmar_canje')
            .orderBy('id', 'desc')
            .first()
        assert.equal(confirmacion.resultado, 'ok')
        // los secretos pendientes quedan como *** en audit.cambios
        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'conector_iris', entidad_id: 1, campo: 'pendiente_secreto_cifrado' })
            .orderBy('id', 'asc')
            .first()
        assert.equal(String(cambio.despues).replaceAll('"', ''), '***')
    })

    test('reconectar y revocar: el anterior queda vivo y sin cambios', async ({ client, assert }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const viejo = await conectorEnUso(client, admin)
        const nuevo = await canjear(client, admin, NUEVO)
        const pendienteId = Number(await pendienteDelConector())

        await estado(client.post(`${BASE_IRIS}/conexion/revocar`).bearerToken(nuevo.atk), 204)
        assert.isTrue(await tokenRevocado(pendienteId))
        assert.isFalse(await tokenRevocado(viejo.tokenId))
        const fila = await filaConector()
        assert.deepEqual(enUso(fila), enUso(viejo.fila))
        assert.isNull(fila.pendiente_token_argos_id)
        assert.isNull(fila.desconectado_en)
        await estado(client.post(`${BASE_IRIS}/conexion/revocar`).bearerToken(nuevo.atk), 401)
        await estado(client.get(`${BASE_IRIS}/estado`).bearerToken(viejo.atk), 200)
        await estado(client.post(`${BASE_IRIS}/conexion/canjear`).json(nuevo.cuerpo), 410)
    })

    test('reconectar y vencer: a las 24 h sin uso se descarta y el anterior sigue', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const viejo = await conectorEnUso(client, admin)
        const nuevo = await canjear(client, admin, NUEVO)
        const pendienteId = Number(await pendienteDelConector())

        const temprano = await ejecutarCronCore(
            'iris_canjes_sin_uso',
            despuesDe(PLAZO_CONFIRMAR_CANJE_IRIS_MS - 60_000),
        )
        assert.isNull(temprano.resultado)
        const corrida = await ejecutarCronCore(
            'iris_canjes_sin_uso',
            despuesDe(PLAZO_CONFIRMAR_CANJE_IRIS_MS + 60_000),
        )
        assert.deepEqual(corrida.resultado, { resultado: 'sin_cambios', reconexion: 'vencida' })
        assert.isTrue(await tokenRevocado(pendienteId))
        assert.isFalse(await tokenRevocado(viejo.tokenId))
        const fila = await filaConector()
        assert.deepEqual(enUso(fila), enUso(viejo.fila))
        assert.isNull(fila.pendiente_token_argos_id)
        await estado(
            client.put(`${BASE_IRIS}/contrato`).bearerToken(nuevo.atk).json({ contrato: '0.6.3' }),
            401,
        )
        await estado(client.get(`${BASE_IRIS}/estado`).bearerToken(viejo.atk), 200)
    })

    test('dos canjes pendientes seguidos: el segundo reemplaza al primero, que se revoca', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const viejo = await conectorEnUso(client, admin)
        const primero = await canjear(client, admin, NUEVO)
        const primerId = Number(await pendienteDelConector())
        const segundo = await canjear(client, admin, { ...NUEVO, contrato: '0.6.3-rc.2' })
        const fila = await filaConector()
        const segundoId = Number(fila.pendiente_token_argos_id)
        assert.notEqual(segundoId, primerId)
        assert.isTrue(await tokenRevocado(primerId))
        assert.isFalse(await tokenRevocado(viejo.tokenId))
        assert.deepEqual(enUso(fila), enUso(viejo.fila))
        await estado(client.get(`${BASE_IRIS}/estado`).bearerToken(primero.atk), 401)

        await estado(client.get(`${BASE_IRIS}/estado`).bearerToken(segundo.atk), 200)
        const final = await filaConector()
        assert.equal(Number(final.token_argos_id), segundoId)
        assert.equal(final.contrato, '0.6.3-rc.2')
        assert.isTrue(await tokenRevocado(viejo.tokenId))
    })

    test('sobre un conector que nadie usó, el canje nuevo lo reemplaza al momento', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        await canjear(client, admin)
        const primerId = await tokenDelConector()
        await canjear(client, admin, NUEVO)
        const fila = await filaConector()
        assert.isTrue(await tokenRevocado(primerId))
        assert.isNull(fila.pendiente_token_argos_id)
        assert.equal(descifrar(fila.token_cifrado), NUEVO.token)
    })
})
