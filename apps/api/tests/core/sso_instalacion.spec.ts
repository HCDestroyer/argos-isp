import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { ApiClient } from '@japa/api-client'
import { contextoPrueba, estado, unico } from '#tests/ayudas'
import GenerarTokenHorus from '#core/actions/generar_token_horus'
import GenerarTokenIris from '#core/actions/generar_token_iris'
import { usuarioIris } from '#core/integraciones_iris'
import { hostDeUrl, type ConectorSso } from '#core/sso'
import { cifrar } from '#shared/cifrado'

/**
 * Revisión de seguridad de Iris (B3): en `vinculacion_requerida` el canje dice a qué instalación
 * (host de la `url_base` del conector) y a qué usuario externo se le da acceso, para que quien
 * recibe un enlace reenviado no vincule su cuenta de Argos a la de otra persona sin verlo.
 */

const PANEL = 'http://localhost:3000'
const CANJEAR = '/api/v1/auth/sso/canjear'
const TABLAS: Record<ConectorSso, string> = {
    horus: 'integraciones.horus_conector',
    iris: 'integraciones.iris_conector',
}

async function tokenDe(sistema: ConectorSso): Promise<{ token: string; id: number }> {
    if (sistema === 'horus') {
        const g = await new GenerarTokenHorus().execute({}, contextoPrueba())
        return { token: g.token, id: Number(g.datos.id) }
    }
    const g = await new GenerarTokenIris().execute({ nombre: unico('Iris') }, contextoPrueba())
    await db
        .from('core.usuarios')
        .where('id', (await usuarioIris())!)
        .update({ activo: true, alcance_global: true })
    return { token: g.token, id: Number(g.datos.id) }
}

/**
 * Fila del conector configurada a mano (sin enlace), con esa `url_base`. Sin `url_base` el conector
 * no puede estar encendido (restricción de la tabla); el canje no lo exige sin enlace.
 */
async function conector(nombre: ConectorSso, urlBase: string | null) {
    await db.from(TABLAS[nombre]).delete()
    await db.table(TABLAS[nombre]).insert({
        id: 1,
        activo: urlBase !== null,
        url_base: urlBase,
        token_cifrado: cifrar(nombre === 'iris' ? 'iris_pat_prueba' : `hf_pat_${'h'.repeat(40)}`),
        webhook_salida_url: urlBase ? `${urlBase}/api/v1/webhook/c-1?firma=no-debe-salir` : null,
        webhook_salida_secreto_cifrado: cifrar('secreto-prueba'),
    })
}

async function canjeSinVinculo(
    client: ApiClient,
    nombre: ConectorSso,
    usuario: { id_externo: string; correo?: string | null; nombre?: string | null },
) {
    const { token } = await tokenDe(nombre)
    const emitido = await estado(
        client
            .post(`/api/v1/integraciones/${nombre}/sso/tickets`)
            .bearerToken(token)
            .json({ usuario, destino: { tipo: 'cliente', id_externo: '1' } }),
        201,
    )
    const ticket = (emitido.body().url as string).split('#')[1]!
    const canje = await estado(client.post(CANJEAR).header('Origin', PANEL).json({ ticket }), 200)
    return canje.body()
}

const idIris = () => unico('op').replace(/[^A-Za-z0-9_-]/g, '_')

test.group('SSO · instalación y usuario externo en vinculacion_requerida', (group) => {
    group.each.setup(async () => {
        await db.from('integraciones.iris_enlaces').delete()
        await db.from(TABLAS.iris).delete()
        await db.from(TABLAS.horus).delete()
        return async () => {
            await db.from(TABLAS.iris).delete()
            await db.from(TABLAS.horus).delete()
        }
    })

    test('Iris: host de la url_base (sin ruta ni secretos) y nombre y correo del ticket', async ({
        client,
        assert,
    }) => {
        await conector('iris', 'https://Iris.ISP.example/api/v1/')
        const id = idIris()
        const cuerpo = await canjeSinVinculo(client, 'iris', {
            id_externo: id,
            correo: 'ana@iris.example',
            nombre: 'Ana López',
        })
        assert.equal(cuerpo.resultado, 'vinculacion_requerida')
        assert.equal(cuerpo.conector, 'iris')
        assert.equal(cuerpo.vinculacion.instalacion, 'iris.isp.example')
        assert.deepEqual(cuerpo.vinculacion.usuario_externo, {
            id_externo: id,
            correo: 'ana@iris.example',
            nombre: 'Ana López',
        })
        const crudo = JSON.stringify(cuerpo)
        assert.notInclude(crudo, '/api/v1')
        assert.notInclude(crudo, 'iris_pat_')
        assert.notInclude(crudo, 'firma=')
    })

    test('Horus: host con el puerto no estándar; sin nombre ni correo llegan null', async ({
        client,
        assert,
    }) => {
        await conector('horus', 'https://horus.isp.example:8443')
        const cuerpo = await canjeSinVinculo(client, 'horus', { id_externo: unico('u') })
        assert.equal(cuerpo.resultado, 'vinculacion_requerida')
        assert.equal(cuerpo.conector, 'horus')
        assert.equal(cuerpo.vinculacion.instalacion, 'horus.isp.example:8443')
        assert.isNull(cuerpo.vinculacion.usuario_externo.correo)
        assert.isNull(cuerpo.vinculacion.usuario_externo.nombre)

        // con nombre y correo, llegan tal cual; vacíos cuentan como no traídos
        const con = await canjeSinVinculo(client, 'horus', {
            id_externo: unico('u'),
            correo: 'luis@horus.example',
            nombre: 'Luis Pérez',
        })
        assert.equal(con.vinculacion.usuario_externo.correo, 'luis@horus.example')
        assert.equal(con.vinculacion.usuario_externo.nombre, 'Luis Pérez')
        const vacios = await canjeSinVinculo(client, 'horus', {
            id_externo: unico('u'),
            correo: '',
            nombre: '  ',
        })
        assert.isNull(vacios.vinculacion.usuario_externo.correo)
        assert.isNull(vacios.vinculacion.usuario_externo.nombre)
    })

    test('sin url_base en el conector (o sin fila): instalacion null', async ({ client, assert }) => {
        await conector('iris', null)
        const cuerpo = await canjeSinVinculo(client, 'iris', { id_externo: idIris() })
        assert.equal(cuerpo.resultado, 'vinculacion_requerida')
        assert.isNull(cuerpo.vinculacion.instalacion)

        await db.from(TABLAS.horus).delete()
        const horus = await canjeSinVinculo(client, 'horus', { id_externo: unico('u') })
        assert.isNull(horus.vinculacion.instalacion)
    })

    test('hostDeUrl: solo el host, puerto solo si no es el estándar', ({ assert }) => {
        assert.equal(hostDeUrl('https://iris.isp.example:443/x?y=1#z'), 'iris.isp.example')
        assert.equal(hostDeUrl('http://iris.local:80'), 'iris.local')
        assert.equal(hostDeUrl('http://10.0.0.5:8080/api'), '10.0.0.5:8080')
        assert.equal(hostDeUrl('https://usuario:clave@iris.isp.example'), 'iris.isp.example')
        assert.isNull(hostDeUrl('ftp://iris.isp.example'))
        assert.isNull(hostDeUrl('no es url'))
        assert.isNull(hostDeUrl(null))
    })
})
