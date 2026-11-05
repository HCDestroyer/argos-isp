import { randomInt } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEmpresaFila, crearServicioFila } from '#tests/core/fabricas'
import { redis } from '#shared/redis'
import { MASCARA } from '#shared/enmascarar'
import { NOMBRES_PERMISOS } from '#core/permisos'
import GenerarTokenIris from '#core/actions/generar_token_iris'
import {
    PERMISOS_IRIS,
    PERMISOS_IRIS_060,
    PERMISOS_IRIS_CONTRATO,
    ROL_IRIS,
    usuarioIris,
} from '#core/integraciones_iris'
import { claveLimiteIdentidad } from '#core/limite_identidad'
import {
    normalizarCodigo,
    normalizarDocumento,
    normalizarNombre,
} from '#core/actions/verificar_identidad_cliente'
import { claveTelefono } from '#core/consultas/clientes'
import {
    CONTRATO_EVENTOS_060,
    CONTRATO_IRIS,
    EVENTOS_IRIS_DESDE_060,
    conectorAdmite,
    contratoMinimoEventoIris,
} from '#integraciones/iris/configuracion'
import { leerCabecerasIris, ocultarDocumentoIris } from '#integraciones/iris/atencion'
import MigracionPermisosIris060 from '#database/migrations/1793862211681_alter_permisos_iris_060_table'

/**
 * Contrato Iris ↔ Argos 0.6.0, parte de A1 (`contratos/iris.md` §0, §1.1, §7.1, §7.5, §7.6, §9):
 * permisos del usuario técnico y su migración, versión del contrato, `nit_cui` oculto al usuario
 * técnico, cabeceras `X-Iris-Actor` / `X-Iris-Conversacion` en la auditoría, verificar identidad
 * (A19) y búsqueda por teléfono (A20).
 */

const VERIFICAR = '/api/v1/integraciones/iris/verificar-identidad'
const CABECERAS_IA = { 'X-Iris-Actor': 'asistente_ia', 'X-Iris-Conversacion': 'wa:conv-0001' }

/** Token `atk_` del usuario técnico Iris (alcance global o solo esas empresas). */
async function tokenIris(empresas: number[] | null = null): Promise<string> {
    const { token } = await new GenerarTokenIris().execute({ nombre: unico('Iris') }, contextoPrueba())
    const id = (await usuarioIris())!
    await db
        .from('core.usuarios')
        .where('id', id)
        .update({ activo: true, alcance_global: empresas === null })
    await db.from('core.usuarios_empresas').where('usuario_id', id).delete()
    for (const empresaId of empresas ?? []) {
        await db.table('core.usuarios_empresas').insert({ usuario_id: id, empresa_id: empresaId })
    }
    return token
}

/** NIT de prueba único (no se valida: la fila se inserta directo). */
function nitUnico(): string {
    return `${randomInt(10_000_000, 99_999_999)}K`
}

/** Móvil de Guatemala único: 8 dígitos que empiezan en 5. */
function telefonoUnico(): string {
    return `5${String(randomInt(0, 9_999_999)).padStart(7, '0')}`
}

function conCabeceras(peticion: any, cabeceras: Record<string, string>) {
    for (const [nombre, valor] of Object.entries(cabeceras)) peticion.header(nombre, valor)
    return peticion
}

async function filasAuditoria(requestId: string) {
    return db.from('audit.acciones').where('request_id', requestId).orderBy('id')
}

test.group('Iris 0.6.0 · usuario técnico y contrato', () => {
    test('permisos nuevos en el catálogo y en el usuario técnico; el token nuevo los trae', async ({
        assert,
    }) => {
        for (const permiso of [
            'clientes.verificar_identidad',
            'comprobantes.registrar',
            'comprobantes.reconexion_temporal',
        ]) {
            assert.include(NOMBRES_PERMISOS, permiso)
        }
        for (const permiso of PERMISOS_IRIS_060) {
            assert.include([...PERMISOS_IRIS_CONTRATO], permiso)
            assert.include([...PERMISOS_IRIS], permiso, `${permiso} existe y es de Iris`)
        }
        // los nombres de la propuesta que Argos no adoptó (§9.1) no existen
        for (const viejo of [
            'pagos.reportar',
            'servicios.reconexion_temporal',
            'clientes.buscar_por_telefono',
        ]) {
            assert.notInclude(NOMBRES_PERMISOS as string[], viejo)
        }
        const { datos } = await new GenerarTokenIris().execute({ nombre: unico('Iris') }, contextoPrueba())
        const alcances = typeof datos.alcances === 'string' ? JSON.parse(datos.alcances) : datos.alcances
        for (const permiso of PERMISOS_IRIS_060) assert.include(alcances.permisos, permiso)
        // el rol base `cajero` no recibe la verificación ni el registro por Iris
        const cajero = await db
            .from('core.roles_permisos as rp')
            .join('core.roles as r', 'r.id', 'rp.role_id')
            .join('core.permisos as p', 'p.id', 'rp.permiso_id')
            .where('r.nombre', 'cajero')
            .whereIn('p.nombre', ['clientes.verificar_identidad', 'comprobantes.reconexion_temporal'])
        assert.lengthOf(cajero, 0)
    })

    test('migración de instalaciones conectadas: suma los 7 permisos al rol y a los tokens vigentes, idempotente', async ({
        assert,
    }) => {
        const vigente = await new GenerarTokenIris().execute({ nombre: unico('Iris') }, contextoPrueba())
        const revocado = await new GenerarTokenIris().execute({ nombre: unico('Iris') }, contextoPrueba())
        const usuarioId = (await usuarioIris())!
        await db.from('core.tokens_api').where('id', revocado.datos.id).update({ revocado_en: new Date() })
        // una instalación con el contrato 0.5.0: ni el rol ni los tokens tienen los permisos nuevos
        const rol = await db.from('core.roles').where('nombre', ROL_IRIS).firstOrFail()
        const filasPermisos = await db
            .from('core.permisos')
            .whereIn('nombre', [...PERMISOS_IRIS_060])
            .select('id')
        const ids = filasPermisos.map((f) => f.id)
        await db.from('core.roles_permisos').where('role_id', rol.id).whereIn('permiso_id', ids).delete()
        for (const permiso of PERMISOS_IRIS_060) {
            await db.rawQuery(
                `UPDATE core.tokens_api
                    SET alcances = jsonb_set(alcances, '{permisos}', (alcances -> 'permisos') - ?::text)
                  WHERE usuario_id = ?`,
                [permiso, usuarioId],
            )
        }
        const permisosToken = async (id: number): Promise<string[]> => {
            const fila = await db.from('core.tokens_api').where('id', id).firstOrFail()
            return fila.alcances.permisos
        }
        const auditadas = () =>
            db
                .from('audit.cambios')
                .where('request_id', 'migracion:1793862211681_alter_permisos_iris_060')
                .where((q) =>
                    q
                        .where({ entidad_tipo: 'rol', entidad_id: rol.id })
                        .orWhere((r) =>
                            r
                                .where('entidad_tipo', 'token_api')
                                .whereIn('entidad_id', [vigente.datos.id, revocado.datos.id]),
                        ),
                )
        const previas = await auditadas()
        const antes = previas.length
        const migrar = () =>
            db.transaction((trx) => new MigracionPermisosIris060(trx, 'permisos_iris_060', false).execUp())

        await migrar()
        const delRol = await db
            .from('core.roles_permisos')
            .where('role_id', rol.id)
            .whereIn('permiso_id', ids)
        assert.lengthOf(delRol, PERMISOS_IRIS_060.length)
        const delVigente = await permisosToken(vigente.datos.id)
        for (const permiso of PERMISOS_IRIS_060) assert.include(delVigente, permiso)
        for (const permiso of PERMISOS_IRIS_060) {
            assert.notInclude(await permisosToken(revocado.datos.id), permiso, 'un token revocado no cambia')
        }
        assert.lengthOf(await auditadas(), antes + 2, 'un diff para el rol y otro para el token vigente')

        await migrar()
        assert.lengthOf(await auditadas(), antes + 2)
        const finales = await permisosToken(vigente.datos.id)
        const repetidos = finales.filter((p) => p === 'promesas.crear')
        assert.lengthOf(repetidos, 1)
    })

    test('Argos habla 0.6.2; los webhooks de §7 piden un conector con contrato ≥ 0.6.0', async ({
        assert,
    }) => {
        assert.equal(CONTRATO_IRIS, '0.6.3')
        assert.equal(CONTRATO_EVENTOS_060, '0.6.0')
        for (const evento of EVENTOS_IRIS_DESDE_060) assert.equal(contratoMinimoEventoIris(evento), '0.6.0')
        assert.isNull(contratoMinimoEventoIris('servicio.estado_cambiado'))

        await db.from('integraciones.iris_conector').delete()
        await db.table('integraciones.iris_conector').insert({ id: 1, activo: false, contrato: '0.5.0' })
        assert.isFalse(await conectorAdmite(CONTRATO_EVENTOS_060))
        await db.from('integraciones.iris_conector').where('id', 1).update({ contrato: '0.6.0' })
        assert.isTrue(await conectorAdmite(CONTRATO_EVENTOS_060))
        assert.isTrue(await conectorAdmite('0.5.0'))
        await db.from('integraciones.iris_conector').delete()
    })
})

test.group('Iris 0.6.0 · nit_cui oculto al usuario técnico', () => {
    test('ficha, listado, dependientes y servicio: `***` para Iris, el dato para el panel; null sigue null', async ({
        client,
        assert,
    }) => {
        const nit = nitUnico()
        const clienteId = await crearClienteFila({ tipo_documento_fiscal: 'nit', nit_cui: nit })
        const dependiente = await crearClienteFila({
            tipo_documento_fiscal: 'nit',
            nit_cui: nitUnico(),
            responsable_pago_id: clienteId,
        })
        const sinDocumento = await crearClienteFila({ tipo_documento_fiscal: 'cf', nit_cui: null })
        const servicioId = await crearServicioFila({ cliente_id: clienteId })
        const atk = await tokenIris()
        const { token: admin } = await usuarioConRoles(['admin'])

        const deIris = await estado(client.get(`/api/v1/clientes/${clienteId}`).bearerToken(atk), 200)
        assert.equal(deIris.body().nit_cui, MASCARA)
        assert.notInclude(JSON.stringify(deIris.body()), nit)
        const delPanel = await estado(client.get(`/api/v1/clientes/${clienteId}`).bearerToken(admin), 200)
        assert.equal(delPanel.body().nit_cui, nit)

        const cf = await estado(client.get(`/api/v1/clientes/${sinDocumento}`).bearerToken(atk), 200)
        assert.isNull(cf.body().nit_cui)

        const lista = await estado(
            client.get('/api/v1/clientes').qs({ responsable_pago_id: clienteId }).bearerToken(atk),
            200,
        )
        assert.deepEqual(
            lista.body().data.map((c: { id: number; nit_cui: string }) => [c.id, c.nit_cui]),
            [[dependiente, MASCARA]],
        )
        const dependientes = await estado(
            client.get(`/api/v1/clientes/${clienteId}/dependientes`).bearerToken(atk),
            200,
        )
        assert.equal(dependientes.body().data[0].nit_cui, MASCARA)

        const servicio = await estado(client.get(`/api/v1/servicios/${servicioId}`).bearerToken(atk), 200)
        assert.notInclude(JSON.stringify(servicio.body()), nit)
    })

    test('alta por Iris: la respuesta de POST /clientes tampoco trae el documento', async ({
        client,
        assert,
    }) => {
        const atk = await tokenIris()
        const r = await estado(
            client
                .post('/api/v1/clientes')
                .bearerToken(atk)
                .json({ nombre: unico('Prospecto'), tipo_documento_fiscal: 'nit', nit_cui: '1669394-9' }),
            201,
        )
        assert.equal(r.body().nit_cui, MASCARA)
        const fila = await db.from('core.clientes').where('id', r.body().id).firstOrFail()
        assert.equal(fila.nit_cui, '16693949')
    })

    test('búsqueda `q`: Iris no encuentra por documento; el panel sí', async ({ client, assert }) => {
        const nit = nitUnico()
        const clienteId = await crearClienteFila({ tipo_documento_fiscal: 'nit', nit_cui: nit })
        const atk = await tokenIris()
        const { token: admin } = await usuarioConRoles(['admin'])
        const ids = (r: any) => r.body().data.map((c: { id: number }) => c.id)

        const panel = await estado(client.get('/api/v1/clientes').qs({ q: nit }).bearerToken(admin), 200)
        assert.include(ids(panel), clienteId)
        const iris = await estado(client.get('/api/v1/clientes').qs({ q: nit }).bearerToken(atk), 200)
        assert.notInclude(ids(iris), clienteId)
    })

    test('ocultarDocumentoIris: a cualquier profundidad, sin tocar lo demás', ({ assert }) => {
        assert.deepEqual(
            ocultarDocumentoIris({ a: [{ nit_cui: '123K', nombre: 'x' }, { nit_cui: null }], nit: '9' }),
            { a: [{ nit_cui: MASCARA, nombre: 'x' }, { nit_cui: null }], nit: '9' },
        )
    })
})

test.group('Iris 0.6.0 · cabeceras X-Iris-Actor y X-Iris-Conversacion', (group) => {
    group.each.setup(() => {
        process.env.IDENTIDAD_LIMITE_PREFIJO = `a1-prueba:${unico('identidad')}`
        return () => {
            delete process.env.IDENTIDAD_LIMITE_PREFIJO
        }
    })

    test('formato: asistente_ia o usuario:<id>; conversación de hasta 128', ({ assert }) => {
        assert.deepEqual(leerCabecerasIris('asistente_ia', 'wa:1.2_3-4'), {
            actor: 'asistente_ia',
            conversacion: 'wa:1.2_3-4',
        })
        assert.equal(leerCabecerasIris('usuario:u_42-A', 'c').actor, 'usuario:u_42-A')
        for (const [actor, conversacion] of [
            [undefined, 'c'],
            ['asistente', 'c'],
            ['usuario:', 'c'],
            [`usuario:${'a'.repeat(65)}`, 'c'],
            ['usuario:a b', 'c'],
            ['asistente_ia', undefined],
            ['asistente_ia', 'con espacio'],
            ['asistente_ia', 'x'.repeat(129)],
        ]) {
            assert.throws(() => leerCabecerasIris(actor, conversacion), /obligatoria/)
        }
    })

    test('token de Iris sin cabeceras o mal formadas: 400 cabecera_iris_requerida', async ({
        client,
        assert,
    }) => {
        const clienteId = await crearClienteFila()
        const atk = await tokenIris()
        const cuerpo = { cliente_id: clienteId, metodo: 'nombre', valor: 'x' }
        const sin = await estado(client.post(VERIFICAR).bearerToken(atk).json(cuerpo), 400)
        assert.equal(sin.body().type, 'urn:argosisp:problema:cabecera_iris_requerida')
        await estado(
            conCabeceras(client.post(VERIFICAR).bearerToken(atk).json(cuerpo), {
                'X-Iris-Actor': 'gerente',
                'X-Iris-Conversacion': 'c-1',
            }),
            400,
        )
        await estado(
            conCabeceras(client.post(VERIFICAR).bearerToken(atk).json(cuerpo), {
                'X-Iris-Actor': 'asistente_ia',
            }),
            400,
        )
    })

    test('auditoría: actor token, canal ia o api según X-Iris-Actor, cabeceras guardadas y buscables', async ({
        client,
        assert,
    }) => {
        const nombre = unico('Cliente')
        const clienteId = await crearClienteFila({ nombre })
        const atk = await tokenIris()
        const irisId = (await usuarioIris())!
        const conversacion = `wa:${unico('conv')}`

        const ia = await estado(
            conCabeceras(
                client
                    .post(VERIFICAR)
                    .bearerToken(atk)
                    .header('X-Request-Id', unico('req'))
                    .json({ cliente_id: clienteId, metodo: 'nombre', valor: nombre }),
                { 'X-Iris-Actor': 'asistente_ia', 'X-Iris-Conversacion': conversacion },
            ),
            200,
        )
        const [filaIa] = await filasAuditoria(ia.header('x-request-id')!)
        assert.include(filaIa, {
            actor_tipo: 'token',
            actor_id: irisId,
            canal: 'ia',
            accion: 'clientes.verificar_identidad',
            iris_actor: 'asistente_ia',
            iris_conversacion: conversacion,
        })

        const persona = await estado(
            conCabeceras(
                client
                    .post(VERIFICAR)
                    .bearerToken(atk)
                    .json({ cliente_id: clienteId, metodo: 'nombre', valor: nombre }),
                { 'X-Iris-Actor': 'usuario:op-7', 'X-Iris-Conversacion': conversacion },
            ),
            200,
        )
        const [filaPersona] = await filasAuditoria(persona.header('x-request-id')!)
        assert.include(filaPersona, { canal: 'api', iris_actor: 'usuario:op-7' })

        // otro actor (panel): no las necesita y no se guardan
        const { token: admin } = await usuarioConRoles(['admin'])
        const panel = await estado(
            client
                .post(VERIFICAR)
                .bearerToken(admin)
                .json({ cliente_id: clienteId, metodo: 'nombre', valor: nombre }),
            200,
        )
        const [filaPanel] = await filasAuditoria(panel.header('x-request-id')!)
        assert.include(filaPanel, {
            actor_tipo: 'usuario',
            canal: 'api',
            iris_actor: null,
            iris_conversacion: null,
        })

        const bitacora = await estado(
            client
                .get('/api/v1/bitacora/acciones')
                .qs({ iris_conversacion: conversacion })
                .bearerToken(admin),
            200,
        )
        assert.deepEqual(
            bitacora.body().data.map((f: { iris_actor: string }) => f.iris_actor),
            ['usuario:op-7', 'asistente_ia'],
        )
    })

    test('una ruta sin §7 no pide las cabeceras al token de Iris', async ({ client }) => {
        const clienteId = await crearClienteFila()
        const atk = await tokenIris()
        await estado(client.get(`/api/v1/clientes/${clienteId}`).bearerToken(atk), 200)
        await estado(client.get('/api/v1/clientes').qs({ q: 'x' }).bearerToken(atk), 200)
    })
})

test.group('Iris 0.6.0 · A19 verificar identidad', (group) => {
    let prefijo: string
    group.each.setup(() => {
        prefijo = `a1-prueba:${unico('identidad')}`
        process.env.IDENTIDAD_LIMITE_PREFIJO = prefijo
        return async () => {
            const claves = await redis().keys(`${prefijo}:*`)
            if (claves.length > 0) await redis().del(...claves)
            delete process.env.IDENTIDAD_LIMITE_PREFIJO
        }
    })

    function verificar(client: any, atk: string, cuerpo: Record<string, unknown>) {
        return conCabeceras(client.post(VERIFICAR).bearerToken(atk).json(cuerpo), CABECERAS_IA)
    }

    test('normalización: documento, nombre y código', ({ assert }) => {
        assert.equal(normalizarDocumento(' 576 9373-k '), '5769373K')
        assert.equal(normalizarDocumento('2456 78901 0101'), '2456789010101')
        assert.equal(normalizarNombre('  José   María  PÉREZ-López, Jr. '), 'jose maria perez lopez jr')
        assert.equal(normalizarNombre('Peña'), 'pena')
        assert.equal(normalizarCodigo(' c-000455 '), 'C000455')
    })

    test('documento, nombre y código: coincide o no, nunca devuelve el dato; auditado con valor ***', async ({
        client,
        assert,
    }) => {
        const nit = '5769373K'
        const clienteId = await crearClienteFila({
            nombre: 'José María Pérez',
            tipo_documento_fiscal: 'nit',
            nit_cui: nit,
        })
        const filaCliente = await db.from('core.clientes').where('id', clienteId).firstOrFail()
        const codigo = filaCliente.codigo as string
        const atk = await tokenIris()

        const casos: Array<[string, string, boolean]> = [
            ['documento', '5769373-k', true],
            ['documento', ' 576 9373 K ', true],
            ['documento', '5769373', false],
            ['nombre', 'jose  maria PEREZ.', true],
            ['nombre', 'Jose Perez', false],
            ['codigo_cliente', codigo.toLowerCase(), true],
            ['codigo_cliente', 'C-999999999', false],
        ]
        for (const [metodo, valor, coincide] of casos) {
            const r = await estado(verificar(client, atk, { cliente_id: clienteId, metodo, valor }), 200)
            assert.deepEqual(r.body(), { coincide }, `${metodo} ${valor}`)
            const [fila] = await filasAuditoria(r.header('x-request-id')!)
            assert.deepInclude(fila.entrada, { cliente_id: clienteId, metodo, valor: MASCARA })
            assert.deepEqual(fila.entrada.auditoria, { coincide })
            assert.notInclude(JSON.stringify(fila), valor.trim())
        }
        assert.equal(Number(await redis().get(claveLimiteIdentidad(clienteId))), 3, 'tres fallidos')
    })

    test('5 fallidos por cliente: el sexto es 429 con Retry-After (auditado); un acierto no reinicia; otro cliente no se afecta', async ({
        client,
        assert,
    }) => {
        const nombre = unico('Cliente')
        const clienteId = await crearClienteFila({ nombre })
        const otroId = await crearClienteFila({ nombre })
        const atk = await tokenIris()

        for (let i = 0; i < 4; i++) {
            await estado(
                verificar(client, atk, { cliente_id: clienteId, metodo: 'nombre', valor: `no-${i}` }),
                200,
            )
        }
        // un acierto no reinicia el contador
        await estado(verificar(client, atk, { cliente_id: clienteId, metodo: 'nombre', valor: nombre }), 200)
        await estado(verificar(client, atk, { cliente_id: clienteId, metodo: 'nombre', valor: 'no-5' }), 200)

        const bloqueado = await estado(
            verificar(client, atk, { cliente_id: clienteId, metodo: 'nombre', valor: nombre }),
            429,
        )
        assert.equal(bloqueado.body().type, 'urn:argosisp:problema:demasiados_intentos')
        const espera = Number(bloqueado.header('retry-after'))
        assert.isAbove(espera, 0)
        assert.isAtMost(espera, 1800)
        const [fila] = await filasAuditoria(bloqueado.header('x-request-id')!)
        assert.include(fila, {
            resultado: 'error',
            accion: 'clientes.verificar_identidad',
            iris_actor: 'asistente_ia',
        })
        assert.equal(fila.entrada.valor, MASCARA)
        assert.notInclude(JSON.stringify(fila), nombre)

        await estado(verificar(client, atk, { cliente_id: otroId, metodo: 'nombre', valor: nombre }), 200)
    })

    test('sin documento (cf): 422 metodo_no_disponible, que no cuenta como intento', async ({
        client,
        assert,
    }) => {
        const clienteId = await crearClienteFila({ tipo_documento_fiscal: 'cf', nit_cui: null })
        const atk = await tokenIris()
        for (let i = 0; i < 6; i++) {
            const r = await estado(
                verificar(client, atk, { cliente_id: clienteId, metodo: 'documento', valor: '1234567' }),
                422,
            )
            assert.equal(r.body().type, 'urn:argosisp:problema:metodo_no_disponible')
        }
        assert.isNull(await redis().get(claveLimiteIdentidad(clienteId)))
    })

    test('cliente inexistente 404, fuera del alcance de empresas 403, cuerpo inválido 422, sin permiso 403', async ({
        client,
    }) => {
        const atk = await tokenIris()
        await estado(verificar(client, atk, { cliente_id: 999_999_999, metodo: 'nombre', valor: 'x' }), 404)
        await estado(verificar(client, atk, { cliente_id: 1, metodo: 'ultimos4', valor: 'x' }), 422)

        const empresa = await crearEmpresaFila()
        try {
            const clienteId = await crearClienteFila()
            await crearServicioFila({ cliente_id: clienteId, empresa_id: empresa })
            const acotado = await tokenIris([1])
            await estado(
                verificar(client, acotado, { cliente_id: clienteId, metodo: 'nombre', valor: 'x' }),
                403,
            )
        } finally {
            await soloEmpresaPrincipal()
        }

        const { token: cajero } = await usuarioConRoles(['cajero'])
        await estado(
            client.post(VERIFICAR).bearerToken(cajero).json({ cliente_id: 1, metodo: 'nombre', valor: 'x' }),
            403,
        )
    })
})

test.group('Iris 0.6.0 · A20 buscar cliente por teléfono', () => {
    const buscar = (client: any, token: string, telefono: string, cabeceras = CABECERAS_IA) =>
        conCabeceras(client.get('/api/v1/clientes').qs({ telefono }).bearerToken(token), cabeceras)

    test('claveTelefono: dígitos, 502 delante de 8, sin 00', ({ assert }) => {
        assert.equal(claveTelefono('+502 5512-3344'), '50255123344')
        assert.equal(claveTelefono('5512 3344'), '50255123344')
        assert.equal(claveTelefono('0015551234567'), '15551234567')
        assert.equal(claveTelefono('+15551234567'), '15551234567')
    })

    test('exacto sobre telefono, movil y contacto de servicios no retirados; viejos sin normalizar; coincide_en', async ({
        client,
        assert,
    }) => {
        const numero = telefonoUnico()
        const formado = `+502 ${numero.slice(0, 4)}-${numero.slice(4)}`
        const titular = await crearClienteFila({ telefono: formado })
        // teléfono viejo guardado sin normalizar, en el móvil
        const viejo = await crearClienteFila({ movil: `${numero.slice(0, 4)} ${numero.slice(4)}` })
        const conContacto = await crearClienteFila()
        await crearServicioFila({ cliente_id: conContacto, contacto_telefono: formado })
        const retirado = await crearClienteFila()
        await crearServicioFila({ cliente_id: retirado, contacto_telefono: formado, estado: 'retirado' })
        // otro número que contiene los mismos dígitos: no es exacto
        await crearClienteFila({ telefono: `+1${numero}99` })
        const atk = await tokenIris()

        for (const pedido of [`+502${numero}`, numero, `502 ${numero}`, formado]) {
            const r = await estado(buscar(client, atk, pedido), 200)
            const filas = r.body().data as Array<{ id: number; coincide_en: string[] }>
            assert.sameDeepMembers(
                filas.map((f) => ({ id: f.id, coincide_en: f.coincide_en })),
                [
                    { id: titular, coincide_en: ['telefono'] },
                    { id: viejo, coincide_en: ['movil'] },
                    { id: conContacto, coincide_en: ['contacto_servicio'] },
                ],
                pedido,
            )
        }

        // sin el filtro, `coincide_en` no sale
        const { token: admin } = await usuarioConRoles(['admin'])
        const ficha = await estado(
            client
                .get('/api/v1/clientes')
                .qs({ q: unico('nadie') })
                .bearerToken(admin),
            200,
        )
        assert.deepEqual(ficha.body().data, [])
        const porId = await estado(
            client.get('/api/v1/clientes').qs({ telefono: numero }).bearerToken(admin),
            200,
        )
        assert.lengthOf(porId.body().data, 3, 'el panel usa el mismo filtro sin cabeceras de Iris')
    })

    test('teléfono inválido: 422 validacion con rule telefono; Iris sin cabeceras: 400', async ({
        client,
        assert,
    }) => {
        const atk = await tokenIris()
        for (const malo of ['123', '1234 5678', 'abc', '+502 1234-5678']) {
            const r = await estado(buscar(client, atk, malo), 422)
            assert.equal(r.body().type, 'urn:argosisp:problema:validacion')
            assert.deepInclude(r.body().errors[0], { field: 'telefono', rule: 'telefono' })
        }
        const sin = await estado(
            client.get('/api/v1/clientes').qs({ telefono: telefonoUnico() }).bearerToken(atk),
            400,
        )
        assert.equal(sin.body().type, 'urn:argosisp:problema:cabecera_iris_requerida')
    })

    test('filtrado por el alcance de empresas del usuario técnico, también el contacto en sitio', async ({
        client,
        assert,
    }) => {
        const numero = telefonoUnico()
        const empresa = await crearEmpresaFila()
        try {
            const propio = await crearClienteFila({ telefono: numero })
            await crearServicioFila({ cliente_id: propio, empresa_id: 1 })
            const ajeno = await crearClienteFila({ telefono: numero })
            await crearServicioFila({ cliente_id: ajeno, empresa_id: empresa })
            // visible por su servicio de la empresa 1, pero el contacto que coincide es de la otra
            const mixto = await crearClienteFila()
            await crearServicioFila({ cliente_id: mixto, empresa_id: 1 })
            await crearServicioFila({ cliente_id: mixto, empresa_id: empresa, contacto_telefono: numero })

            const acotado = await tokenIris([1])
            const r = await estado(buscar(client, acotado, numero), 200)
            assert.deepEqual(
                r.body().data.map((f: { id: number }) => f.id),
                [propio],
            )
            const global = await tokenIris()
            const todos = await estado(buscar(client, global, numero), 200)
            assert.sameMembers(
                todos.body().data.map((f: { id: number }) => f.id),
                [propio, ajeno, mixto],
            )
        } finally {
            await soloEmpresaPrincipal()
        }
    })
})
