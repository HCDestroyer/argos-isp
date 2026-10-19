import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import {
    EnviadorFalso,
    crearServicio,
    crearSesion,
    nitAleatorio,
    usarEnviadorCodigo,
} from '#tests/portal/ayudas_portal'
import { generarTokenApi } from '#core/auth/token_api_guard'
import { generarTokenNodo, hashTokenNodo } from '#portal/nodo_portal'
import RevocarNodoPortal from '#portal/actions/revocar_nodo_portal'

/**
 * Nodo portal remoto (contrato `nodo-portal.md`) contra Postgres real. El cliente de pruebas
 * conecta desde 127.0.0.1, como un nodo que llega a la API central.
 */

const QUIEN_SOY = '/api/v1/portal/quien-soy'

/** Nodo directo en la tabla (la acción y su endpoint se prueban en el primer grupo). */
async function crearNodo(
    nombre = unico('nodo')
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-'),
): Promise<{ id: number; token: string }> {
    const { valor, hash } = generarTokenNodo()
    const [fila] = (await db.table('core.nodos_portal').insert({ nombre, hash }).returning('id')) as Array<{
        id: number
    }>
    return { id: Number(fila!.id), token: valor }
}

/** Servicio suspendido con una sesión PPPoE en `ip`. */
async function clienteEn(ip: string) {
    const s = await crearServicio({ nombre: 'María José García López' })
    await crearSesion(s, { ipv4: ip })
    return s
}

let previo: NodeJS.ProcessEnv

function prepararEntorno(proxies: string) {
    previo = { ...process.env }
    process.env.PORTAL_PROXIES_CONFIABLES = proxies
    delete process.env.PORTAL_CABECERA_IP
    process.env.PORTAL_REDIS_PREFIJO = unico('prueba-nodo')
    return () => {
        for (const clave of ['PORTAL_PROXIES_CONFIABLES', 'PORTAL_CABECERA_IP', 'PORTAL_REDIS_PREFIJO']) {
            if (previo[clave] === undefined) delete process.env[clave]
            else process.env[clave] = previo[clave]
        }
    }
}

test.group('Nodo portal: administración de tokens', (group) => {
    group.each.setup(() => prepararEntorno(''))

    test('admin crea, lista y revoca; el token se ve una sola vez y nunca se audita', async ({
        client,
        assert,
    }) => {
        const { token: admin, usuario } = await usuarioConRoles(['admin'])
        const nombre = unico('vps-xela')
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
        const creado = await estado(
            client.post('/api/v1/nodos-portal').bearerToken(admin).json({ nombre }),
            201,
        )
        const { token, datos } = creado.body()
        assert.match(token, /^argn_[A-Za-z0-9]{43}$/)
        assert.equal(datos.nombre, nombre)
        assert.equal(datos.creado_por, usuario.id)
        assert.isNull(datos.revocado_en)
        assert.notProperty(datos, 'hash')

        const fila = await db.from('core.nodos_portal').where('id', datos.id).firstOrFail()
        assert.equal(fila.hash, hashTokenNodo(token))

        const accion = await db
            .from('audit.acciones')
            .where('accion', 'nodos_portal.crear')
            .where('entidad_id', datos.id)
            .firstOrFail()
        assert.equal(accion.resultado, 'ok')
        const auditado = JSON.stringify(
            await db.from('audit.cambios').where('entidad_tipo', 'nodo_portal').where('entidad_id', datos.id),
        )
        assert.notInclude(JSON.stringify(accion) + auditado, token)
        assert.notInclude(JSON.stringify(accion) + auditado, fila.hash)

        const lista = await estado(client.get('/api/v1/nodos-portal').bearerToken(admin), 200)
        const enLista = lista.body().data.find((n: { id: number }) => n.id === datos.id)
        assert.equal(enLista.nombre, nombre)
        assert.notProperty(enLista, 'hash')
        assert.notInclude(JSON.stringify(lista.body()), token)

        const revocado = await estado(
            client.post(`/api/v1/nodos-portal/${datos.id}/revocar`).bearerToken(admin),
            200,
        )
        assert.isNotNull(revocado.body().revocado_en)
        const otraVez = await estado(
            client.post(`/api/v1/nodos-portal/${datos.id}/revocar`).bearerToken(admin),
            200,
        )
        assert.equal(otraVez.body().revocado_en, revocado.body().revocado_en)
        const revocaciones = await db
            .from('audit.cambios')
            .where('entidad_tipo', 'nodo_portal')
            .where('entidad_id', datos.id)
            .where('campo', 'revocado_en')
        assert.lengthOf(revocaciones, 1)
        await estado(client.post('/api/v1/nodos-portal/999999999/revocar').bearerToken(admin), 404)

        // el nombre es el identificador: repetido (aunque esté revocado) es 409; con mayúsculas, 422
        const repetido = await estado(
            client.post('/api/v1/nodos-portal').bearerToken(admin).json({ nombre }),
            409,
        )
        assert.equal(repetido.body().type, 'urn:argosisp:problema:nodo_portal_existe')
        for (const malo of ['Xela', '-xela', 'xela_1', 'a'.repeat(64), '']) {
            const r = await client.post('/api/v1/nodos-portal').bearerToken(admin).json({ nombre: malo })
            assert.equal(r.status(), 422, `${malo}: ${JSON.stringify(r.body())}`)
        }
    })

    test('solo con nodos_portal.administrar: cajero, soporte y lectura reciben 403', async ({ client }) => {
        for (const rol of ['cajero', 'soporte', 'lectura', 'contabilidad']) {
            const { token } = await usuarioConRoles([rol])
            await estado(client.get('/api/v1/nodos-portal').bearerToken(token), 403)
            await estado(
                client.post('/api/v1/nodos-portal').bearerToken(token).json({ nombre: 'x-nodo' }),
                403,
            )
        }
        await estado(client.get('/api/v1/nodos-portal'), 401)
    })

    test('el token de un nodo no sirve fuera del portal (ni como Bearer)', async ({ client }) => {
        const { token } = await crearNodo()
        for (const ruta of ['/api/v1/clientes', '/api/v1/nodos-portal', '/api/v1/me', '/api/v1/servicios']) {
            await estado(client.get(ruta).header('X-Argos-Nodo-Token', token), 401)
            await estado(client.get(ruta).bearerToken(token), 401)
        }
        await estado(client.get('/api/v1/internal/nodos-portal').header('X-Argos-Nodo-Token', token), 401)
    })

    test('GET /version responde al token del nodo; con uno inválido o revocado, 401', async ({
        client,
        assert,
    }) => {
        const { token, id } = await crearNodo()
        const conNodo = await estado(client.get('/api/v1/version').header('X-Argos-Nodo-Token', token), 200)
        assert.properties(conNodo.body(), ['version'])
        const { token: sesion } = await usuarioConRoles(['lectura'])
        const conSesion = await estado(client.get('/api/v1/version').bearerToken(sesion), 200)
        assert.equal(conSesion.body().version, conNodo.body().version)
        await estado(client.get('/api/v1/version'), 401)
        const inventado = await estado(
            client.get('/api/v1/version').header('X-Argos-Nodo-Token', `argn_${'A'.repeat(43)}`),
            401,
        )
        assert.equal(inventado.body().type, 'urn:argosisp:problema:nodo_portal_invalido')
        await new RevocarNodoPortal().execute({ id }, contextoPrueba())
        await estado(client.get('/api/v1/version').header('X-Argos-Nodo-Token', token), 401)
    })

    test('CLI: /internal/nodos-portal crea, lista y revoca por nombre con el token interno', async ({
        client,
        assert,
    }) => {
        const interno = env.get('INTERNAL_TOKEN')
        const nombre = unico('cli')
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
        const creado = await estado(
            client.post('/api/v1/internal/nodos-portal').bearerToken(interno).json({ nombre }),
            201,
        )
        assert.deepEqual(Object.keys(creado.body()).sort(), ['creado_en', 'nombre', 'token'])
        assert.equal(creado.body().nombre, nombre)
        assert.match(creado.body().token, /^argn_[A-Za-z0-9]{43}$/)
        await estado(client.post('/api/v1/internal/nodos-portal').bearerToken(interno).json({ nombre }), 409)

        const lista = await estado(client.get('/api/v1/internal/nodos-portal').bearerToken(interno), 200)
        const fila = lista.body().data.find((n: { nombre: string }) => n.nombre === nombre)
        assert.deepEqual(Object.keys(fila).sort(), ['creado_en', 'nombre', 'revocado_en', 'ultimo_uso_en'])
        assert.isNull(fila.revocado_en)

        const revocado = await estado(
            client.post(`/api/v1/internal/nodos-portal/${nombre}/revocar`).bearerToken(interno),
            200,
        )
        assert.deepEqual(Object.keys(revocado.body()).sort(), ['nombre', 'revocado_en'])
        assert.isNotNull(revocado.body().revocado_en)
        await estado(client.post('/api/v1/internal/nodos-portal/no-existe/revocar').bearerToken(interno), 404)

        // mismas acciones que el panel, actor sistema y canal interno
        const acciones = await db
            .from('audit.acciones')
            .whereIn('accion', ['nodos_portal.crear', 'nodos_portal.revocar'])
            .where('canal', 'interno')
            .where('entidad_tipo', 'nodo_portal')
            .orderBy('id', 'desc')
            .limit(2)
        assert.sameMembers(
            acciones.map((a) => a.accion),
            ['nodos_portal.crear', 'nodos_portal.revocar'],
        )
        assert.notInclude(JSON.stringify(acciones), creado.body().token)

        // sin el token interno (o con un token de sesión de admin) no entra
        const { token: admin } = await usuarioConRoles(['admin'])
        await estado(client.get('/api/v1/internal/nodos-portal'), 401)
        await estado(client.get('/api/v1/internal/nodos-portal').bearerToken(admin), 401)
    })
})

test.group('Nodo portal: IP real del cliente', (group) => {
    // Sin proxies confiables: la API central no confía en ningún X-Forwarded-For.
    group.each.setup(() => prepararEntorno(''))

    test('con token válido identifica al cliente por X-Argos-Cliente-Ip (IPv4 e IPv6)', async ({
        client,
        assert,
    }) => {
        const { token, id } = await crearNodo()
        await clienteEn('198.51.100.71')
        const s6 = await crearServicio({ nombre: 'Pedro Pablo Ramírez' })
        await crearSesion(s6, { enlace: '2001:db8:71:1::/64', delegado: '2001:db8:71:100::/56' })

        const v4 = await estado(
            client
                .get(QUIEN_SOY)
                .header('X-Argos-Nodo-Token', token)
                .header('X-Argos-Cliente-Ip', '198.51.100.71'),
            200,
        )
        assert.isTrue(v4.body().identificado)
        assert.equal(v4.body().ip, '198.51.100.71')
        assert.equal(v4.body().nombre_parcial, 'María J.')

        const v6 = await estado(
            client
                .get(QUIEN_SOY)
                .header('X-Argos-Nodo-Token', token)
                .header('X-Argos-Cliente-Ip', '2001:DB8:71:100::5'),
            200,
        )
        assert.isTrue(v6.body().identificado)
        assert.equal(v6.body().ip, '2001:db8:71:100::5')
        assert.equal(v6.body().nombre_parcial, 'Pedro P.')

        // Con token, X-Forwarded-For no cuenta (aunque 127.0.0.1 fuera confiable)
        process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1'
        const conXff = await estado(
            client
                .get(QUIEN_SOY)
                .header('X-Argos-Nodo-Token', token)
                .header('X-Argos-Cliente-Ip', '198.51.100.71')
                .header('X-Forwarded-For', '203.0.113.250'),
            200,
        )
        assert.equal(conXff.body().ip, '198.51.100.71')

        const nodo = await db.from('core.nodos_portal').where('id', id).firstOrFail()
        assert.isNotNull(nodo.ultimo_uso)
        assert.include(['127.0.0.1', '::1'], nodo.ultima_ip)
    })

    test('sin token, X-Argos-Cliente-Ip se ignora: nadie suplanta la IP de otro cliente', async ({
        client,
        assert,
    }) => {
        await clienteEn('198.51.100.72')
        const intentos = [
            client.get(QUIEN_SOY).header('X-Argos-Cliente-Ip', '198.51.100.72'),
            client
                .get(QUIEN_SOY)
                .header('X-Argos-Cliente-Ip', '198.51.100.72')
                .header('Authorization', 'Bearer'),
            client
                .get(QUIEN_SOY)
                .header('X-Argos-Cliente-Ip', '198.51.100.72')
                .header('Authorization', 'Basic eDp5'),
            client
                .get(QUIEN_SOY)
                .header('X-Argos-Cliente-Ip', '198.51.100.72')
                .header('X-Argos-Nodo-Token', ''),
        ]
        for (const intento of intentos) {
            const r = await estado(intento, 200)
            assert.isFalse(r.body().identificado)
            assert.include(['127.0.0.1', '::1'], r.body().ip)
        }

        // Un token de API válido (atk_) tampoco convierte a nadie en nodo
        const { usuario } = await usuarioConRoles(['admin'])
        const { valor, hash } = generarTokenApi()
        await db
            .table('core.tokens_api')
            .insert({ usuario_id: usuario.id, nombre: 'x', hash, alcances: '{}' })
        const conAtk = await estado(
            client.get(QUIEN_SOY).bearerToken(valor).header('X-Argos-Cliente-Ip', '198.51.100.72'),
            200,
        )
        assert.isFalse(conAtk.body().identificado)

        // Con un proxy confiable, la cabecera propia sigue sin contar: solo la cadena del proxy
        process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1'
        const viaProxy = await estado(
            client
                .get(QUIEN_SOY)
                .header('X-Argos-Cliente-Ip', '198.51.100.72')
                .header('X-Forwarded-For', '203.0.113.9'),
            200,
        )
        assert.isFalse(viaProxy.body().identificado)
        assert.equal(viaProxy.body().ip, '203.0.113.9')
    })

    test('token inventado o revocado: 401 nodo_portal_invalido, nunca la IP de la cabecera', async ({
        client,
        assert,
    }) => {
        await clienteEn('198.51.100.73')
        const inventado = await estado(
            client
                .get(QUIEN_SOY)
                .header('X-Argos-Nodo-Token', `argn_${'A'.repeat(43)}`)
                .header('X-Argos-Cliente-Ip', '198.51.100.73'),
            401,
        )
        assert.equal(inventado.body().type, 'urn:argosisp:problema:nodo_portal_invalido')
        assert.notProperty(inventado.body(), 'nombre_parcial')

        const { token, id } = await crearNodo()
        await estado(
            client
                .get(QUIEN_SOY)
                .header('X-Argos-Nodo-Token', token)
                .header('X-Argos-Cliente-Ip', '198.51.100.73'),
            200,
        )
        await new RevocarNodoPortal().execute({ id }, contextoPrueba())
        const revocado = await estado(
            client
                .get(QUIEN_SOY)
                .header('X-Argos-Nodo-Token', token)
                .header('X-Argos-Cliente-Ip', '198.51.100.73'),
            401,
        )
        assert.equal(revocado.body().type, 'urn:argosisp:problema:nodo_portal_invalido')
        // También en las rutas con sesión y en las que cambian algo
        await estado(
            client
                .post('/api/v1/portal/codigo')
                .header('X-Argos-Nodo-Token', token)
                .header('X-Argos-Cliente-Ip', '198.51.100.73')
                .json({ por_ip: true }),
            401,
        )
        await estado(
            client
                .get('/api/v1/portal/cuenta')
                .header('X-Argos-Nodo-Token', token)
                .header('X-Argos-Cliente-Ip', '198.51.100.73'),
            401,
        )
    })

    test('token válido sin X-Argos-Cliente-Ip o con una que no es IP: 400', async ({ client, assert }) => {
        const { token } = await crearNodo()
        for (const valor of [undefined, '', 'no-es-ip', '198.51.100.300', '198.51.100.1, 198.51.100.2']) {
            const peticion = client.get(QUIEN_SOY).header('X-Argos-Nodo-Token', token)
            if (valor !== undefined) peticion.header('X-Argos-Cliente-Ip', valor)
            const r = await estado(peticion, 400)
            assert.equal(r.body().type, 'urn:argosisp:problema:ip_cliente_invalida')
        }
    })

    test('el límite de peticiones cuenta por cliente, no por nodo', async ({ client }) => {
        process.env.PORTAL_LIMITE_PETICIONES = '2'
        try {
            const { token } = await crearNodo()
            for (let i = 0; i < 2; i++) {
                await estado(
                    client
                        .get(QUIEN_SOY)
                        .header('X-Argos-Nodo-Token', token)
                        .header('X-Argos-Cliente-Ip', '198.51.100.81'),
                    200,
                )
            }
            await estado(
                client
                    .get(QUIEN_SOY)
                    .header('X-Argos-Nodo-Token', token)
                    .header('X-Argos-Cliente-Ip', '198.51.100.81'),
                429,
            )
            await estado(
                client
                    .get(QUIEN_SOY)
                    .header('X-Argos-Nodo-Token', token)
                    .header('X-Argos-Cliente-Ip', '198.51.100.82'),
                200,
            )
        } finally {
            delete process.env.PORTAL_LIMITE_PETICIONES
        }
    })
})

test.group('Nodo portal: sesión del cliente', (group) => {
    let enviador: EnviadorFalso
    group.each.setup(() => {
        const restaurar = prepararEntorno('')
        enviador = new EnviadorFalso()
        usarEnviadorCodigo(enviador)
        return () => {
            usarEnviadorCodigo(undefined)
            restaurar()
        }
    })

    test('la cookie es Secure según X-Argos-Cliente-Proto del nodo', async ({ client, assert }) => {
        const { token } = await crearNodo()
        for (const [proto, segura] of [
            ['https', true],
            ['http', false],
        ] as const) {
            const nit = nitAleatorio()
            await crearServicio({ nit })
            const ip = `198.51.100.${proto === 'https' ? 91 : 92}`
            const pedido = await estado(
                client
                    .post('/api/v1/portal/codigo')
                    .header('X-Argos-Nodo-Token', token)
                    .header('X-Argos-Cliente-Ip', ip)
                    .header('X-Argos-Cliente-Proto', proto)
                    .json({ identificador: nit }),
                202,
            )
            const verificado = await estado(
                client
                    .post('/api/v1/portal/verificar')
                    .header('X-Argos-Nodo-Token', token)
                    .header('X-Argos-Cliente-Ip', ip)
                    .header('X-Argos-Cliente-Proto', proto)
                    .json({ solicitud: pedido.body().solicitud, codigo: enviador.ultimoCodigo() }),
                200,
            )
            const cookie = ([] as string[]).concat(verificado.header('set-cookie') ?? []).join('\n')
            assert.include(cookie, 'argos_portal=')
            if (segura) assert.match(cookie, /;\s*Secure/i)
            else assert.notMatch(cookie, /;\s*Secure/i)

            // La sesión queda con la IP del cliente, no la del nodo
            const sesion = await db
                .from('core.portal_sesiones')
                .orderBy('id', 'desc')
                .select(db.raw('host(ip) as ip'))
                .firstOrFail()
            assert.equal(sesion.ip, ip)
        }
    })
})
