import { test } from '@japa/runner'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import { cifrar } from '#shared/cifrado'
import { contextoPrueba, estado, soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { afirmarLibroCuadrado } from '#tests/ledger/ayudas_libro'
import { afirmarCuadre, bodegaEn, productoEn } from '#tests/inventario/ayudas_inventario'
import { comprarSeries, tecnicoConBodega } from '#tests/inventario/ayudas_fase_d'
import GenerarTokenIris from '#core/actions/generar_token_iris'
import { usuarioIris } from '#core/integraciones_iris'
import { fijarContratoArgosParaPruebas } from '#integraciones/iris/configuracion'
import RecibirWebhookIris from '#integraciones/iris/actions/recibir_webhook_iris'
import { reevaluarVinculos, verificarAhora, verificarPendientes } from '#inventario/verificacion_iris'

/**
 * Contrato Iris 0.14.0 del lado de inventario y equipos (§3.9, §3.10, §4.5, §6.6, §10.10): verificación de
 * intentos y cambios de servidor a servidor contra un Iris falso (HTTP real), cupo diario con su 503,
 * vínculos de técnicos (`tecnico.argos_*`, carga inicial, `actor_desconocido`, `actor_no_coincide`),
 * contrato sin retroceso, contacto solo de una persona y alertas al admin (T-12).
 */

const TOKEN_PANEL = `iris_pat_${'Pn0Kx7Rq'.repeat(5)}`

interface Peticion {
    ruta: string
    query: URLSearchParams
    autorizacion: string | undefined
}

/** Iris falso: responde según la clave (verificación) o el usuario (técnicos). */
class IrisFalso {
    servidor!: Server
    url = ''
    peticiones: Peticion[] = []
    verificaciones = new Map<
        string,
        { status: number; cuerpo?: unknown; cabeceras?: Record<string, string> }
    >()
    tecnicos = new Map<string, { status: number; cuerpo?: unknown }>()

    async iniciar() {
        this.servidor = createServer((req, res) => {
            const u = new URL(req.url ?? '/', 'http://x')
            this.peticiones.push({
                ruta: u.pathname,
                query: u.searchParams,
                autorizacion: req.headers.authorization,
            })
            let r: { status: number; cuerpo?: unknown; cabeceras?: Record<string, string> } | undefined
            if (u.pathname === '/api/v1/integraciones/argosisp/intentos-recuperacion/verificacion') {
                r = this.verificaciones.get(u.searchParams.get('idempotency_key') ?? '')
            } else if (u.pathname.startsWith('/api/v1/integraciones/argosisp/tecnicos/')) {
                r = this.tecnicos.get(decodeURIComponent(u.pathname.split('/').at(-1)!))
            }
            r ??= { status: 404, cuerpo: { type: 'urn:iris:problema:no_encontrado', status: 404 } }
            res.writeHead(r.status, { 'content-type': 'application/json', ...(r.cabeceras ?? {}) })
            res.end(r.cuerpo === undefined ? '' : JSON.stringify(r.cuerpo))
        })
        await new Promise<void>((ok) => this.servidor.listen(0, '127.0.0.1', ok))
        this.url = `http://127.0.0.1:${(this.servidor.address() as AddressInfo).port}`
    }

    async detener() {
        await new Promise<void>((ok) => this.servidor.close(() => ok()))
    }
}

async function fijarConector(url: string, contrato: string | null, cargados = true) {
    await db.from('integraciones.iris_conector').delete()
    await db.table('integraciones.iris_conector').insert({
        id: 1,
        activo: true,
        url_base: url,
        token_cifrado: cifrar(TOKEN_PANEL),
        contrato,
        vinculos_cargados: cargados ? 0 : null,
        vinculos_cargados_en: cargados ? new Date() : null,
    })
}

async function tokenIris() {
    const { token } = await new GenerarTokenIris().execute({ nombre: unico('Iris') }, contextoPrueba())
    const id = (await usuarioIris())!
    await db.from('core.usuarios').where('id', id).update({ activo: true, alcance_global: true })
    await db.from('core.usuarios_empresas').where('usuario_id', id).delete()
    return token
}

let webhooks = 0
async function webhook(evento: string, payload: Record<string, unknown>) {
    const id = `wh-${++webhooks}-${randomUUID()}`
    return new RecibirWebhookIris().execute(
        {
            webhook_id: id,
            evento,
            ocurrido_en: new Date().toISOString(),
            payload,
            cuerpo: { id, evento, payload },
        },
        contextoPrueba(),
    )
}

async function columna(tabla: string, id: number, campo: string): Promise<unknown> {
    const fila = await db.from(tabla).where('id', id).select(campo).firstOrFail()
    return fila[campo]
}

async function eventos(evento: string, campo: string, valor: number) {
    return db
        .from('audit.outbox')
        .where('evento', evento)
        .whereRaw(`(payload->>?)::bigint = ?`, [campo, valor])
        .orderBy('id')
        .select('payload')
}

/** Escenario: una empresa con un servicio, unidades en comodato y un técnico con su bodega. */
async function escenario(client: any, n = 3) {
    const e = await prepararEmpresasGt()
    const cabecera = { 'X-Empresa-Id': String(e.B) }
    const central = await bodegaEn(e.B, e.ctx)
    const onu = await productoEn(e.B, e.ctx, {
        nombre: 'ONU GPON',
        unidad: 'unidad',
        tipo: 'equipo',
        seguimiento: 'serie',
    })
    const unidades = await comprarSeries(e.B, e.ctx, { producto_id: onu.id, bodega_id: central.id, n: n + 1 })
    const tecnico = await tecnicoConBodega(e.B, e.ctx)
    const { servicioId } = await servicioEn(e.B)
    for (const u of unidades.slice(0, n)) {
        await estado(
            client
                .post(`/api/v1/servicios/${servicioId}/equipos`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ unidad_id: u.id }),
            201,
        )
    }
    // la última, a la bodega del técnico (la que entra en un cambio)
    await estado(
        client
            .post('/api/v1/inventario/traslados')
            .bearerToken(e.token)
            .headers(cabecera)
            .json({
                producto_id: onu.id,
                bodega_origen_id: central.id,
                bodega_destino_id: tecnico.bodega.id,
                unidad_ids: [unidades[n]!.id],
            }),
        201,
    )
    return { e, cabecera, unidades, tecnico, servicioId, onu }
}

const ubicacion = { lat: 14.6349, lng: -90.5069, precision_m: 8 }

test.group('Inventario · contrato Iris 0.14.0 (A47/A48)', (group) => {
    const iris = new IrisFalso()
    group.setup(async () => {
        await iris.iniciar()
        return async () => {
            await iris.detener()
        }
    })
    group.each.setup(() => {
        fijarContratoArgosParaPruebas('0.14.0')
        iris.peticiones = []
        iris.verificaciones.clear()
        iris.tecnicos.clear()
        return async () => {
            fijarContratoArgosParaPruebas()
            await db.from('integraciones.iris_conector').delete()
            await soloEmpresaPrincipal()
        }
    })

    test('intento: foto y clave obligatorias, verificación con Iris, aviso al titular y cupo diario', async ({
        client,
        assert,
    }) => {
        const s = await escenario(client, 3)
        const token = await tokenIris()
        await fijarConector(iris.url, '0.14.0')
        const [a, b] = s.unidades
        const orden = `orden-${randomUUID()}`
        const ahora = new Date().toISOString()
        const intentar = (
            unidadId: number,
            clave: string | null,
            extra: Record<string, unknown> = {},
            actor = 'usuario:u-1',
        ) => {
            const p = client
                .post(`/api/v1/servicios/${s.servicioId}/equipos/${unidadId}/no-recuperado`)
                .bearerToken(token)
                .headers(s.cabecera)
                .header('X-Iris-Actor', actor)
            if (clave) p.header('Idempotency-Key', clave)
            return p.json({
                motivo: 'cliente_ausente',
                foto_ref: 'adj-fachada-1',
                ubicacion,
                fecha: ahora,
                recibido_en_iris: ahora,
                origen_tipo: 'iris_orden',
                origen_id: orden,
                ...extra,
            })
        }
        const clave = (unidadId: number) => `iris:no_recuperado:${orden}:${unidadId}:${randomUUID()}`

        // foto obligatoria con cualquier motivo; clave obligatoria y con la unidad
        const sinFoto = await estado(intentar(a!.id, clave(a!.id), { foto_ref: null }), 422)
        assert.equal(sinFoto.body().errors[0].field, 'foto_ref')
        const sinClave = await estado(intentar(a!.id, null), 400)
        assert.match(sinClave.body().type, /idempotency_key_requerida$/)
        await estado(intentar(a!.id, `iris:no_recuperado:${orden}:999999:x`), 422)

        // registrado: pendiente; la unidad no cambia y no hay aviso
        const k1 = clave(a!.id)
        const r1 = await estado(intentar(a!.id, k1), 201)
        assert.containSubset(r1.body(), { intento_n: 1, estado: 'en_comodato', verificacion: 'pendiente' })
        // la huella incluye X-Iris-Actor: la misma clave con otro actor es 422
        const otroActor = await estado(intentar(a!.id, k1, {}, 'usuario:u-2'), 422)
        assert.match(otroActor.body().type, /idempotency_key_reutilizada$/)
        assert.lengthOf(await eventos('inventario.recuperacion_intentada', 'intento_id', r1.body().id), 0)
        const v1 = await db
            .from('inventario.verificaciones_iris')
            .where('intento_id', r1.body().id)
            .firstOrFail()
        assert.equal(v1.estado, 'pendiente')
        assert.equal(v1.idempotency_key, k1)

        // Iris: todavía en envío → sigue pendiente, con su motivo
        iris.verificaciones.set(k1, { status: 200, cuerpo: { verificado: false, motivo: 'envio_en_curso' } })
        const pendiente = await verificarAhora(Number(v1.id), 'worker')
        assert.deepInclude(pendiente!, { estado: 'pendiente', motivo: 'envio_en_curso' })
        const consulta = iris.peticiones.at(-1)!
        assert.equal(consulta.ruta, '/api/v1/integraciones/argosisp/intentos-recuperacion/verificacion')
        assert.equal(consulta.query.get('empresa_id'), String(s.e.B))
        assert.equal(consulta.query.get('idempotency_key'), k1)
        assert.equal(consulta.autorizacion, `Bearer ${TOKEN_PANEL}`)

        // verificado (por el worker): la unidad pasa a por recuperar y sale el aviso al titular
        iris.verificaciones.set(k1, { status: 200, cuerpo: { verificado: true, motivo: null } })
        await db
            .from('inventario.verificaciones_iris')
            .where('id', v1.id)
            .update({ proxima_en: new Date(Date.now() - 1000) })
        const vuelta = await verificarPendientes({ limite: 500 })
        assert.isAtLeast(vuelta.verificadas, 1)
        const u = await db.from('inventario.unidades').where('id', a!.id).firstOrFail()
        assert.equal(u.estado, 'por_recuperar')
        const avisos = await eventos('inventario.recuperacion_intentada', 'intento_id', r1.body().id)
        assert.lengthOf(avisos, 1)
        assert.lengthOf(await eventos('inventario.operacion_verificada', 'verificacion_id', Number(v1.id)), 1)

        // el mismo día, el cupo está ocupado por un intento verificado: 429 definitivo, sin Retry-After
        const lleno = await estado(intentar(a!.id, clave(a!.id)), 429)
        assert.equal(lleno.body().type, 'urn:argosisp:problema:demasiados_intentos')
        assert.isUndefined(lleno.header('retry-after'))

        // otra unidad del mismo servicio, verificada el mismo día: sin segundo aviso (uno por servicio al día)
        const k2 = clave(b!.id)
        const r2 = await estado(intentar(b!.id, k2), 201)
        iris.verificaciones.set(k2, { status: 200, cuerpo: { verificado: true, motivo: null } })
        const v2 = await db
            .from('inventario.verificaciones_iris')
            .where('intento_id', r2.body().id)
            .firstOrFail()
        await verificarAhora(Number(v2.id), 'worker')
        assert.equal(await columna('inventario.unidades', b!.id, 'estado'), 'por_recuperar')
        assert.lengthOf(await eventos('inventario.recuperacion_intentada', 'intento_id', r2.body().id), 0)

        await afirmarCuadre(assert, s.e.B)
        await afirmarLibroCuadrado(assert)
    })

    test('cupo: un intento que Iris no confirma no cuenta; verificación no concluyente → 503 con Retry-After', async ({
        client,
        assert,
    }) => {
        const s = await escenario(client, 2)
        const token = await tokenIris()
        await fijarConector(iris.url, '0.14.0')
        const [a, b] = s.unidades
        const orden = `orden-${randomUUID()}`
        const ahora = new Date().toISOString()
        const intentar = (unidadId: number, clave: string) =>
            client
                .post(`/api/v1/servicios/${s.servicioId}/equipos/${unidadId}/no-recuperado`)
                .bearerToken(token)
                .headers(s.cabecera)
                .header('X-Iris-Actor', 'usuario:u-1')
                .header('Idempotency-Key', clave)
                .json({
                    motivo: 'se_nego',
                    foto_ref: 'adj-1',
                    ubicacion,
                    fecha: ahora,
                    recibido_en_iris: ahora,
                    origen_tipo: 'iris_orden',
                    origen_id: orden,
                })

        // A: el primero queda pendiente; Iris no conoce su clave (404) → no cuenta y entra el nuevo
        const kA1 = `iris:no_recuperado:${orden}:${a!.id}:1`
        const a1 = await estado(intentar(a!.id, kA1), 201)
        const kA2 = `iris:no_recuperado:${orden}:${a!.id}:2`
        const a2 = await estado(intentar(a!.id, kA2), 201)
        assert.equal(a2.body().intento_n, 2)
        const va1 = await db
            .from('inventario.verificaciones_iris')
            .where('intento_id', a1.body().id)
            .firstOrFail()
        assert.containSubset(va1, { estado: 'no_verificado', motivo: 'desconocido_en_iris' })

        // B: Iris falla (500) al verificar el que ocupa el cupo → 503 con Retry-After, nunca 429
        const kB1 = `iris:no_recuperado:${orden}:${b!.id}:1`
        await estado(intentar(b!.id, kB1), 201)
        iris.verificaciones.set(kB1, { status: 500, cuerpo: {} })
        const r503 = await estado(intentar(b!.id, `iris:no_recuperado:${orden}:${b!.id}:2`), 503)
        assert.match(r503.body().type, /verificacion_no_concluyente$/)
        assert.isDefined(r503.header('retry-after'))

        // Iris limita (429 con Retry-After): sigue pendiente y respeta la espera
        iris.verificaciones.set(kB1, { status: 429, cuerpo: {}, cabeceras: { 'retry-after': '120' } })
        const vb1 = await db
            .from('inventario.verificaciones_iris')
            .where('idempotency_key', kB1)
            .firstOrFail()
        await verificarAhora(Number(vb1.id), 'worker')
        const tras429 = await db.from('inventario.verificaciones_iris').where('id', vb1.id).firstOrFail()
        assert.equal(tras429.motivo, 'limitado')
        assert.isAbove(new Date(tras429.proxima_en).getTime(), Date.now() + 100_000)

        // 401: pendiente y aviso al admin (una vez), en el registro del sistema
        iris.verificaciones.set(kB1, { status: 401, cuerpo: {} })
        await verificarAhora(Number(vb1.id), 'worker')
        await verificarAhora(Number(vb1.id), 'worker')
        assert.lengthOf(
            await eventos('inventario.verificacion_sin_acceso', 'verificacion_id', Number(vb1.id)),
            1,
        )

        // la pantalla de declaración vuelve a verificar: ahora no_coincide → no cuenta
        iris.verificaciones.set(kB1, { status: 200, cuerpo: { verificado: false, motivo: 'no_coincide' } })
        const admin = s.e.token
        const pantalla = await estado(
            client
                .post(`/api/v1/inventario/unidades/${b!.id}/intentos-recuperacion/verificar`)
                .bearerToken(admin)
                .headers(s.cabecera),
            200,
        )
        assert.match(pantalla.body().aviso, /la afirma Iris|las afirma Iris/)
        assert.containSubset(pantalla.body().intentos[0], {
            verificacion: 'no_verificado',
            verificacion_motivo: 'no_coincide',
            cuenta: false,
            afirmado_por_iris: true,
        })
        assert.equal(await columna('inventario.unidades', b!.id, 'estado'), 'en_comodato')
    })

    test('cambio con cobro propuesto: foto obligatoria y el cobro entra a la cola solo verificado', async ({
        client,
        assert,
    }) => {
        const s = await escenario(client, 2)
        const token = await tokenIris()
        await fijarConector(iris.url, '0.14.0')
        await webhook('tecnico.argos_vinculado', {
            tecnico_id: 't-1',
            usuario_id: 'u-1',
            empresa_id: s.e.B,
            version: 1,
            id_externo: String(s.tecnico.usuario.id),
            anterior_id_externo: null,
        })
        const [a] = s.unidades
        const entra = s.unidades.at(-1)!
        const orden = `orden-${randomUUID()}`
        const ahora = new Date().toISOString()
        const cambiar = (clave: string, extra: Record<string, unknown> = {}) =>
            client
                .post(`/api/v1/servicios/${s.servicioId}/equipos/cambiar`)
                .bearerToken(token)
                .headers(s.cabecera)
                .header('X-Iris-Actor', 'usuario:u-1')
                .header('Idempotency-Key', clave)
                .json({
                    sale: { unidad_id: a!.id },
                    entra: { unidad_id: entra.id },
                    motivo: 'danado',
                    destino_sale: 'revision',
                    cobro_propuesto: { motivo: 'golpe' },
                    foto_ref: 'adj-golpe',
                    tecnico: { id_externo: String(s.tecnico.usuario.id) },
                    fecha: ahora,
                    recibido_en_iris: ahora,
                    origen_tipo: 'iris_orden',
                    origen_id: orden,
                    ...extra,
                })
        const sinFoto = await estado(cambiar(unico('k'), { foto_ref: null }), 422)
        assert.equal(sinFoto.body().errors[0].field, 'foto_ref')
        const clave = `iris:cambio:${orden}:${a!.id}:${randomUUID()}`
        const r = await estado(cambiar(clave), 200)
        assert.equal(r.body().cobro_verificacion, 'pendiente')
        const cobroId = r.body().cobro_propuesto_id
        const admin = s.e.token
        const cola = async () => {
            const lista = await estado(
                client.get('/api/v1/inventario/cobros-equipo').bearerToken(admin).headers(s.cabecera),
                200,
            )
            return lista.body().data.map((c: { id: number }) => c.id)
        }
        assert.notInclude(await cola(), cobroId)
        assert.equal(await columna('inventario.cobros_equipo', cobroId, 'estado'), 'por_verificar')
        // el movimiento del kardex guarda la clave y el actor (T-12)
        const mov = await db
            .from('inventario.movimientos')
            .where('unidad_id', entra.id)
            .orderBy('id', 'desc')
            .firstOrFail()
        assert.equal(mov.idempotency_key, clave)
        assert.equal(mov.actor_tecnico, 'usuario:u-1')

        iris.verificaciones.set(clave, { status: 200, cuerpo: { verificado: true, motivo: null } })
        const v = await db
            .from('inventario.verificaciones_iris')
            .where('idempotency_key', clave)
            .firstOrFail()
        assert.equal(v.operacion, 'cambio')
        await verificarAhora(Number(v.id), 'worker')
        assert.include(await cola(), cobroId)
        assert.equal(await columna('inventario.cobros_equipo', cobroId, 'estado'), 'propuesto')
        await afirmarLibroCuadrado(assert)
    })

    test('vínculos de técnicos: versión, rechazo por unicidad, reevaluación, carga inicial y actor', async ({
        client,
        assert,
    }) => {
        const s = await escenario(client, 1)
        const token = await tokenIris()
        await fijarConector(iris.url, '0.14.0', false)
        const otro = await tecnicoConBodega(s.e.B, s.e.ctx)
        const libre = s.unidades.at(-1)!
        const prestar = (actor: string, tecnicoId: number) =>
            client
                .post(`/api/v1/servicios/${s.servicioId}/equipos`)
                .bearerToken(token)
                .headers(s.cabecera)
                .header('X-Iris-Actor', actor)
                .header('Idempotency-Key', unico('c'))
                .json({ unidad_id: libre.id, tecnico: { id_externo: String(tecnicoId) } })

        // carga inicial abierta: sin vínculo, 409 vinculos_en_carga (se reintenta)
        const enCarga = await estado(prestar('usuario:u-1', s.tecnico.usuario.id), 409)
        assert.match(enCarga.body().type, /vinculos_en_carga$/)

        const base = { empresa_id: s.e.B, anterior_id_externo: null }
        const r1 = await webhook('tecnico.argos_vinculado', {
            ...base,
            tecnico_id: 't-1',
            usuario_id: 'u-1',
            version: 1,
            id_externo: String(s.tecnico.usuario.id),
        })
        assert.equal(r1.resultado, 'vinculo_aplicado')
        const viejo = await webhook('tecnico.argos_vinculado', {
            ...base,
            tecnico_id: 't-1',
            usuario_id: 'u-1',
            version: 1,
            id_externo: String(otro.usuario.id),
        })
        assert.equal(viejo.resultado, 'version_vieja')
        // el mismo id_externo para otro usuario de Iris: rechazado
        const doble = await webhook('tecnico.argos_vinculado', {
            ...base,
            tecnico_id: 't-2',
            usuario_id: 'u-2',
            version: 1,
            id_externo: String(s.tecnico.usuario.id),
        })
        assert.equal(doble.resultado, 'vinculo_rechazado')

        // Iris cierra la carga (aquí directo en la base; el PUT se prueba aparte)
        await db
            .from('integraciones.iris_conector')
            .update({ vinculos_cargados: 2, vinculos_cargados_en: new Date() })
        const desconocido = await estado(prestar('usuario:u-9', s.tecnico.usuario.id), 403)
        assert.equal(desconocido.body().type, 'urn:argosisp:problema:actor_desconocido')
        // vínculo conocido pero de otro técnico: actor_no_coincide también en la bodega personal
        const noCoincide = await estado(prestar('usuario:u-1', otro.usuario.id), 403)
        assert.match(noCoincide.body().type, /actor_no_coincide$/)

        // desvinculado libera el id: el rechazado se reevalúa con GET <iris>/…/tecnicos/u-2
        const quitado = await webhook('tecnico.argos_desvinculado', {
            ...base,
            tecnico_id: 't-1',
            usuario_id: 'u-1',
            version: 2,
            id_externo: String(s.tecnico.usuario.id),
            motivo: 'desactivado',
        })
        assert.equal(quitado.resultado, 'vinculo_quitado')
        iris.tecnicos.set('u-2', {
            status: 200,
            cuerpo: {
                tecnico_id: 't-2',
                usuario_id: 'u-2',
                empresa_id: s.e.B,
                id_externo: String(s.tecnico.usuario.id),
                version: 1,
                activo: true,
            },
        })
        await reevaluarVinculos({ limite: 500 })
        const v2 = await db
            .from('inventario.tecnicos_iris')
            .where({ empresa_id: s.e.B, iris_usuario_id: 'u-2' })
            .firstOrFail()
        assert.containSubset(v2, { estado: 'vinculado', origen: 'conciliacion' })
        assert.isNull(v2.reevaluar_en)
        assert.equal(iris.peticiones.at(-1)!.query.get('empresa_id'), String(s.e.B))

        // ahora u-2 presta con su vínculo, sin orden informada: alerta al admin (T-12)
        await estado(prestar('usuario:u-2', s.tecnico.usuario.id), 201)
        const alerta = await db
            .from('audit.outbox')
            .where('evento', 'inventario.alerta_tecnico')
            .whereRaw(`(payload->>'usuario_id')::bigint = ?`, [s.tecnico.usuario.id])
            .firstOrFail()
        assert.containSubset(alerta.payload, { motivo: 'sin_orden', actor_tecnico: 'usuario:u-2' })

        // el panel lista los vínculos
        const admin = s.e.token
        const lista = await estado(
            client.get('/api/v1/inventario/vinculos-tecnicos').bearerToken(admin).headers(s.cabecera),
            200,
        )
        const estados = Object.fromEntries(
            lista
                .body()
                .map((v: { iris_usuario_id: string; estado: string }) => [v.iris_usuario_id, v.estado]),
        )
        assert.equal(estados['u-1'], 'desvinculado')
        assert.equal(estados['u-2'], 'vinculado')
    })

    test('PUT /contrato: no soportado, sin retroceso desde 0.14.0 y cierre de la carga de vínculos', async ({
        client,
        assert,
    }) => {
        const token = await tokenIris()
        await fijarConector(iris.url, '0.13.0')
        const poner = (cuerpo: Record<string, unknown>) =>
            client.put('/api/v1/integraciones/iris/contrato').bearerToken(token).json(cuerpo)
        const mayor = await estado(poner({ contrato: '0.15.0' }), 422)
        assert.match(mayor.body().type, /contrato_no_soportado$/)
        assert.equal(await columna('integraciones.iris_conector', 1, 'contrato'), '0.13.0')

        // sube a 0.14.0: se abre la carga inicial
        await estado(poner({ contrato: '0.14.0' }), 200)
        let fila = await db.from('integraciones.iris_conector').firstOrFail()
        assert.isNull(fila.vinculos_cargados_en)
        await estado(poner({ contrato: '0.14.0', vinculos_cargados: 3 }), 200)
        fila = await db.from('integraciones.iris_conector').firstOrFail()
        assert.equal(fila.vinculos_cargados, 3)
        assert.isNotNull(fila.vinculos_cargados_en)

        // no baja: 409 y aviso al admin
        const antes = await db
            .from('audit.outbox')
            .where('evento', 'iris.contrato_regresivo')
            .count('* as n')
            .first()
        const regresivo = await estado(poner({ contrato: '0.13.0' }), 409)
        assert.match(regresivo.body().type, /contrato_regresivo$/)
        assert.equal(await columna('integraciones.iris_conector', 1, 'contrato'), '0.14.0')
        const despues = await db
            .from('audit.outbox')
            .where('evento', 'iris.contrato_regresivo')
            .count('* as n')
            .first()
        assert.equal(Number(despues!.n), Number(antes!.n) + 1)
    })

    test('Iris < 0.14.0: intento anterior a la verificación, lo decide una persona; contacto solo del panel', async ({
        client,
        assert,
    }) => {
        const s = await escenario(client, 1)
        const token = await tokenIris()
        await fijarConector(iris.url, '0.13.0')
        const [a] = s.unidades
        const ahora = new Date().toISOString()
        const r = await estado(
            client
                .post(`/api/v1/servicios/${s.servicioId}/equipos/${a!.id}/no-recuperado`)
                .bearerToken(token)
                .headers(s.cabecera)
                .header('X-Iris-Actor', 'usuario:u-1')
                .header('Idempotency-Key', `iris:no_recuperado:o-1:${a!.id}`)
                .json({ motivo: 'cliente_ausente', ubicacion, fecha: ahora, recibido_en_iris: ahora }),
            201,
        )
        assert.containSubset(r.body(), { verificacion: 'anterior', estado: 'en_comodato' })
        assert.lengthOf(await eventos('inventario.recuperacion_intentada', 'intento_id', r.body().id), 0)

        // el token de Iris no registra contactos (T-8)
        const admin = s.e.token
        const contacto = await estado(
            client
                .post(`/api/v1/inventario/unidades/${a!.id}/contactos-recuperacion`)
                .bearerToken(token)
                .headers(s.cabecera)
                .json({ medio: 'llamada', nota: 'gestión de cobro de Iris' }),
            403,
        )
        assert.notEqual(contacto.status(), 201)

        const decidido = await estado(
            client
                .post(`/api/v1/inventario/intentos-recuperacion/${r.body().id}/decidir`)
                .bearerToken(admin)
                .headers(s.cabecera)
                .json({ aceptar: true, motivo: 'foto revisada con el supervisor' }),
            200,
        )
        assert.containSubset(decidido.body(), { verificacion: 'aceptado', por_recuperar: true })
        await estado(
            client
                .post(`/api/v1/inventario/intentos-recuperacion/${r.body().id}/decidir`)
                .bearerToken(admin)
                .headers(s.cabecera)
                .json({ aceptar: false, motivo: 'otra vez' }),
            409,
        )
        const lista = await estado(
            client
                .get(`/api/v1/inventario/unidades/${a!.id}/intentos-recuperacion`)
                .bearerToken(admin)
                .headers(s.cabecera),
            200,
        )
        assert.containSubset(lista.body(), { tecnicos_que_cuentan: 1, tecnicos_minimos: 2, contactos: 0 })
        assert.equal(lista.body().intentos[0].verificacion, 'aceptado')
    })
})
