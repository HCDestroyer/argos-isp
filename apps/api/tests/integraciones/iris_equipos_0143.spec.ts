import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar } from '#shared/cifrado'
import { contextoPrueba, estado, soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { crearServicioFila } from '#tests/core/fabricas'
import GenerarTokenIris from '#core/actions/generar_token_iris'
import { usuarioIris } from '#core/integraciones_iris'
import ConfigurarEquipos from '#integraciones/equipos/actions/configurar_equipos'
import ProbarEquipos from '#integraciones/equipos/actions/probar_equipos'
import { procesarAprovisionamiento } from '#integraciones/equipos/cola'
import { fijarEsperaReintentos } from '#integraciones/equipos/http'
import { payloadParaIris } from '#integraciones/iris/envios'
import { EVENTO_BIENVENIDA } from '#notify/instalacion'
import CargarSaldoInicial from '#inventario/actions/cargar_saldo_inicial'
import { Simulado } from '#tests/integraciones/equipos_simulado'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { bodegaEn, productoEn } from '#tests/inventario/ayudas_inventario'
import { tecnicoConBodega } from '#tests/inventario/ayudas_fase_d'
import { unicoBdMayusculas } from '#tests/billing/ayudas_billing'

/**
 * Contrato Iris 0.14.3 del lado de Argos (§4.3, §12.2): `capacidades.equipos` por empresa del token,
 * `422 capacidad_no_disponible` después del alcance, la unidad por `unidad_id`, `serie` o `mac` con el
 * técnico vinculado (I1), el `409 aprovisionamiento_en_curso` con `iniciado_por`, el `GET` recortado de
 * un aprovisionamiento ajeno, sin `instalacion.*` de lo que inició el panel, y el comodato repetido
 * como hecho. SmartOLT y GenieACS simulados en local.
 *
 * `cobro_equipo` depende de `billing.conceptos_cargo.codigo_sistema`, que agrega A3 en esta misma
 * rama: sus dos pruebas fallan hasta entonces (pedido en `a6.md`).
 */

const TOKEN_SO = 'token-smartolt-0143'
const CLAVE_ACS = 'clave-acs-0143'

async function fijarConector(contrato: string) {
    await db.from('integraciones.iris_conector').delete()
    await db.table('integraciones.iris_conector').insert({
        id: 1,
        activo: true,
        url_base: 'http://127.0.0.1:9',
        token_cifrado: cifrar(`iris_pat_${'Zx9Cv8Bn'.repeat(4)}`),
        contrato,
        vinculos_cargados: 0,
        vinculos_cargados_en: new Date(),
    })
}

/** Token de Iris con alcance en `empresas` (sin alcance global). */
async function tokenIris(empresas: number[]) {
    const { token } = await new GenerarTokenIris().execute({ nombre: unico('Iris') }, contextoPrueba())
    const id = (await usuarioIris())!
    await db.from('core.usuarios').where('id', id).update({ activo: true, alcance_global: false })
    await db.from('core.usuarios_empresas').where('usuario_id', id).delete()
    for (const empresaId of empresas) {
        await db.table('core.usuarios_empresas').insert({ usuario_id: id, empresa_id: empresaId })
    }
    return token
}

/** SmartOLT y GenieACS de la empresa, probados (`acsOk = false`: el ACS no responde, sin TR-069). */
async function configurar(so: Simulado, acs: Simulado, empresaId: number, acsOk = true) {
    so.responder('GET /api/system/get_olts', () => ({
        status: 200,
        cuerpo: { status: true, response: [{ id: '1', name: 'OLT-Centro' }] },
    }))
    acs.responder('GET /devices/', () =>
        acsOk ? { status: 200, cuerpo: [] } : { status: 401, cuerpo: 'Unauthorized' },
    )
    const ctx = { ...contextoPrueba(), empresaId, empresasPermitidas: null }
    const fila = await db.from('integraciones.equipos_config').where('empresa_id', empresaId).first()
    await new ConfigurarEquipos().execute(
        {
            version: fila?.version ?? 0,
            activo: true,
            smartolt_url: so.url,
            smartolt_token: TOKEN_SO,
            genieacs_url: acs.url,
            genieacs_usuario: 'argos',
            genieacs_clave: CLAVE_ACS,
            perfiles: [],
        },
        ctx,
    )
    await new ProbarEquipos().execute({}, ctx)
}

async function servicioPendiente(empresaId: number) {
    const { clienteId } = await servicioEn(empresaId)
    const servicioId = await crearServicioFila({
        cliente_id: clienteId,
        empresa_id: empresaId,
        estado: 'pendiente_instalacion',
        instalado_en: null,
    })
    return { clienteId, servicioId }
}

async function vincular(empresaId: number, usuarioId: number, irisUsuario = unico('u')) {
    await db.table('inventario.tecnicos_iris').insert({
        empresa_id: empresaId,
        iris_usuario_id: irisUsuario,
        usuario_id: usuarioId,
        id_externo: String(usuarioId),
        estado: 'vinculado',
        version: 1,
        origen: 'webhook',
    })
}

const cpe = (mac: string, extra: Record<string, unknown> = {}) => ({
    equipo: { tipo: 'cpe_wireless', serie: null, mac, unidad_id: null, modelo: 'LiteBeam 5AC' },
    wireless: { ap: 'AP-Norte', sector: 'S2' },
    wifi: null,
    origen_tipo: 'iris_orden',
    origen_id: '9124',
    ...extra,
})

function macUnica() {
    const h = randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()
    return h.match(/.{2}/g)!.join(':')
}

test.group('Iris 0.14.3 · capacidades de equipos y activación con la orden cerrada', (group) => {
    const so = new Simulado()
    const acs = new Simulado()
    group.setup(async () => {
        process.env.EQUIPOS_PERMITIR_HTTP = 'true'
        process.env.EQUIPOS_SIN_COLA = 'true'
        fijarEsperaReintentos(0)
        await so.iniciar()
        await acs.iniciar()
        return async () => {
            await so.detener()
            await acs.detener()
            delete process.env.EQUIPOS_PERMITIR_HTTP
            delete process.env.EQUIPOS_SIN_COLA
        }
    })
    group.each.setup(() => {
        so.limpiar()
        acs.limpiar()
    })
    group.each.teardown(async () => {
        await db.from('integraciones.equipos_perfiles').delete()
        await db.from('integraciones.equipos_config').delete()
        await db.from('integraciones.iris_conector').delete()
        await soloEmpresaPrincipal()
    })

    test('capacidades.equipos: una fila por empresa del token, por configuración; < 0.9.0 todo en false', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await configurar(so, acs, e.B)
        await fijarConector('0.14.3')
        const iris = await tokenIris([1, e.B])
        const r = await estado(client.get('/api/v1/integraciones/iris/estado').bearerToken(iris), 200)
        const filas = r.body().capacidades.equipos as Array<Record<string, unknown>>
        // solo las empresas del token (C no), en orden de id
        assert.deepEqual(
            filas.map((f) => f.empresa_id),
            [1, e.B],
        )
        assert.containSubset(filas[0], { empresa_id: 1, estado_equipo: false, wifi: false })
        assert.containSubset(filas[1], { empresa_id: e.B, estado_equipo: true, wifi: true })
        // aprovisionamiento sigue con todas las empresas activas
        assert.isAtLeast(r.body().capacidades.aprovisionamiento.length, 3)

        // con un Iris < 0.9.0, todas en false; aprovisionamiento conserva su valor
        await db.from('integraciones.iris_conector').update({ contrato: '0.8.1' })
        const viejo = await estado(client.get('/api/v1/integraciones/iris/estado').bearerToken(iris), 200)
        for (const f of viejo.body().capacidades.equipos) {
            assert.containSubset(f, {
                estado_equipo: false,
                wifi: false,
                bienvenida: false,
                cobro_equipo: false,
            })
        }
        assert.deepInclude(viejo.body().capacidades.aprovisionamiento, {
            empresa_id: e.B,
            ftth: true,
            wireless: true,
            tr069: true,
        })
    })

    test('422 capacidad_no_disponible después del alcance: equipo, wifi, wifi de aprovisionar y reenviar', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        // B con SmartOLT pero sin ACS: estado_equipo sí, wifi no
        await configurar(so, acs, e.B, false)
        await fijarConector('0.14.3')
        const iris = await tokenIris([e.B])
        const { servicioId } = await servicioEn(e.B)
        const deC = await servicioEn(e.C)

        // alcance primero: un servicio de otra empresa responde el 404 de uno que no existe
        const fuera = await estado(
            client
                .get(`/api/v1/servicios/${deC.servicioId}/equipo`)
                .bearerToken(iris)
                .header('X-Iris-Actor', 'usuario:57'),
            404,
        )
        const inexistente = await estado(
            client
                .get('/api/v1/servicios/999999999/equipo')
                .bearerToken(iris)
                .header('X-Iris-Actor', 'usuario:57'),
            404,
        )
        assert.equal(fuera.body().type, inexistente.body().type)
        assert.equal(fuera.body().detail, `El servicio ${deC.servicioId} no existe`)

        // wifi sin la marca (sin ACS): 422 sin extensions ni datos del ACS
        const wifi = await estado(
            client
                .post(`/api/v1/servicios/${servicioId}/wifi`)
                .bearerToken(iris)
                .header('X-Iris-Actor', 'usuario:57')
                .header('Idempotency-Key', `iris:wifi:orden:1:${unico('w')}`)
                .json({ clave: 'ClaveNueva!123', origen_tipo: 'iris_orden', origen_id: '1' }),
            422,
        )
        assert.equal(wifi.body().type, 'urn:argosisp:problema:capacidad_no_disponible')
        assert.notProperty(wifi.body(), 'extensions')
        assert.notInclude(JSON.stringify(wifi.body()), acs.url)
        assert.notInclude(JSON.stringify(wifi.body()).toLowerCase(), 'genieacs')

        // `wifi` de aprovisionar sin la marca: 422 capacidad_no_disponible (no wifi_no_disponible)
        const pendiente = await servicioPendiente(e.B)
        const aprov = await estado(
            client
                .post(`/api/v1/servicios/${pendiente.servicioId}/aprovisionar`)
                .bearerToken(iris)
                .header('X-Iris-Actor', 'usuario:57')
                .header('Idempotency-Key', `iris:aprovisionar:1:${unico('a')}`)
                .json(cpe(macUnica(), { wifi: { ssid: 'Casa', clave: 'ClaveWifi!123' } })),
            422,
        )
        assert.equal(aprov.body().type, 'urn:argosisp:problema:capacidad_no_disponible')
        assert.lengthOf(
            await db.from('integraciones.aprovisionamientos').where('servicio_id', pendiente.servicioId),
            0,
        )

        // empresa sin SmartOLT ni ACS: GET equipo 422 (antes que equipo_sin_gestion)
        await db.from('integraciones.equipos_config').where('empresa_id', e.B).update({ activo: false })
        const equipo = await estado(
            client
                .get(`/api/v1/servicios/${servicioId}/equipo`)
                .bearerToken(iris)
                .header('X-Iris-Actor', 'usuario:57'),
            422,
        )
        assert.equal(equipo.body().type, 'urn:argosisp:problema:capacidad_no_disponible')
        assert.notProperty(equipo.body(), 'extensions')

        // reenviar la bienvenida sin plantilla activa: 422
        const plantillas = await db
            .from('notify.plantillas')
            .where({ evento: EVENTO_BIENVENIDA, activa: true })
            .select('id')
        await db
            .from('notify.plantillas')
            .whereIn(
                'id',
                plantillas.map((p) => p.id),
            )
            .update({ activa: false })
        try {
            const reenviar = await estado(
                client
                    .post(`/api/v1/servicios/${servicioId}/bienvenida/reenviar`)
                    .bearerToken(iris)
                    .header('X-Iris-Actor', 'usuario:57')
                    .header('Idempotency-Key', `iris:bienvenida:1:${unico('b')}`)
                    .json({}),
                422,
            )
            assert.equal(reenviar.body().type, 'urn:argosisp:problema:capacidad_no_disponible')
        } finally {
            await db
                .from('notify.plantillas')
                .whereIn(
                    'id',
                    plantillas.map((p) => p.id),
                )
                .update({ activa: true })
        }

        // con un Iris 0.14.2 nada cambia: 409 equipo_sin_gestion y 403 de otra empresa
        await db.from('integraciones.iris_conector').update({ contrato: '0.14.2' })
        const antes = await estado(
            client
                .get(`/api/v1/servicios/${servicioId}/equipo`)
                .bearerToken(iris)
                .header('X-Iris-Actor', 'usuario:57'),
            409,
        )
        assert.equal(antes.body().type, 'urn:argosisp:problema:equipo_sin_gestion')
        await estado(
            client
                .get(`/api/v1/servicios/${deC.servicioId}/equipo`)
                .bearerToken(iris)
                .header('X-Iris-Actor', 'usuario:57'),
            403,
        )
    })

    test('§12.2: técnico vinculado, unidad por serie o MAC, 403, 409 sin decir dónde y comodato como hecho', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await configurar(so, acs, e.B)
        await fijarConector('0.14.3')
        const iris = await tokenIris([e.B])
        const producto = await productoEn(e.B, e.ctx, { tipo: 'equipo', seguimiento: 'serie' })
        const central = await bodegaEn(e.B, e.ctx)
        const tecnico = await tecnicoConBodega(e.B, e.ctx)
        const cargar = async (
            bodegaId: number,
            unidad: { serie?: string; mac?: string },
            empresaId = e.B,
        ) => {
            const prod =
                empresaId === e.B
                    ? producto
                    : await productoEn(empresaId, e.ctx, { tipo: 'equipo', seguimiento: 'serie' })
            await new CargarSaldoInicial().execute(
                { producto_id: prod.id, bodega_id: bodegaId, unidad, costo_total: '300.00' },
                e.ctx,
            )
        }
        const macTecnico = macUnica()
        const serieCentral = await unicoBdMayusculas('cpe')
        const macOtraEmpresa = macUnica()
        await cargar(tecnico.bodega.id, { mac: macTecnico })
        await cargar(central.id, { serie: serieCentral, mac: macUnica() })
        const bodegaC = await bodegaEn(e.C, e.ctx)
        await cargar(bodegaC.id, { mac: macOtraEmpresa }, e.C)

        const pedir = (servicioId: number, cuerpo: Record<string, unknown>) =>
            client
                .post(`/api/v1/servicios/${servicioId}/aprovisionar`)
                .bearerToken(iris)
                .header('X-Iris-Actor', 'usuario:agente-1')
                .header('Idempotency-Key', `iris:aprovisionar:9124:${unico('i')}`)
                .json(cuerpo)
        const tec = { tecnico: { id_externo: String(tecnico.usuario.id) } }
        const { servicioId } = await servicioPendiente(e.B)

        // con `tecnico` sin vínculo I1 en la empresa: 403 actor_desconocido
        const sinVinculo = await estado(pedir(servicioId, cpe(macTecnico, tec)), 403)
        assert.equal(sinVinculo.body().type, 'urn:argosisp:problema:actor_desconocido')
        await vincular(e.B, tecnico.usuario.id)

        // unidad en otra bodega de la empresa, buscada por serie: 409 sin decir cuál
        const otra = await estado(
            pedir(
                servicioId,
                cpe(macUnica(), {
                    ...tec,
                    equipo: { tipo: 'cpe_wireless', serie: serieCentral.toLowerCase(), mac: macUnica() },
                }),
            ),
            409,
        )
        assert.equal(otra.body().type, 'urn:argosisp:problema:unidad_en_otra_bodega')
        assert.notInclude(otra.body().detail, String(central.id))
        // unidad de otra empresa: el mismo 409
        const otraEmpresa = await estado(pedir(servicioId, cpe(macOtraEmpresa, tec)), 409)
        assert.equal(otraEmpresa.body().type, 'urn:argosisp:problema:unidad_en_otra_bodega')
        assert.notInclude(otraEmpresa.body().detail, String(bodegaC.id))
        // sin `tecnico`, una unidad disponible (aunque esté en la bodega del técnico): 409
        await estado(pedir(servicioId, cpe(macTecnico)), 409)

        // con el técnico vinculado y la unidad en su bodega, buscada por MAC (minúsculas): comodato al activar
        const ok = await estado(pedir(servicioId, cpe(macTecnico.toLowerCase(), tec)), 202)
        assert.equal(await procesarAprovisionamiento(ok.body().aprovisionamiento_id), 'listo')
        const unidad = await db.from('inventario.unidades').where('mac', macTecnico).firstOrFail()
        assert.equal(unidad.estado, 'en_comodato')
        assert.equal(Number(unidad.servicio_id), servicioId)
        const fila = await db
            .from('integraciones.aprovisionamientos')
            .where('id', ok.body().aprovisionamiento_id)
            .firstOrFail()
        assert.equal(Number(fila.bodega_id), tecnico.bodega.id)
        assert.equal(fila.equipo.unidad_id, Number(unidad.id))

        // el comodato que manda Iris al cerrar la orden activada fuera: hecho, sin duplicarlo
        const movimientos = async () => {
            const [conteo] = await db
                .from('inventario.movimientos')
                .where('unidad_id', unidad.id)
                .count('* as n')
            return Number(conteo.n)
        }
        const antes = await movimientos()
        const comodato = await estado(
            client
                .post(`/api/v1/servicios/${servicioId}/equipos`)
                .bearerToken(iris)
                .header('X-Iris-Actor', 'usuario:agente-1')
                .header('Idempotency-Key', `iris:comodato:9124:${unico('c')}`)
                .json({ unidad_id: Number(unidad.id), origen_tipo: 'iris_orden', origen_id: '9124' }),
            201,
        )
        assert.equal(comodato.body().id, Number(unidad.id))
        assert.equal(await movimientos(), antes)
        // con un Iris 0.14.2, el mismo comodato sigue siendo 409 unidad_en_comodato
        await db.from('integraciones.iris_conector').update({ contrato: '0.14.2' })
        const viejo = await estado(
            client
                .post(`/api/v1/servicios/${servicioId}/equipos`)
                .bearerToken(iris)
                .header('X-Iris-Actor', 'usuario:agente-1')
                .header('Idempotency-Key', `iris:comodato:9124:${unico('c')}`)
                .json({ unidad_id: Number(unidad.id), origen_tipo: 'iris_orden', origen_id: '9124' }),
            409,
        )
        assert.equal(viejo.body().type, 'urn:argosisp:problema:unidad_en_comodato')
        await db.from('integraciones.iris_conector').update({ contrato: '0.14.3' })

        // sin `tecnico`: la unidad ya asignada al servicio sirve (otro servicio pendiente del mismo
        // cliente no; aquí el mismo servicio vuelve a pendiente para un reintento de la activación)
        await db
            .from('core.servicios')
            .where('id', servicioId)
            .update({ estado: 'pendiente_instalacion', instalado_en: null })
        const yaAsignada = await estado(pedir(servicioId, cpe(macTecnico)), 202)
        const otraFila = await db
            .from('integraciones.aprovisionamientos')
            .where('id', yaAsignada.body().aprovisionamiento_id)
            .firstOrFail()
        assert.isNull(otraFila.bodega_id)
        assert.equal(otraFila.equipo.unidad_id, Number(unidad.id))

        // un equipo que no está en el inventario: permitido y sin comodato
        const nuevo = await servicioPendiente(e.B)
        const fuera = await estado(pedir(nuevo.servicioId, cpe(macUnica())), 202)
        const filaFuera = await db
            .from('integraciones.aprovisionamientos')
            .where('id', fuera.body().aprovisionamiento_id)
            .firstOrFail()
        assert.isNull(filaFuera.equipo.unidad_id)
        assert.isNull(filaFuera.bodega_id)
    })

    test('409 aprovisionamiento_en_curso con id e iniciado_por; GET recortado, 404 fuera del token y sin instalacion.* del panel', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await configurar(so, acs, e.B)
        await configurar(so, acs, e.C)
        await fijarConector('0.14.3')
        const iris = await tokenIris([e.B])
        const { servicioId } = await servicioPendiente(e.B)

        // el panel de Argos lo inicia: origen argos_panel y origen_id null aunque mande otro
        const panel = await estado(
            client
                .post(`/api/v1/servicios/${servicioId}/aprovisionar`)
                .bearerToken(e.token)
                .header('X-Empresa-Id', String(e.B))
                .header('Idempotency-Key', unico('panel'))
                .json(cpe(macUnica())),
            202,
        )
        const id = panel.body().aprovisionamiento_id
        const fila = await db.from('integraciones.aprovisionamientos').where('id', id).firstOrFail()
        assert.equal(fila.origen_tipo, 'argos_panel')
        assert.isNull(fila.origen_id)

        // Iris pide otro: 409 con el id y iniciado_por argos, sin datos del equipo
        const enCurso = await estado(
            client
                .post(`/api/v1/servicios/${servicioId}/aprovisionar`)
                .bearerToken(iris)
                .header('X-Iris-Actor', 'usuario:57')
                .header('Idempotency-Key', `iris:aprovisionar:9124:${unico('i')}`)
                .json(cpe(macUnica())),
            409,
        )
        assert.equal(enCurso.body().type, 'urn:argosisp:problema:aprovisionamiento_en_curso')
        assert.deepEqual(enCurso.body().extensions, { aprovisionamiento_id: id, iniciado_por: 'argos' })

        // GET de Iris: recortado (sin equipo, pasos, detalle ni senal)
        const ajeno = await estado(client.get(`/api/v1/aprovisionamientos/${id}`).bearerToken(iris), 200)
        assert.deepEqual(Object.keys(ajeno.body()).sort(), [
            'actualizado_en',
            'aprovisionamiento_id',
            'causa',
            'empresa_id',
            'estado',
            'iniciado_por',
            'origen_id',
            'origen_tipo',
            'servicio_id',
        ])
        assert.containSubset(ajeno.body(), {
            aprovisionamiento_id: id,
            servicio_id: servicioId,
            empresa_id: e.B,
            origen_tipo: 'argos_panel',
            origen_id: null,
            iniciado_por: 'argos',
        })
        // el panel lo ve completo
        const completo = await estado(
            client
                .get(`/api/v1/aprovisionamientos/${id}`)
                .bearerToken(e.token)
                .header('X-Empresa-Id', String(e.B)),
            200,
        )
        assert.property(completo.body(), 'equipo')
        assert.property(completo.body(), 'pasos')
        assert.equal(completo.body().iniciado_por, 'argos')

        // termina: sin webhook `instalacion.*` a Iris
        assert.equal(await procesarAprovisionamiento(id), 'listo')
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'instalacion.aprovisionada')
            .whereRaw(`(payload->>'aprovisionamiento_id')::bigint = ?`, [id])
            .firstOrFail()
        assert.isNull(await payloadParaIris('instalacion.aprovisionada', evento.payload))
        assert.isNull(
            await payloadParaIris('instalacion.fallida', {
                ...evento.payload,
                causa: 'otro',
                reintentable: false,
            }),
        )

        // uno de Iris en C (fuera del token): 404 como uno que no existe
        const deC = await servicioPendiente(e.C)
        const irisC = await tokenIris([e.C])
        const enC = await estado(
            client
                .post(`/api/v1/servicios/${deC.servicioId}/aprovisionar`)
                .bearerToken(irisC)
                .header('X-Iris-Actor', 'usuario:57')
                .header('Idempotency-Key', `iris:aprovisionar:77:${unico('i')}`)
                .json(cpe(macUnica())),
            202,
        )
        // el de Iris, visto por Iris: completo, con iniciado_por iris
        const irisCompleto = await estado(
            client.get(`/api/v1/aprovisionamientos/${enC.body().aprovisionamiento_id}`).bearerToken(irisC),
            200,
        )
        assert.equal(irisCompleto.body().iniciado_por, 'iris')
        assert.property(irisCompleto.body(), 'equipo')
        // con el token limitado a B, el de C responde el 404 de uno que no existe
        const soloB = await tokenIris([e.B])
        const noVisible = await estado(
            client.get(`/api/v1/aprovisionamientos/${enC.body().aprovisionamiento_id}`).bearerToken(soloB),
            404,
        )
        const noExiste = await estado(
            client.get('/api/v1/aprovisionamientos/999999999').bearerToken(soloB),
            404,
        )
        assert.equal(noVisible.body().type, noExiste.body().type)
        assert.equal(
            noVisible.body().detail,
            `El aprovisionamiento ${enC.body().aprovisionamiento_id} no existe`,
        )
    })

    test('Idempotency-Key antes que la capacidad: replay 2xx con la marca apagada, 409 en curso y 422 con clave nueva', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await configurar(so, acs, e.B)
        await fijarConector('0.14.3')
        const iris = await tokenIris([e.B])
        const { servicioId } = await servicioPendiente(e.B)
        const cuerpo = cpe(macUnica(), { wifi: { ssid: 'Casa', clave: 'ClaveWifi!123' } })
        const clave = `iris:aprovisionar:9130:${unico('i')}`
        const pedir = (k: string) =>
            client
                .post(`/api/v1/servicios/${servicioId}/aprovisionar`)
                .bearerToken(iris)
                .header('X-Iris-Actor', 'usuario:57')
                .header('Idempotency-Key', k)
                .json(cuerpo)
        const primera = await estado(pedir(clave), 202)

        // la marca `wifi` se apaga (la empresa deja de tener el ACS)
        await db.from('integraciones.equipos_config').where('empresa_id', e.B).update({ activo: false })

        // 1. la misma clave y huella: el 2xx original, sin mirar la capacidad
        const replay = await estado(pedir(clave), 202)
        assert.equal(replay.header('idempotent-replayed'), 'true')
        assert.deepEqual(replay.body(), primera.body())

        // 2. la misma clave todavía en curso: 409 idempotencia_en_curso
        await db.from('core.idempotency_keys').where('clave', clave).update({ respuesta: null })
        const enCurso = await estado(pedir(clave), 409)
        assert.equal(enCurso.body().type, 'urn:argosisp:problema:idempotencia_en_curso')

        // 3. clave nueva: alcance y después la capacidad (422 antes que aprovisionamiento_en_curso)
        const nueva = await estado(pedir(`${clave}:2`), 422)
        assert.equal(nueva.body().type, 'urn:argosisp:problema:capacidad_no_disponible')
    })

    // Pendiente de A3: necesita `billing.conceptos_cargo.codigo_sistema` (concepto de instalación)
    test('cobro_equipo: capacidades y 422 solo en la línea de instalación; un 422 no guarda la clave', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await fijarConector('0.14.3')
        const iris = await tokenIris([e.B])
        const { servicioId } = await servicioEn(e.B)
        const instalacion = await db
            .from('billing.conceptos_cargo')
            .where({ empresa_id: e.B, codigo_sistema: 'instalacion' })
            .firstOrFail()
        const visita = await db
            .from('billing.conceptos_cargo')
            .where({ empresa_id: e.B, nombre: 'Visita técnica' })
            .firstOrFail()
        const marcas = async () => {
            const r = await estado(client.get('/api/v1/integraciones/iris/estado').bearerToken(iris), 200)
            return r.body().capacidades.equipos[0]
        }
        assert.containSubset(await marcas(), { empresa_id: e.B, cobro_equipo: true })

        await db.from('billing.conceptos_cargo').where('id', instalacion.id).update({ activo: false })
        assert.containSubset(await marcas(), { empresa_id: e.B, cobro_equipo: false })

        const clave = `iris:cargo:9124:${unico('k')}`
        const cargo = (lineas: Array<Record<string, unknown>>) =>
            client
                .post('/api/v1/facturas/cargo-unico')
                .bearerToken(iris)
                .header('X-Empresa-Id', String(e.B))
                .header('X-Iris-Actor', 'usuario:57')
                .header('Idempotency-Key', clave)
                .json({ servicio_id: servicioId, lineas, origen_tipo: 'iris_orden', origen_id: '9124' })
        const r422 = await estado(
            cargo([
                { concepto_id: Number(instalacion.id), precio_unitario: '250.00' },
                { concepto_id: Number(visita.id), precio_unitario: '100.00' },
            ]),
            422,
        )
        assert.equal(r422.body().type, 'urn:argosisp:problema:capacidad_no_disponible')
        assert.notProperty(r422.body(), 'extensions')
        // la misma clave con las demás líneas no devuelve la respuesta del 422: emite
        const ok = await estado(cargo([{ concepto_id: Number(visita.id), precio_unitario: '100.00' }]), 201)
        assert.equal(ok.body().documento, 'factura')
    })

    test('cobro_equipo: un concepto distinto de instalación nunca responde capacidad_no_disponible', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await fijarConector('0.14.3')
        const iris = await tokenIris([e.B])
        const { servicioId } = await servicioEn(e.B)
        // sin concepto de instalación activo (marca en false; el sembrado se llama «Instalación»)
        await db
            .from('billing.conceptos_cargo')
            .where({ empresa_id: e.B, nombre: 'Instalación' })
            .update({ activo: false })
        const visita = await db
            .from('billing.conceptos_cargo')
            .where({ empresa_id: e.B, nombre: 'Visita técnica' })
            .firstOrFail()
        const r = await estado(
            client
                .post('/api/v1/facturas/cargo-unico')
                .bearerToken(iris)
                .header('X-Empresa-Id', String(e.B))
                .header('X-Iris-Actor', 'usuario:57')
                .header('Idempotency-Key', `iris:cargo:9125:${unico('k')}`)
                .json({
                    servicio_id: servicioId,
                    lineas: [{ concepto_id: Number(visita.id), precio_unitario: '100.00' }],
                    origen_tipo: 'iris_orden',
                    origen_id: '9125',
                }),
            201,
        )
        assert.equal(r.body().documento, 'factura')
    })
})
