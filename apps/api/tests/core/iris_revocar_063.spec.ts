import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { ejecutarCronCore } from '#core/jobs'
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

function canje(codigo: string) {
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
    }
}

async function limpiarIris() {
    await db.from('integraciones.iris_enlaces').delete()
    await db.from('integraciones.iris_conector').delete()
}

async function canjear(client: any, admin: string) {
    const r = await estado(client.post(`${BASE_IRIS}/enlace`).bearerToken(admin), 201)
    const codigo = (r.body().enlace as string).split('#')[1]!
    const cuerpo = canje(codigo)
    const c = await estado(client.post(`${BASE_IRIS}/conexion/canjear`).json(cuerpo), 200)
    return { cuerpo, atk: c.body().token as string }
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
        assert.deepEqual(corrida.resultado, { resultado: 'desconectado' })
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

        const corrida = await ejecutarCronCore('iris_canjes_sin_uso', despuesDe(60_000))
        assert.deepEqual(corrida.resultado, { resultado: 'confirmado' })
        assert.equal(await estadoCanje(client, admin), 'confirmado')

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
        const corrida = await ejecutarCronCore(
            'iris_canjes_sin_uso',
            despuesDe(PLAZO_CONFIRMAR_CANJE_IRIS_MS + 60_000),
        )
        assert.deepEqual(corrida.resultado, { resultado: 'confirmado' })
        assert.isFalse(await tokenRevocado(await tokenDelConector()))
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
