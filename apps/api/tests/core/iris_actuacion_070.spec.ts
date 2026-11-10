import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { ApiClient } from '@japa/api-client'
import { contextoPrueba, estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { crearEmpresaFila } from '#tests/core/fabricas'
import { cifrar } from '#shared/cifrado'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { definirRuta, validarActuacionVinculada, type Ruta } from '#shared/rutas'
import { montarRuta } from '#shared/montar_ruta'
import { registroRutas } from '#start/routes/index'
import GenerarTokenIris from '#core/actions/generar_token_iris'
import { PERMISOS_IRIS, PERMISOS_IRIS_070, ROL_IRIS, usuarioIris } from '#core/integraciones_iris'
import { PERMISOS_ACTUACION_VINCULADA } from '#core/actuacion_vinculada'
import { resolverActorIris, usuarioVinculado } from '#core/vinculo_externo'
import MigracionPermisosIris070 from '#database/migrations/1794338490345_alter_permisos_iris_070_table'

/**
 * Contrato Iris 0.7.0, A23 (parte de A1): un operador humano de Iris aprueba o rechaza comprobantes
 * como su usuario de Argos vinculado. Resolución del vínculo, errores con su code, auditoría con
 * actor y vía (`via_token_id`), idempotencia por `X-Iris-Actor`, alcance del mecanismo y migración
 * de los permisos del usuario técnico.
 */

/** Acción de prueba con el nombre del permiso de la ruta (como `AprobarComprobante`). */
class AprobarPrueba extends DomainAction<{ id: number }, Record<string, unknown>> {
    readonly nombre = 'comprobantes.aprobar'
    static ejecuciones = 0

    protected async handle(input: { id: number }, t: Transaccion) {
        AprobarPrueba.ejecuciones++
        t.fijarEntidad('comprobante', input.id)
        await t.registrarCambios({ tipo: 'comprobante', id: input.id }, { nota: null }, { nota: 'ok' })
        return {
            ejecucion: AprobarPrueba.ejecuciones,
            actor: t.ctx.actor,
            canal: t.ctx.canal,
            via: t.via,
            iris: t.ctx.iris ?? null,
            empresa_id: t.ctx.empresaId ?? null,
            empresas_permitidas: t.ctx.empresasPermitidas ?? null,
        }
    }
}

const RUTA_APROBAR = definirRuta({
    metodo: 'post',
    ruta: '/__pruebas/actuacion/:id/aprobar',
    operacion: 'pruebasActuacionAprobar',
    resumen: 'prueba',
    etiqueta: 'pruebas',
    permiso: 'comprobantes.aprobar',
    cabecerasIris: true,
    idempotente: true,
    actuarComoVinculado: 'comprobantes.aprobar',
    respuesta: { status: 200, descripcion: 'ok' },
    handler: async (ctx, { params }) => ({
        ...(await new AprobarPrueba().execute({ id: Number(params.id) }, ctx.contextoAccion())),
        alcance_rol: ctx.alcance?.rol ?? null,
        alcance_token: ctx.alcance?.token ?? null,
    }),
})

/** Ruta de rechazo que (por error) corre otra acción: la vía no sirve para ella. */
const RUTA_RECHAZAR_MAL = definirRuta({
    metodo: 'post',
    ruta: '/__pruebas/actuacion/:id/rechazar',
    operacion: 'pruebasActuacionRechazar',
    resumen: 'prueba',
    etiqueta: 'pruebas',
    permiso: 'comprobantes.rechazar',
    cabecerasIris: true,
    actuarComoVinculado: 'comprobantes.rechazar',
    respuesta: { status: 200, descripcion: 'ok' },
    handler: (ctx, { params }) =>
        new AprobarPrueba().execute({ id: Number(params.id) }, ctx.contextoAccion()),
})

// antes de que el servidor de pruebas haga commit del router
montarRuta(RUTA_APROBAR)
montarRuta(RUTA_RECHAZAR_MAL)

const APROBAR = (id: number) => `/api/v1/__pruebas/actuacion/${id}/aprobar`

/** Token `atk_` del usuario técnico Iris (alcance global o solo esas empresas). */
async function tokenIris(empresas: number[] | null = null) {
    const generado = await new GenerarTokenIris().execute({ nombre: unico('Iris') }, contextoPrueba())
    const id = (await usuarioIris())!
    await db
        .from('core.usuarios')
        .where('id', id)
        .update({ activo: true, alcance_global: empresas === null })
    await db.from('core.usuarios_empresas').where('usuario_id', id).delete()
    for (const empresaId of empresas ?? []) {
        await db.table('core.usuarios_empresas').insert({ usuario_id: id, empresa_id: empresaId })
    }
    return { token: generado.token, tokenId: Number(generado.datos.id), usuarioTecnicoId: id }
}

/** Operador de Argos vinculado a un id de Iris nuevo. */
async function operador(roles: string[] = ['cajero']) {
    const local = await usuarioConRoles(roles)
    const idIris = unico('op').replace(/[^A-Za-z0-9_-]/g, '_')
    await db.table('core.vinculaciones_externas').insert({
        conector: 'iris',
        id_externo: idIris,
        usuario_id: local.usuario.id,
    })
    return { ...local, idIris, actor: `usuario:${idIris}` }
}

function aprobar(
    client: ApiClient,
    token: string,
    actor: string,
    opciones: { id?: number; clave?: string; empresa?: number; requestId?: string } = {},
) {
    const peticion = client
        .post(APROBAR(opciones.id ?? 7))
        .bearerToken(token)
        .header('X-Iris-Actor', actor)
        .header('X-Iris-Conversacion', 'wa:conv-a23')
        .header('X-Request-Id', opciones.requestId ?? randomUUID())
        .json({})
    if (opciones.clave) peticion.header('Idempotency-Key', opciones.clave)
    if (opciones.empresa !== undefined) peticion.header('X-Empresa-Id', String(opciones.empresa))
    return peticion
}

async function rechazo(peticion: PromiseLike<any>, status: number, codigo: string) {
    const r = await estado(peticion, status)
    if (r.body().type !== `urn:argosisp:problema:${codigo}`) {
        throw new Error(`se esperaba ${codigo} y llegó ${JSON.stringify(r.body())}`)
    }
    return r
}

test.group('Iris 0.7.0 · actuación vinculada (A23)', (group) => {
    group.each.setup(async () => {
        AprobarPrueba.ejecuciones = 0
        await db.from('integraciones.iris_enlaces').delete()
        await db.from('integraciones.iris_conector').delete()
    })
    group.teardown(async () => {
        await soloEmpresaPrincipal()
    })

    test('helper de resolución: vigente, sin vínculo, revocado y asistente_ia', async ({ assert }) => {
        const op = await operador()
        const vinculo = await resolverActorIris(op.actor)
        assert.equal(vinculo?.usuarioId, op.usuario.id)
        assert.isTrue(vinculo?.activo)
        assert.isNull(await resolverActorIris('asistente_ia'))
        assert.isNull(await resolverActorIris('usuario:no-existe'))
        // mismo id con otro conector no cuenta
        assert.isNull(await usuarioVinculado('horus', op.idIris))
        await db
            .from('core.vinculaciones_externas')
            .where({ conector: 'iris', id_externo: op.idIris })
            .update({ revocada_en: new Date() })
        assert.isNull(await resolverActorIris(op.actor))
    })

    test('con vínculo: corre como el usuario vinculado (canal api) y audita la vía', async ({
        client,
        assert,
    }) => {
        const iris = await tokenIris()
        const op = await operador(['cajero'])
        const requestId = randomUUID()
        const r = await estado(aprobar(client, iris.token, op.actor, { requestId }), 200)
        const cuerpo = r.body()
        assert.deepEqual(cuerpo.actor, { tipo: 'usuario', id: op.usuario.id })
        assert.equal(cuerpo.canal, 'api')
        assert.deepEqual(cuerpo.via, {
            conector: 'iris',
            tokenApiId: iris.tokenId,
            usuarioTecnicoId: iris.usuarioTecnicoId,
            permiso: 'comprobantes.aprobar',
        })
        assert.deepEqual(cuerpo.iris, { actor: op.actor, conversacion: 'wa:conv-a23' })
        // su alcance propio (rol global), sin las restricciones del token Iris
        assert.isNull(cuerpo.alcance_rol)
        assert.isNull(cuerpo.alcance_token)

        const filas = await db.from('audit.acciones').where('request_id', requestId)
        assert.lengthOf(filas, 1)
        const fila = filas[0]
        assert.equal(fila.accion, 'comprobantes.aprobar')
        assert.equal(fila.actor_tipo, 'usuario')
        assert.equal(Number(fila.actor_id), op.usuario.id)
        assert.equal(fila.canal, 'api')
        assert.equal(Number(fila.via_token_id), iris.tokenId)
        assert.equal(fila.iris_actor, op.actor)
        assert.equal(fila.iris_conversacion, 'wa:conv-a23')
        assert.equal(fila.resultado, 'ok')
        const cambios = await db.from('audit.cambios').where('request_id', requestId)
        assert.lengthOf(cambios, 1)
        assert.equal(Number(cambios[0].actor_id), op.usuario.id)
        assert.equal(cambios[0].actor_tipo, 'usuario')

        // la bitácora expone la vía
        const admin = await usuarioConRoles(['admin'])
        const bitacora = await estado(
            client.get(`/api/v1/bitacora/acciones?request_id=${requestId}`).bearerToken(admin.token),
            200,
        )
        assert.equal(Number(bitacora.body().data[0].via_token_id), iris.tokenId)
    })

    test('errores con su code: IA, sin vínculo, revocado, inactivo, sin permiso', async ({ client }) => {
        const iris = await tokenIris()
        await rechazo(aprobar(client, iris.token, 'asistente_ia'), 403, 'actor_ia_no_permitido')
        await rechazo(aprobar(client, iris.token, 'usuario:nadie-aqui'), 403, 'actor_sin_vinculo')

        const revocado = await operador()
        await db
            .from('core.vinculaciones_externas')
            .where({ conector: 'iris', id_externo: revocado.idIris })
            .update({ revocada_en: new Date() })
        await rechazo(aprobar(client, iris.token, revocado.actor), 403, 'actor_sin_vinculo')

        const inactivo = await operador()
        await db.from('core.usuarios').where('id', inactivo.usuario.id).update({ activo: false })
        await rechazo(aprobar(client, iris.token, inactivo.actor), 403, 'actor_inactivo')

        const lectura = await operador(['lectura'])
        await rechazo(aprobar(client, iris.token, lectura.actor), 403, 'actor_sin_permiso')

        // sin cabeceras: 400 de siempre
        await rechazo(
            client.post(APROBAR(7)).bearerToken(iris.token).json({}),
            400,
            'cabecera_iris_requerida',
        )
    })

    test('permiso: el del usuario vinculado con su alcance, y el token Iris también lo necesita', async ({
        client,
        assert,
    }) => {
        const iris = await tokenIris()
        // un rol con alcance de caja: el alcance es el del usuario, no el del token
        const op = await operador([])
        const rol = await db.from('core.roles').where('nombre', 'cajero').firstOrFail()
        await db
            .table('core.usuarios_roles')
            .insert({ usuario_id: op.usuario.id, role_id: rol.id, alcance_tipo: 'caja', alcance_id: 99 })
        const r = await estado(aprobar(client, iris.token, op.actor), 200)
        assert.deepEqual(r.body().alcance_rol, { router: [], zona: [], caja: [99] })

        // un token Iris sin el permiso: 403 del ACL antes de resolver el actor
        await db.rawQuery(
            `UPDATE core.tokens_api
                SET alcances = jsonb_set(alcances, '{permisos}', (alcances -> 'permisos') - 'comprobantes.aprobar')
              WHERE id = ?`,
            [iris.tokenId],
        )
        await rechazo(aprobar(client, iris.token, op.actor), 403, 'prohibido')
    })

    test('empresas: las del usuario vinculado ∩ las del token; sin intersección 403 actor_sin_empresa', async ({
        client,
        assert,
    }) => {
        const b = await crearEmpresaFila()
        const c = await crearEmpresaFila()
        const iris = await tokenIris([1, b])

        const deB = await operador()
        await db.from('core.usuarios').where('id', deB.usuario.id).update({ alcance_global: false })
        await db.table('core.usuarios_empresas').insert({ usuario_id: deB.usuario.id, empresa_id: b })
        const r = await estado(aprobar(client, iris.token, deB.actor), 200)
        assert.equal(r.body().empresa_id, b)
        assert.deepEqual(r.body().empresas_permitidas, [b])
        // la empresa activa pedida debe ser del usuario vinculado
        await rechazo(aprobar(client, iris.token, deB.actor, { empresa: 1 }), 403, 'actor_sin_empresa')
        const conB = await estado(aprobar(client, iris.token, deB.actor, { empresa: b }), 200)
        assert.equal(conB.body().empresa_id, b)

        const deC = await operador()
        await db.from('core.usuarios').where('id', deC.usuario.id).update({ alcance_global: false })
        await db.table('core.usuarios_empresas').insert({ usuario_id: deC.usuario.id, empresa_id: c })
        await rechazo(aprobar(client, iris.token, deC.actor), 403, 'actor_sin_empresa')

        // usuario global con token acotado: solo las del token
        const global = await operador()
        const g = await estado(aprobar(client, iris.token, global.actor), 200)
        assert.deepEqual(g.body().empresas_permitidas, [1, b])
        assert.isNull(g.body().empresa_id, 'dos empresas sin X-Empresa-Id: ninguna activa')
    })

    test('conector Iris no vigente: 409 iris_apagado; enlace con otro token: 403', async ({ client }) => {
        const iris = await tokenIris()
        const op = await operador()
        await db.table('integraciones.iris_conector').insert({
            id: 1,
            activo: false,
            url_base: 'https://iris.isp.example',
            token_cifrado: cifrar('iris_pat_prueba'),
            webhook_salida_url: 'https://iris.isp.example/api/v1/integraciones/argosisp/webhook/c-1',
            webhook_salida_secreto_cifrado: cifrar('secreto-prueba'),
            token_argos_id: iris.tokenId,
            conectado_por_enlace_en: new Date(),
        })
        await rechazo(aprobar(client, iris.token, op.actor), 409, 'iris_apagado')
        await db.from('integraciones.iris_conector').where('id', 1).update({ activo: true })
        await estado(aprobar(client, iris.token, op.actor), 200)

        const otro = await tokenIris()
        await rechazo(aprobar(client, otro.token, op.actor), 403, 'prohibido')
    })

    test('idempotencia: replay al mismo actor; la misma clave con otro actor es 422 y no se ejecuta', async ({
        client,
        assert,
    }) => {
        const iris = await tokenIris()
        const ana = await operador()
        const luis = await operador()
        const clave = unico('clave')

        const primera = await estado(aprobar(client, iris.token, ana.actor, { clave }), 200)
        assert.equal(primera.body().ejecucion, 1)
        const repetida = await estado(aprobar(client, iris.token, ana.actor, { clave }), 200)
        assert.equal(repetida.header('idempotent-replayed'), 'true')
        assert.equal(repetida.body().ejecucion, 1)
        assert.equal(AprobarPrueba.ejecuciones, 1)

        await rechazo(aprobar(client, iris.token, luis.actor, { clave }), 422, 'idempotency_key_reutilizada')
        await rechazo(aprobar(client, iris.token, 'asistente_ia', { clave }), 403, 'actor_ia_no_permitido')
        assert.equal(AprobarPrueba.ejecuciones, 1)

        // vínculo revocado después: no hay replay para el actor que ya no está vinculado
        await db
            .from('core.vinculaciones_externas')
            .where({ conector: 'iris', id_externo: ana.idIris })
            .update({ revocada_en: new Date() })
        await rechazo(aprobar(client, iris.token, ana.actor, { clave }), 403, 'actor_sin_vinculo')
    })

    test('el panel y otros usuarios actúan como sí mismos; la vía no sirve para otra acción', async ({
        client,
        assert,
    }) => {
        const cajero = await usuarioConRoles(['cajero'])
        const r = await estado(client.post(APROBAR(3)).bearerToken(cajero.token).json({}), 200)
        assert.equal(r.body().actor.id, cajero.usuario.id)
        assert.isNull(r.body().via)

        // con la vía de `comprobantes.rechazar`, una acción `comprobantes.aprobar` no corre
        const iris = await tokenIris()
        const op = await operador()
        await estado(
            client
                .post('/api/v1/__pruebas/actuacion/3/rechazar')
                .bearerToken(iris.token)
                .header('X-Iris-Actor', op.actor)
                .header('X-Iris-Conversacion', 'wa:conv-a23')
                .json({}),
            500,
        )
        assert.equal(AprobarPrueba.ejecuciones, 1)
    })

    test('alcance del mecanismo: solo comprobantes.aprobar|rechazar, igual al permiso y con cabecerasIris', ({
        assert,
    }) => {
        assert.deepEqual([...PERMISOS_ACTUACION_VINCULADA], ['comprobantes.aprobar', 'comprobantes.rechazar'])
        const base = {
            metodo: 'post',
            ruta: '/x',
            operacion: 'x',
            resumen: 'x',
            etiqueta: 'x',
            cabecerasIris: true,
            respuesta: { status: 200, descripcion: 'x' },
        }
        const ruta = (extra: Record<string, unknown>) => ({ ...base, ...extra }) as unknown as Ruta
        assert.throws(() =>
            validarActuacionVinculada(ruta({ permiso: 'clientes.ver', actuarComoVinculado: 'clientes.ver' })),
        )
        assert.throws(() =>
            validarActuacionVinculada(
                ruta({ permiso: 'comprobantes.ver', actuarComoVinculado: 'comprobantes.aprobar' }),
            ),
        )
        assert.throws(() =>
            validarActuacionVinculada(
                ruta({
                    permiso: 'comprobantes.aprobar',
                    actuarComoVinculado: 'comprobantes.aprobar',
                    cabecerasIris: undefined,
                }),
            ),
        )
        assert.throws(() =>
            validarActuacionVinculada(
                ruta({
                    permiso: 'comprobantes.aprobar',
                    actuarComoVinculado: 'comprobantes.aprobar',
                    seguridad: 'interno',
                }),
            ),
        )
        assert.doesNotThrow(() =>
            validarActuacionVinculada(
                ruta({ permiso: 'comprobantes.aprobar', actuarComoVinculado: 'comprobantes.aprobar' }),
            ),
        )
        // en el registro real solo la declaran aprobar y rechazar comprobantes
        for (const r of registroRutas) {
            if (r.actuarComoVinculado === undefined) continue
            assert.include([...PERMISOS_ACTUACION_VINCULADA], r.actuarComoVinculado)
            assert.match(r.ruta, /^\/comprobantes\/:id\/(aprobar|rechazar)$/)
        }
    })

    test('migración 0.7.0: suma aprobar y rechazar al rol y a los tokens vigentes, idempotente', async ({
        assert,
    }) => {
        for (const p of PERMISOS_IRIS_070) assert.include([...PERMISOS_IRIS], p)
        const vigente = await new GenerarTokenIris().execute({ nombre: unico('Iris') }, contextoPrueba())
        const revocado = await new GenerarTokenIris().execute({ nombre: unico('Iris') }, contextoPrueba())
        const alcances =
            typeof vigente.datos.alcances === 'string'
                ? JSON.parse(vigente.datos.alcances)
                : vigente.datos.alcances
        for (const p of PERMISOS_IRIS_070) assert.include(alcances.permisos as string[], p)
        const usuarioId = (await usuarioIris())!
        await db.from('core.tokens_api').where('id', revocado.datos.id).update({ revocado_en: new Date() })

        // instalación con el contrato 0.6.x: ni el rol ni los tokens tienen los permisos nuevos
        const rol = await db.from('core.roles').where('nombre', ROL_IRIS).firstOrFail()
        const filasPermisos = await db
            .from('core.permisos')
            .whereIn('nombre', [...PERMISOS_IRIS_070])
            .select('id')
        const ids = filasPermisos.map((f) => f.id)
        await db.from('core.roles_permisos').where('role_id', rol.id).whereIn('permiso_id', ids).delete()
        for (const p of PERMISOS_IRIS_070) {
            await db.rawQuery(
                `UPDATE core.tokens_api
                    SET alcances = jsonb_set(alcances, '{permisos}', (alcances -> 'permisos') - ?::text)
                  WHERE usuario_id = ?`,
                [p, usuarioId],
            )
        }
        const permisosToken = async (id: number): Promise<string[]> => {
            const fila = await db.from('core.tokens_api').where('id', id).firstOrFail()
            return fila.alcances.permisos
        }
        const auditadas = () =>
            db
                .from('audit.cambios')
                .where('request_id', 'migracion:1794338490345_alter_permisos_iris_070')
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
            db.transaction((trx) => new MigracionPermisosIris070(trx, 'permisos_iris_070', false).execUp())

        await migrar()
        assert.lengthOf(
            await db.from('core.roles_permisos').where('role_id', rol.id).whereIn('permiso_id', ids),
            PERMISOS_IRIS_070.length,
        )
        for (const p of PERMISOS_IRIS_070) {
            assert.include(await permisosToken(vigente.datos.id), p)
            assert.notInclude(await permisosToken(revocado.datos.id), p, 'un token revocado no cambia')
        }
        assert.lengthOf(await auditadas(), antes + 2, 'un diff para el rol y otro para el token vigente')

        await migrar()
        assert.lengthOf(await auditadas(), antes + 2)
        const finales = await permisosToken(vigente.datos.id)
        assert.lengthOf(
            finales.filter((p) => p === 'comprobantes.aprobar'),
            1,
        )
    })
})

const TICKETS_IRIS = '/api/v1/integraciones/iris/sso/tickets'
const PANEL = 'http://localhost:3000'

test.group('Iris 0.7.0 · ticket de autologin sin destino («Vincular mi usuario de Argos»)', (group) => {
    group.each.setup(async () => {
        await db.from('integraciones.iris_enlaces').delete()
        await db.from('integraciones.iris_conector').delete()
    })

    test('sin destino: el canje y la vinculación llevan al inicio del panel; luego sirve para actuar', async ({
        client,
        assert,
    }) => {
        const iris = await tokenIris()
        const idIris = unico('op').replace(/[^A-Za-z0-9_-]/g, '_')
        const emitido = await estado(
            client
                .post(TICKETS_IRIS)
                .bearerToken(iris.token)
                .json({ usuario: { id_externo: idIris } }),
            201,
        )
        const fila = await db.from('core.sso_tickets').orderBy('id', 'desc').firstOrFail()
        assert.isNull(fila.destino_tipo)
        assert.isNull(fila.destino_id_externo)

        const ticket = (emitido.body().url as string).split('#')[1]!
        const canje = await estado(
            client.post('/api/v1/auth/sso/canjear').header('Origin', PANEL).json({ ticket }),
            200,
        )
        assert.equal(canje.body().resultado, 'vinculacion_requerida')
        assert.equal(canje.body().ruta, '/')

        const cajero = await usuarioConRoles(['cajero'])
        const vinculado = await estado(
            client.post('/api/v1/auth/sso/vincular').header('Origin', PANEL).json({
                token_vinculacion: canje.body().vinculacion.token,
                email: cajero.usuario.email,
                password: cajero.password,
            }),
            200,
        )
        assert.equal(vinculado.body().ruta, '/')

        // con vínculo: otro ticket sin destino abre sesión en el inicio
        const otro = await estado(
            client
                .post(TICKETS_IRIS)
                .bearerToken(iris.token)
                .json({ usuario: { id_externo: idIris }, destino: null }),
            201,
        )
        const sesion = await estado(
            client
                .post('/api/v1/auth/sso/canjear')
                .header('Origin', PANEL)
                .json({ ticket: (otro.body().url as string).split('#')[1]! }),
            200,
        )
        assert.equal(sesion.body().resultado, 'sesion')
        assert.equal(sesion.body().ruta, '/')

        // y el mismo id sirve en X-Iris-Actor
        const r = await estado(aprobar(client, iris.token, `usuario:${idIris}`), 200)
        assert.equal(r.body().actor.id, cajero.usuario.id)
    })

    test('id_externo de Iris con el formato de X-Iris-Actor (422 si no); Horus sigue exigiendo destino', async ({
        client,
        assert,
    }) => {
        const iris = await tokenIris()
        for (const malo of ['ana@isp.gt', 'a'.repeat(65), 'con espacio', 'u.1']) {
            await estado(
                client
                    .post(TICKETS_IRIS)
                    .bearerToken(iris.token)
                    .json({ usuario: { id_externo: malo } }),
                422,
            )
        }
        await estado(
            client
                .post(TICKETS_IRIS)
                .bearerToken(iris.token)
                .json({ usuario: { id_externo: 'u-42' }, destino: { tipo: 'cliente', id_externo: '9' } }),
            201,
        )
        const conDestino = await db.from('core.sso_tickets').orderBy('id', 'desc').firstOrFail()
        assert.equal(conDestino.destino_tipo, 'cliente')

        const { default: GenerarTokenHorus } = await import('#core/actions/generar_token_horus')
        const horus = await new GenerarTokenHorus().execute({}, contextoPrueba())
        await estado(
            client
                .post('/api/v1/integraciones/horus/sso/tickets')
                .bearerToken(horus.token)
                .json({ usuario: { id_externo: 'ana@horus' } }),
            422,
        )
        // la base tampoco acepta un ticket de Horus sin destino
        await assert.rejects(() =>
            db.table('core.sso_tickets').insert({
                hash: unico('h'),
                conector: 'horus',
                token_api_id: Number(horus.datos.id),
                usuario_id_externo: 'x',
                expira_en: new Date(),
            }),
        )
    })

    test('token de vinculación vencido: el mensaje nombra al conector (Iris, no Horus)', async ({
        client,
        assert,
    }) => {
        const iris = await tokenIris()
        const { generarSecretoSso } = await import('#core/sso')
        const { valor, hash } = generarSecretoSso()
        await db.table('core.sso_tickets').insert({
            hash: unico('h'),
            conector: 'iris',
            token_api_id: iris.tokenId,
            usuario_id_externo: 'u-1',
            expira_en: new Date(Date.now() - 60_000),
            usado_en: new Date(),
            vinculacion_hash: hash,
            vinculacion_expira_en: new Date(Date.now() - 1000),
        })
        const r = await estado(
            client
                .post('/api/v1/auth/sso/vincular')
                .header('Origin', PANEL)
                .json({ token_vinculacion: valor, email: 'x@prueba.local', password: 'clave-de-prueba' }),
            410,
        )
        assert.include(r.body().detail, 'desde Iris')
    })
})
