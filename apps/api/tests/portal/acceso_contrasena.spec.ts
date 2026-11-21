import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import hash from '@adonisjs/core/services/hash'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearEmpresaFila } from '#tests/core/fabricas'
import {
    cookieDeSesion,
    crearServicio,
    crearSesion,
    nitAleatorio,
    sesionDirecta,
} from '#tests/portal/ayudas_portal'
import { generarCodigoCorte } from '#portal/codigos_corte'

/**
 * Entrada al portal con documento y contraseña, contraseña por defecto de la empresa, cambio de
 * contraseña, restauración desde el panel y «Ver mi cuenta» en `/corte` (pedido del PM). Postgres
 * y Redis reales; la IP del cliente viaja en X-Forwarded-For desde 127.0.0.1 (proxy confiable).
 */

const VARIABLES = [
    'PORTAL_PROXIES_CONFIABLES',
    'PORTAL_REDIS_PREFIJO',
    'PORTAL_LIMITE_PETICIONES',
    'PORTAL_CONTRASENA_FALLOS_DOCUMENTO',
    'PORTAL_CONTRASENA_FALLOS_IP',
    'PORTAL_SESION_CORTE_MAX_S',
] as const

const CONTRASENA_DEFECTO = 'Bienvenido2026'

let secuencia = Math.floor(Math.random() * 150_000)
/**
 * IPs distintas por prueba (no comparten límites ni sesiones de otras suites). Salen de
 * 100.124.0.0–100.126.255.255: `redUnica()` de las fábricas reparte redes desde 100.64.0.0, y una
 * IP de este archivo que cayera en la asignación de otro servicio identificaría a ese servicio en
 * `/corte` (422 `no_identificado` intermitente en CI).
 */
function ipNueva(): string {
    secuencia += 1
    const n = secuencia % (3 * 256 * 254)
    return `100.${124 + Math.floor(n / (256 * 254))}.${Math.floor(n / 254) % 256}.${(n % 254) + 1}`
}

/** Admin con la empresa 1 activa: configura la contraseña por defecto de esa empresa. */
async function configurarDefecto(client: ApiClient, contrasena = CONTRASENA_DEFECTO): Promise<void> {
    const { token } = await usuarioConRoles(['admin'])
    const actual = await estado(
        client.get('/api/v1/empresa/contrasena-portal').bearerToken(token).header('X-Empresa-Id', '1'),
        200,
    )
    await estado(
        client
            .put('/api/v1/empresa/contrasena-portal')
            .bearerToken(token)
            .header('X-Empresa-Id', '1')
            .json({ contrasena, version: actual.body().version }),
        200,
    )
}

function entrar(client: ApiClient, ip: string, cuerpo: Record<string, unknown>) {
    return client.post('/api/v1/portal/entrar').header('X-Forwarded-For', ip).json(cuerpo)
}

/** Documento escrito como lo haría el cliente: con guion y en minúsculas. */
function comoLoEscribe(nit: string): string {
    return `${nit.slice(0, -1)}-${nit.slice(-1)}`.toLowerCase()
}

/** Ninguna fila de auditoría del cliente guarda el texto en claro. */
async function sinTextoEnAuditoria(assert: any, clienteId: number, ...textos: string[]) {
    const acciones = await db.from('audit.acciones').where('entidad_id', clienteId).select('entrada')
    const cambios = await db
        .from('audit.cambios')
        .where('entidad_tipo', 'cliente')
        .where('entidad_id', clienteId)
        .select('antes', 'despues')
    const todo = JSON.stringify([acciones, cambios])
    for (const texto of textos) assert.notInclude(todo, texto)
}

test.group('Portal: documento y contraseña', (group) => {
    group.each.setup(() => {
        const previo = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
        process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1'
        process.env.PORTAL_REDIS_PREFIJO = unico('prueba-contrasena')
        delete process.env.PORTAL_LIMITE_PETICIONES
        delete process.env.PORTAL_CONTRASENA_FALLOS_DOCUMENTO
        delete process.env.PORTAL_CONTRASENA_FALLOS_IP
        delete process.env.PORTAL_SESION_CORTE_MAX_S
        return () => {
            for (const variable of VARIABLES) {
                if (previo[variable] === undefined) delete process.env[variable]
                else process.env[variable] = previo[variable]
            }
        }
    })

    test('con la por defecto entra, debe cambiarla antes de seguir y luego entra con la suya', async ({
        client,
        assert,
    }) => {
        await configurarDefecto(client)
        const nit = nitAleatorio()
        const s = await crearServicio({ nit, empresaId: 1 })
        const ip = ipNueva()

        const entrada = await estado(
            entrar(client, ip, { documento: ` ${comoLoEscribe(nit)} `, contrasena: CONTRASENA_DEFECTO }),
            200,
        )
        assert.containsSubset(entrada.body(), {
            cliente: { nombre_parcial: 'María J.' },
            origen: 'contrasena',
            debe_cambiar_contrasena: true,
        })
        const setCookie = String(entrada.headers()['set-cookie'])
        assert.include(setCookie, 'HttpOnly')
        assert.include(setCookie, 'SameSite=Strict')
        const cookie = cookieDeSesion(entrada)!

        // Antes de cambiarla: 403 en todo lo demás, pero la sesión se puede leer y cerrar.
        const bloqueada = await estado(client.get('/api/v1/portal/cuenta').header('Cookie', cookie), 403)
        assert.equal(bloqueada.body().type, 'urn:argosisp:problema:cambio_contrasena_requerido')
        await estado(client.get('/api/v1/portal/facturas').header('Cookie', cookie), 403)
        const sesion = await estado(client.get('/api/v1/portal/sesion').header('Cookie', cookie), 200)
        assert.isTrue(sesion.body().debe_cambiar_contrasena)

        // La actual equivocada, la nueva igual a la por defecto o al documento: 422 en su campo.
        const mala = await estado(
            client
                .post('/api/v1/portal/contrasena')
                .header('Cookie', cookie)
                .header('X-Forwarded-For', ip)
                .json({ contrasena_actual: 'otra-cosa', contrasena_nueva: 'MiClaveNueva1' }),
            422,
        )
        assert.equal(mala.body().errors[0].field, 'contrasena_actual')
        const igual = await estado(
            client
                .post('/api/v1/portal/contrasena')
                .header('Cookie', cookie)
                .header('X-Forwarded-For', ip)
                .json({ contrasena_actual: CONTRASENA_DEFECTO, contrasena_nueva: CONTRASENA_DEFECTO }),
            422,
        )
        assert.equal(igual.body().errors[0].field, 'contrasena_nueva')
        const documento = await estado(
            client
                .post('/api/v1/portal/contrasena')
                .header('Cookie', cookie)
                .header('X-Forwarded-For', ip)
                .json({ contrasena_actual: CONTRASENA_DEFECTO, contrasena_nueva: comoLoEscribe(nit) }),
            422,
        )
        assert.equal(documento.body().errors[0].field, 'contrasena_nueva')
        const corta = await estado(
            client
                .post('/api/v1/portal/contrasena')
                .header('Cookie', cookie)
                .header('X-Forwarded-For', ip)
                .json({ contrasena_actual: CONTRASENA_DEFECTO, contrasena_nueva: 'corta' }),
            422,
        )
        assert.equal(corta.body().errors[0].field, 'contrasena_nueva')

        // Otra sesión abierta del mismo cliente se cierra al cambiarla.
        const otra = await sesionDirecta(s.clienteId)
        const cambio = await estado(
            client
                .post('/api/v1/portal/contrasena')
                .header('Cookie', cookie)
                .header('X-Forwarded-For', ip)
                .json({ contrasena_actual: CONTRASENA_DEFECTO, contrasena_nueva: 'MiClaveNueva1' }),
            200,
        )
        assert.equal(cambio.body().sesiones_cerradas, 1)
        await estado(client.get('/api/v1/portal/cuenta').header('Cookie', otra.cookie), 401)
        const cuenta = await estado(client.get('/api/v1/portal/cuenta').header('Cookie', cookie), 200)
        assert.equal(cuenta.body().cliente.nombre, 'María José García López')

        // Solo el hash en la base.
        const credencial = await db
            .from('core.portal_credenciales')
            .where('cliente_id', s.clienteId)
            .firstOrFail()
        assert.notInclude(credencial.contrasena_hash, 'MiClaveNueva1')
        assert.isTrue(await hash.verify(credencial.contrasena_hash, 'MiClaveNueva1'))

        // Ya con la suya: la por defecto deja de servir y la nueva entra sin pedir cambio.
        await estado(entrar(client, ip, { documento: nit, contrasena: CONTRASENA_DEFECTO }), 422)
        const otraVez = await estado(entrar(client, ip, { documento: nit, contrasena: 'MiClaveNueva1' }), 200)
        assert.isFalse(otraVez.body().debe_cambiar_contrasena)

        // Auditoría: canal portal, actor cliente; contraseñas y documento como ***.
        const filas = await db
            .from('audit.acciones')
            .whereIn('accion', ['portal.entrar_con_contrasena', 'portal.cambiar_contrasena'])
            .where('entidad_id', s.clienteId)
            .where('resultado', 'ok')
            .select('accion', 'canal', 'actor_tipo', 'actor_id', 'entrada')
        assert.isAtLeast(filas.length, 3)
        for (const fila of filas) {
            assert.equal(fila.canal, 'portal')
            assert.equal(fila.actor_tipo, 'cliente')
            assert.equal(Number(fila.actor_id), s.clienteId)
        }
        const login = filas.find((f) => f.accion === 'portal.entrar_con_contrasena')!
        assert.equal(login.entrada.documento, '***')
        assert.equal(login.entrada.contrasena, '***')
        const cambioAuditado = await db
            .from('audit.cambios')
            .where('entidad_tipo', 'cliente')
            .where('entidad_id', s.clienteId)
            .where('campo', 'portal_contrasena')
            .firstOrFail()
        assert.equal(cambioAuditado.despues, '***')
        await sinTextoEnAuditoria(assert, s.clienteId, CONTRASENA_DEFECTO, 'MiClaveNueva1', nit)
    })

    test('mensaje genérico: documento que no existe, contraseña errada, CF y sin contraseña por defecto', async ({
        client,
        assert,
    }) => {
        await configurarDefecto(client)
        const nit = nitAleatorio()
        await crearServicio({ nit, empresaId: 1 })
        const ip = ipNueva()

        const noExiste = await estado(
            entrar(client, ip, { documento: nitAleatorio(), contrasena: CONTRASENA_DEFECTO }),
            422,
        )
        const errada = await estado(entrar(client, ip, { documento: nit, contrasena: 'no-es-esta' }), 422)
        const cf = await estado(entrar(client, ip, { documento: 'C/F', contrasena: CONTRASENA_DEFECTO }), 422)
        assert.equal(noExiste.body().type, 'urn:argosisp:problema:credenciales_invalidas')
        assert.deepEqual(errada.body(), noExiste.body())
        assert.deepEqual(cf.body(), noExiste.body())
        assert.isNull(cookieDeSesion(errada))
    })

    test('documento de varios clientes: la por defecto no entra; la propia entra al suyo', async ({
        client,
        assert,
    }) => {
        await configurarDefecto(client)
        const nit = nitAleatorio()
        const uno = await crearServicio({ nit, empresaId: 1, nombre: 'Ana Uno Pérez' })
        const dos = await crearServicio({ nit, empresaId: 1, nombre: 'Beto Dos López' })
        const ip = ipNueva()

        await estado(entrar(client, ip, { documento: nit, contrasena: CONTRASENA_DEFECTO }), 422)

        await db
            .table('core.portal_credenciales')
            .insert({ cliente_id: dos.clienteId, contrasena_hash: await hash.make('ClaveDeBeto99') })
        const beto = await estado(entrar(client, ip, { documento: nit, contrasena: 'ClaveDeBeto99' }), 200)
        assert.equal(beto.body().cliente.nombre_parcial, 'Beto D.')
        const cuenta = await estado(
            client.get('/api/v1/portal/cuenta').header('Cookie', cookieDeSesion(beto)!),
            200,
        )
        assert.equal(cuenta.body().cliente.nombre, 'Beto Dos López')
        assert.notEqual(uno.clienteId, dos.clienteId)
    })

    test('empresa del portal: con empresa_id solo entran sus clientes y con su contraseña por defecto', async ({
        client,
        assert,
        cleanup,
    }) => {
        await configurarDefecto(client)
        const otra = await crearEmpresaFila()
        cleanup(async () => {
            await db.from('core.empresas').where('id', otra).update({ activa: false })
        })
        const nit = nitAleatorio()
        await crearServicio({ nit, empresaId: 1 })
        const ip = ipNueva()

        await estado(
            entrar(client, ip, { documento: nit, contrasena: CONTRASENA_DEFECTO, empresa_id: otra }),
            422,
        )
        const propia = await estado(
            entrar(client, ip, { documento: nit, contrasena: CONTRASENA_DEFECTO, empresa_id: 1 }),
            200,
        )
        assert.equal(propia.body().empresa_principal.id, 1)
    })

    test('límite por documento: al pasarse responde 429 aunque la contraseña sea la buena', async ({
        client,
        assert,
    }) => {
        process.env.PORTAL_CONTRASENA_FALLOS_DOCUMENTO = '3'
        await configurarDefecto(client)
        const nit = nitAleatorio()
        await crearServicio({ nit, empresaId: 1 })

        for (let i = 0; i < 3; i++) {
            await estado(entrar(client, ipNueva(), { documento: nit, contrasena: `mala-${i}` }), 422)
        }
        const bloqueado = await estado(
            entrar(client, ipNueva(), { documento: comoLoEscribe(nit), contrasena: CONTRASENA_DEFECTO }),
            429,
        )
        assert.equal(bloqueado.body().type, 'urn:argosisp:problema:demasiados_intentos')
        assert.isAbove(Number(bloqueado.headers()['retry-after']), 0)
        // Las filas guardan el HMAC del documento, nunca el documento.
        const intentos = await db.from('core.portal_intentos_contrasena').select('clave_documento')
        assert.notInclude(JSON.stringify(intentos), nit)
    })

    test('límite por IP: muchos documentos desde la misma IP', async ({ client, assert }) => {
        process.env.PORTAL_CONTRASENA_FALLOS_IP = '3'
        const ip = ipNueva()
        for (let i = 0; i < 3; i++) {
            await estado(entrar(client, ip, { documento: nitAleatorio(), contrasena: 'x' }), 422)
        }
        const bloqueado = await estado(
            entrar(client, ip, { documento: nitAleatorio(), contrasena: 'x' }),
            429,
        )
        assert.equal(bloqueado.body().type, 'urn:argosisp:problema:demasiados_intentos')
        // Otra IP sigue pudiendo intentar.
        await estado(entrar(client, ipNueva(), { documento: nitAleatorio(), contrasena: 'x' }), 422)
    })
})

test.group('Panel: contraseña del portal', (group) => {
    group.each.setup(() => {
        const previo = process.env.PORTAL_PROXIES_CONFIABLES
        process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1'
        return () => {
            if (previo === undefined) delete process.env.PORTAL_PROXIES_CONFIABLES
            else process.env.PORTAL_PROXIES_CONFIABLES = previo
        }
    })

    test('configurar la por defecto: permiso, versión, solo el hash y auditoría con ***', async ({
        client,
        assert,
        cleanup,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { token: soporte } = await usuarioConRoles(['soporte'])
        const empresa = await crearEmpresaFila()
        cleanup(async () => {
            await db.from('core.empresas').where('id', empresa).update({ activa: false })
        })
        const ver = () =>
            client
                .get('/api/v1/empresa/contrasena-portal')
                .bearerToken(token)
                .header('X-Empresa-Id', String(empresa))

        const inicial = await estado(ver(), 200)
        assert.deepEqual(inicial.body(), {
            empresa_id: empresa,
            configurada: false,
            actualizada_en: null,
            version: 0,
        })

        await estado(
            client
                .put('/api/v1/empresa/contrasena-portal')
                .bearerToken(soporte)
                .header('X-Empresa-Id', String(empresa))
                .json({ contrasena: 'ClaveEmpresa1', version: 0 }),
            403,
        )
        const corta = await estado(
            client
                .put('/api/v1/empresa/contrasena-portal')
                .bearerToken(token)
                .header('X-Empresa-Id', String(empresa))
                .json({ contrasena: 'corta', version: 0 }),
            422,
        )
        assert.equal(corta.body().errors[0].field, 'contrasena')

        const guardada = await estado(
            client
                .put('/api/v1/empresa/contrasena-portal')
                .bearerToken(token)
                .header('X-Empresa-Id', String(empresa))
                .json({ contrasena: 'ClaveEmpresa1', version: 0 }),
            200,
        )
        assert.containsSubset(guardada.body(), { empresa_id: empresa, configurada: true, version: 1 })
        assert.notProperty(guardada.body(), 'contrasena')

        await estado(
            client
                .put('/api/v1/empresa/contrasena-portal')
                .bearerToken(token)
                .header('X-Empresa-Id', String(empresa))
                .json({ contrasena: 'ClaveEmpresa2', version: 0 }),
            409,
        )
        await estado(
            client
                .put('/api/v1/empresa/contrasena-portal')
                .bearerToken(token)
                .header('X-Empresa-Id', String(empresa))
                .json({ contrasena: 'ClaveEmpresa2', version: 1 }),
            200,
        )

        const fila = await db
            .from('core.portal_contrasenas_defecto')
            .where('empresa_id', empresa)
            .firstOrFail()
        assert.isTrue(await hash.verify(fila.contrasena_hash, 'ClaveEmpresa2'))
        const auditoria = await db
            .from('audit.acciones')
            .where('accion', 'portal.configurar_contrasena_defecto')
            .where('entidad_id', empresa)
            .where('resultado', 'ok')
            .select('entrada', 'empresa_id')
        assert.lengthOf(auditoria, 2)
        assert.equal(auditoria[0]!.entrada.contrasena, '***')
        assert.equal(Number(auditoria[0]!.empresa_id), empresa)
        const cambios = await db
            .from('audit.cambios')
            .where('entidad_tipo', 'empresa')
            .where('entidad_id', empresa)
            .where('campo', 'portal_contrasena_defecto')
            .select('antes', 'despues')
        assert.lengthOf(cambios, 2)
        assert.notInclude(JSON.stringify([auditoria, cambios]), 'ClaveEmpresa')
    })

    test('restaurar: borra la propia, cierra sesiones, pide cambiar al entrar; permiso y 404', async ({
        client,
        assert,
    }) => {
        await configurarDefecto(client)
        const { token } = await usuarioConRoles(['soporte'])
        const { token: lectura } = await usuarioConRoles(['lectura'])
        const nit = nitAleatorio()
        const s = await crearServicio({ nit, empresaId: 1 })
        await db
            .table('core.portal_credenciales')
            .insert({ cliente_id: s.clienteId, contrasena_hash: await hash.make('SuClaveVieja1') })
        const abierta = await sesionDirecta(s.clienteId)

        const antes = await estado(
            client.get(`/api/v1/clientes/${s.clienteId}/contrasena-portal`).bearerToken(lectura),
            200,
        )
        assert.containsSubset(antes.body(), { propia: true, defecto_configurada: true })

        await estado(
            client.post(`/api/v1/clientes/${s.clienteId}/restaurar-contrasena-portal`).bearerToken(lectura),
            403,
        )
        await estado(
            client.post('/api/v1/clientes/999999999/restaurar-contrasena-portal').bearerToken(token),
            404,
        )

        const restaurada = await estado(
            client.post(`/api/v1/clientes/${s.clienteId}/restaurar-contrasena-portal`).bearerToken(token),
            200,
        )
        assert.containsSubset(restaurada.body(), {
            cliente_id: s.clienteId,
            propia: false,
            defecto_configurada: true,
            sesiones_cerradas: 1,
        })
        await estado(client.get('/api/v1/portal/cuenta').header('Cookie', abierta.cookie), 401)

        // Idempotente
        const otraVez = await estado(
            client.post(`/api/v1/clientes/${s.clienteId}/restaurar-contrasena-portal`).bearerToken(token),
            200,
        )
        assert.equal(otraVez.body().sesiones_cerradas, 0)

        const ip = ipNueva()
        await estado(entrar(client, ip, { documento: nit, contrasena: 'SuClaveVieja1' }), 422)
        const nueva = await estado(
            entrar(client, ip, { documento: nit, contrasena: CONTRASENA_DEFECTO }),
            200,
        )
        assert.isTrue(nueva.body().debe_cambiar_contrasena)

        const fila = await db
            .from('audit.acciones')
            .where('accion', 'clientes.restaurar_contrasena_portal')
            .where('entidad_id', s.clienteId)
            .where('resultado', 'ok')
            .select('canal', 'actor_tipo', 'entrada')
        assert.lengthOf(fila, 2)
        assert.equal(fila[0]!.actor_tipo, 'usuario')
        const cambio = await db
            .from('audit.cambios')
            .where('entidad_tipo', 'cliente')
            .where('entidad_id', s.clienteId)
            .where('campo', 'portal_contrasena')
            .firstOrFail()
        assert.equal(cambio.antes, '***')
        await sinTextoEnAuditoria(assert, s.clienteId, 'SuClaveVieja1', CONTRASENA_DEFECTO)
    })
})

test.group('Portal: «Ver mi cuenta» desde /corte', (group) => {
    group.each.setup(() => {
        const previo = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
        process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1'
        process.env.PORTAL_REDIS_PREFIJO = unico('prueba-corte-sesion')
        delete process.env.PORTAL_LIMITE_PETICIONES
        delete process.env.PORTAL_SESION_CORTE_MAX_S
        return () => {
            for (const variable of VARIABLES) {
                if (previo[variable] === undefined) delete process.env[variable]
                else process.env[variable] = previo[variable]
            }
        }
    })

    test('por IP en sesión PPPoE vigente: sesión corta del cliente, auditada como cliente/portal', async ({
        client,
        assert,
    }) => {
        const s = await crearServicio({ nit: nitAleatorio(), empresaId: 1 })
        const ip = ipNueva()
        await crearSesion(s, { ipv4: ip })

        const respuesta = await estado(
            client.post('/api/v1/portal/corte/sesion').header('X-Forwarded-For', ip),
            200,
        )
        assert.containsSubset(respuesta.body(), {
            origen: 'corte',
            debe_cambiar_contrasena: false,
            cliente: { nombre_parcial: 'María J.' },
        })
        const cookie = cookieDeSesion(respuesta)!
        const cuenta = await estado(client.get('/api/v1/portal/cuenta').header('Cookie', cookie), 200)
        assert.equal(cuenta.body().cliente.nombre, 'María José García López')

        const sesion = await db
            .from('core.portal_sesiones')
            .where('cliente_id', s.clienteId)
            .where('origen', 'corte')
            .select(db.raw('extract(epoch from expira_max_en - created_at) AS vida'), 'servicio_id')
            .firstOrFail()
        assert.isAtMost(Number(sesion.vida), 901)
        assert.equal(Number(sesion.servicio_id), s.servicioId)

        const fila = await db
            .from('audit.acciones')
            .where('accion', 'portal.abrir_sesion_corte')
            .where('entidad_id', s.clienteId)
            .select('canal', 'actor_tipo', 'actor_id', 'resultado')
            .firstOrFail()
        assert.containsSubset(fila, { canal: 'portal', actor_tipo: 'cliente', resultado: 'ok' })
        assert.equal(Number(fila.actor_id), s.clienteId)
    })

    test('por IPv6 delegada en sesión vigente', async ({ client }) => {
        const s = await crearServicio({ nit: nitAleatorio(), empresaId: 1 })
        const prefijo = `2001:db8:${(secuencia++ % 9000) + 1000}:a00::/56`
        await crearSesion(s, { delegado: prefijo })
        await estado(
            client
                .post('/api/v1/portal/corte/sesion')
                .header('X-Forwarded-For', prefijo.replace('::/56', '::99')),
            200,
        )
    })

    test('sin sesión vigente no hay acceso: asignación sin sesión, sesión cerrada, IP desconocida', async ({
        client,
        assert,
    }) => {
        const s = await crearServicio({ nit: nitAleatorio(), empresaId: 1 })
        const cerrada = ipNueva()
        await crearSesion(s, { ipv4: cerrada, fin: new Date().toISOString() })
        const r = await estado(
            client.post('/api/v1/portal/corte/sesion').header('X-Forwarded-For', cerrada),
            422,
        )
        assert.equal(r.body().type, 'urn:argosisp:problema:no_identificado')
        assert.isNull(cookieDeSesion(r))

        const conAsignacion = await crearServicio({ nit: nitAleatorio(), empresaId: 1 })
        const [red] = await db
            .table('network.redes_ipv4')
            .insert({ router_id: conAsignacion.routerId, cidr: '10.77.1.0/24', tipo: 'estatico' })
            .returning('id')
        await db
            .table('network.ipv4_asignaciones')
            .insert({ servicio_id: conAsignacion.servicioId, red_id: red.id, ip: '10.77.1.9/32' })
        // quien-soy sí lo identifica (para ver el monto), pero la cuenta exige la sesión PPPoE
        const quien = await estado(
            client.get('/api/v1/portal/quien-soy').header('X-Forwarded-For', '10.77.1.9'),
            200,
        )
        assert.isTrue(quien.body().identificado)
        await estado(client.post('/api/v1/portal/corte/sesion').header('X-Forwarded-For', '10.77.1.9'), 422)

        await estado(client.post('/api/v1/portal/corte/sesion').header('X-Forwarded-For', ipNueva()), 422)
    })

    test('por código de corte vigente (aunque la IP sea la del router); vencido no', async ({
        client,
        assert,
    }) => {
        const s = await crearServicio({ nit: nitAleatorio(), empresaId: 1 })
        const servicio = await db.from('core.servicios').where('id', s.servicioId).firstOrFail()
        const vigente = generarCodigoCorte()
        await db.table('core.codigos_corte').insert({
            servicio_id: s.servicioId,
            empresa_id: servicio.empresa_id,
            codigo: vigente,
        })
        const conCodigo = await estado(
            client.post(`/api/v1/portal/corte/sesion?c=${vigente}`).header('X-Forwarded-For', ipNueva()),
            200,
        )
        assert.equal(conCodigo.body().origen, 'corte')
        const fila = await db
            .from('audit.acciones')
            .where('accion', 'portal.abrir_sesion_corte')
            .where('entidad_id', s.clienteId)
            .select('entrada')
            .firstOrFail()
        assert.notInclude(JSON.stringify(fila.entrada), vigente)

        const otro = await crearServicio({ nit: nitAleatorio(), empresaId: 1 })
        const vencido = generarCodigoCorte()
        await db.table('core.codigos_corte').insert({
            servicio_id: otro.servicioId,
            empresa_id: servicio.empresa_id,
            codigo: vencido,
            cerrado_en: db.raw(`now() - interval '2 hours'`),
        })
        await estado(
            client.post(`/api/v1/portal/corte/sesion?c=${vencido}`).header('X-Forwarded-For', ipNueva()),
            422,
        )
    })
})
