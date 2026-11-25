import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearServicioFila } from '#tests/core/fabricas'
import GenerarTokenIris from '#core/actions/generar_token_iris'
import { usuarioIris } from '#core/integraciones_iris'
import { procesarAprovisionamiento } from '#integraciones/equipos/cola'
import { fijarEsperaReintentos } from '#integraciones/equipos/http'
import { capacidadesIris } from '#integraciones/equipos/equipos'
import CrearInstanciaSmartOlt from '#integraciones/equipos/actions/crear_instancia_smartolt'
import EditarInstanciaSmartOlt from '#integraciones/equipos/actions/editar_instancia_smartolt'
import ProbarInstanciaSmartOlt from '#integraciones/equipos/actions/probar_instancia_smartolt'
import { prepararEmpresas } from '#tests/contabilidad/ayudas_contabilidad'
import { Simulado, limpiarEquipos, onuSinConfigurar } from '#tests/integraciones/equipos_simulado'

/**
 * SmartOLT con varias instancias (subdominios) y varias OLT por instancia (`contratos/equipos-olt-acs.md`
 * lote 3, casos 1 a 12; el 13 es `equipos_smartolt_genieacs.spec.ts`). Cada simulado es una cuenta.
 */

const TOKEN_A = 'token-instancia-a-111'
const TOKEN_B = 'token-instancia-b-222'

const ctxGlobal = (empresaId = 1) => ({ ...contextoPrueba(), empresaId, empresasPermitidas: null })

async function tokenIris() {
    const { token } = await new GenerarTokenIris().execute({ nombre: unico('Iris') }, contextoPrueba())
    const id = (await usuarioIris())!
    await db.from('core.usuarios').where('id', id).update({ activo: true, alcance_global: true })
    await db.from('core.usuarios_empresas').where('usuario_id', id).delete()
    return token
}

async function usuarioEnEmpresas(roles: string[], empresas: number[]) {
    const datos = await usuarioConRoles(roles)
    await db.from('core.usuarios').where('id', datos.usuario.id).update({ alcance_global: false })
    await db
        .table('core.usuarios_empresas')
        .multiInsert(empresas.map((empresaId) => ({ usuario_id: datos.usuario.id, empresa_id: empresaId })))
    return datos
}

async function servicioPendiente(datos: Record<string, unknown> = {}) {
    const clienteId = await crearClienteFila()
    const servicioId = await crearServicioFila({ cliente_id: clienteId, empresa_id: 1, ...datos })
    await db
        .from('core.servicios')
        .where('id', servicioId)
        .update({ estado: 'pendiente_instalacion', instalado_en: null })
    const fila = await db.from('core.servicios').where('id', servicioId).firstOrFail()
    return { clienteId, servicioId, planId: Number(fila.plan_id), routerId: Number(fila.router_id) }
}

/** OLT de Argos y el camino servidor PPPoE → VLAN → puerto PON → OLT del servicio. */
async function oltDeArgos(nombre: string, empresaId: number | null = null) {
    const [olt] = await db.table('network.olts').insert({ nombre, empresa_id: empresaId }).returning('id')
    return Number(olt.id)
}

async function servicioEnOlt(servicioId: number, routerId: number, oltId: number) {
    const [puerto] = await db
        .table('network.olt_puertos_pon')
        .insert({ olt_id: oltId, identificador: '0/1/3' })
        .returning('id')
    const vlanId = 100 + Math.floor(Math.random() * 3900)
    const [vlan] = await db
        .table('network.vlans')
        .insert({
            router_id: routerId,
            interfaz_padre: 'ether2',
            vlan_id: vlanId,
            nombre: unico('vlan'),
            puerto_pon_id: puerto.id,
        })
        .returning('id')
    const [sp] = await db
        .table('network.servidores_pppoe')
        .insert({
            router_id: routerId,
            nombre: unico('pppoe'),
            vlan_id: vlan.id,
            interfaz: unico('vlan-if'),
            service_name: 'argos',
        })
        .returning('id')
    await db.from('core.servicios').where('id', servicioId).update({ servidor_pppoe_id: sp.id })
}

interface CuentaSmartOlt {
    olts: Array<{ id: string; name: string }>
    token: string
    /** series sin autorizar en esta cuenta (en su OLT `oltId`) */
    sinAutorizar: Map<string, string>
    autorizadas: Map<string, string>
}

/** Respuestas documentadas de SmartOLT para una cuenta simulada. */
function cuenta(sim: Simulado, c: CuentaSmartOlt) {
    const conToken =
        (h: (p: Parameters<Parameters<Simulado['responder']>[1]>[0]) => unknown) =>
        (p: Parameters<Parameters<Simulado['responder']>[1]>[0]) =>
            p.cabeceras['x-token'] === c.token
                ? { status: 200, cuerpo: h(p) }
                : {
                      status: 403,
                      cuerpo: { status: false, error: 'Invalid API Key', error_code: 'forbidden' },
                  }
    sim.responder(
        'GET /api/system/get_olts',
        conToken(() => ({
            status: true,
            response: c.olts.map((o) => ({ ...o, olt_hardware_version: 'Huawei-MA5800', ip: '10.0.0.1' })),
        })),
    )
        .responder(
            'GET /api/onu/get_onus_details_by_sn/*',
            conToken((p) => {
                const sn = decodeURIComponent(p.ruta.split('/').at(-1)!)
                const ext = c.autorizadas.get(sn)
                return {
                    status: true,
                    onus: ext ? [{ unique_external_id: ext, sn, onu_type_name: 'F670L' }] : [],
                }
            }),
        )
        .responder(
            'GET /api/onu/unconfigured_onus',
            conToken((p) => {
                const sn = p.consulta.get('sn') ?? ''
                const olt = c.sinAutorizar.get(sn)
                return { status: true, response: olt ? [onuSinConfigurar(sn, olt)] : [] }
            }),
        )
        .responder(
            'POST /api/onu/authorize_onu',
            conToken((p) => {
                const sn = p.form.get('sn')!
                c.sinAutorizar.delete(sn)
                c.autorizadas.set(sn, p.form.get('onu_external_id')!)
                return { status: true, response: 'ONU configuration saved' }
            }),
        )
        .responder(
            'GET /api/onu/get_onu_signal/*',
            conToken(() => ({ status: true, onu_signal_1490: '-19.80 dBm' })),
        )
        .responder(
            'GET /api/onu/get_onu_status/*',
            conToken(() => ({
                status: true,
                onu_status: 'Online',
                last_status_change: '2026-11-25 10:00:00',
            })),
        )
}

function nuevaCuenta(olts: Array<{ id: string; name: string }>, token: string): CuentaSmartOlt {
    return { olts, token, sinAutorizar: new Map(), autorizadas: new Map() }
}

/** Instancia creada, (opcionalmente con perfiles) y probada por las acciones. */
async function instancia(
    sim: Simulado,
    token: string,
    opciones: {
        nombre?: string
        empresaId?: number
        compartida?: boolean
        perfiles?: Array<{
            smartolt_olt_id: string
            plan_id?: number | null
            authorization_preset_id: number
        }>
        probar?: boolean
    } = {},
) {
    const ctx = ctxGlobal(opciones.empresaId ?? 1)
    const creada = await new CrearInstanciaSmartOlt().execute(
        {
            nombre: opciones.nombre ?? unico('SmartOLT'),
            url: sim.url,
            token,
            activo: true,
            compartida: opciones.compartida,
        },
        ctx,
    )
    let version = creada.version
    if (opciones.perfiles) {
        const editada = await new EditarInstanciaSmartOlt().execute(
            { id: creada.id, version, perfiles: opciones.perfiles },
            ctx,
        )
        version = editada.version
    }
    if (opciones.probar !== false) await new ProbarInstanciaSmartOlt().execute({ id: creada.id }, ctx)
    return creada.id
}

const serieUnica = () => `ZTEG${unico('s').replace(/\W/g, '').slice(-8).toUpperCase()}`

const pedirOnt = (client: any, iris: string, servicioId: number, serie: string, extra: object = {}) =>
    client
        .post(`/api/v1/servicios/${servicioId}/aprovisionar`)
        .bearerToken(iris)
        .header('X-Iris-Actor', 'usuario:57')
        .header('Idempotency-Key', `iris:aprovisionar:9:${unico('i')}`)
        .json({ equipo: { tipo: 'ont', serie }, origen_tipo: 'iris_orden', origen_id: '9', ...extra })

test.group('Equipos · SmartOLT con varias instancias (lote 3)', (group) => {
    const a = new Simulado()
    const b = new Simulado()
    group.setup(async () => {
        process.env.EQUIPOS_PERMITIR_HTTP = 'true'
        process.env.EQUIPOS_SIN_COLA = 'true'
        fijarEsperaReintentos(0)
        await a.iniciar()
        await b.iniciar()
        return async () => {
            await a.detener()
            await b.detener()
            delete process.env.EQUIPOS_PERMITIR_HTTP
            delete process.env.EQUIPOS_SIN_COLA
        }
    })
    group.each.setup(async () => {
        a.limpiar()
        b.limpiar()
        await db.from('integraciones.equipos_servicio').delete()
        await limpiarEquipos()
    })
    group.each.teardown(async () => {
        await db.from('integraciones.equipos_servicio').delete()
        await limpiarEquipos()
        await soloEmpresaPrincipal()
    })

    test('1: solo SmartOLT → ftth sí, tr069 y wifi no; una ONT sin Wi-Fi queda lista sin GenieACS', async ({
        client,
        assert,
    }) => {
        const { servicioId, planId } = await servicioPendiente()
        const serie = serieUnica()
        const ca = nuevaCuenta([{ id: '1', name: 'Norte' }], TOKEN_A)
        ca.sinAutorizar.set(serie, '1')
        cuenta(a, ca)
        await instancia(a, TOKEN_A, {
            perfiles: [{ smartolt_olt_id: '1', plan_id: null, authorization_preset_id: 31 }],
        })

        const c = await capacidadesIris(db.connection(), { empresas: [1], contratoIris: '0.14.3' })
        assert.deepInclude(c.aprovisionamiento, { empresa_id: 1, ftth: true, wireless: true, tr069: false })
        const marcas = c.equipos.find((e) => e.empresa_id === 1)!
        assert.isFalse(marcas.wifi)
        assert.isTrue(marcas.estado_equipo)

        const iris = await tokenIris()
        const conWifi = await estado(
            pedirOnt(client, iris, servicioId, serie, { wifi: { ssid: 'Casa', clave: 'ClaveWifi!123' } }),
            422,
        )
        assert.equal(conWifi.body().type, 'urn:argosisp:problema:wifi_no_disponible')
        const r = await estado(pedirOnt(client, iris, servicioId, serie), 202)
        assert.equal(await procesarAprovisionamiento(r.body().aprovisionamiento_id), 'listo')
        assert.lengthOf(await db.from('audit.red').where({ tipo: 'genieacs', servicio_id: servicioId }), 0)
        void planId
    })

    test('2 y 3: dos instancias con la OLT 1 cada una; probar una no llama a la otra; un token malo no tumba a la otra', async ({
        assert,
    }) => {
        cuenta(a, nuevaCuenta([{ id: '1', name: 'Norte' }], TOKEN_A))
        cuenta(b, nuevaCuenta([{ id: '1', name: 'Sur' }], TOKEN_B))
        const idA = await instancia(a, TOKEN_A, { nombre: 'Zona norte' })
        assert.lengthOf(b.peticiones, 0)
        const idB = await instancia(b, 'token-equivocado-999', { nombre: 'Zona sur' })
        assert.lengthOf(a.de('/api/system/get_olts'), 1)

        const olts = await db.from('integraciones.smartolt_olts').orderBy('instancia_id')
        assert.deepEqual(
            olts.map((o) => [Number(o.instancia_id), o.smartolt_olt_id, o.nombre]),
            [[idA, '1', 'Norte']],
        )
        const filaA = await db.from('integraciones.smartolt_instancias').where('id', idA).firstOrFail()
        const filaB = await db.from('integraciones.smartolt_instancias').where('id', idB).firstOrFail()
        assert.isTrue(filaA.prueba_ok)
        assert.isFalse(filaB.prueba_ok)
        assert.include(filaB.prueba_error, 'Invalid API Key')

        // con el token bueno, B también trae su OLT 1 sin chocar con la de A
        const editada = await new EditarInstanciaSmartOlt().execute(
            { id: idB, version: filaB.version, token: TOKEN_B },
            ctxGlobal(),
        )
        assert.isNull(editada.prueba_ok)
        const prueba = await new ProbarInstanciaSmartOlt().execute({ id: idB }, ctxGlobal())
        assert.isTrue(prueba.ok)
        assert.deepEqual(
            prueba.instancia.olts.map((o) => [o.smartolt_olt_id, o.nombre, o.hardware, o.ip]),
            [['1', 'Sur', 'Huawei-MA5800', '10.0.0.1']],
        )
        assert.lengthOf(await db.from('integraciones.smartolt_olts').where('smartolt_olt_id', '1'), 2)
        const otraVezA = await db.from('integraciones.smartolt_instancias').where('id', idA).firstOrFail()
        assert.isTrue(otraVezA.prueba_ok)
    })

    test('4 y 6: la OLT del servicio ligada a la OLT de B → se autoriza en B con el perfil de B; el mismo olt_id en A tiene otro preset', async ({
        client,
        assert,
    }) => {
        const s = await servicioPendiente()
        const serie = serieUnica()
        const ca = nuevaCuenta([{ id: '1', name: 'Norte' }], TOKEN_A)
        const cb = nuevaCuenta([{ id: '1', name: 'Sur' }], TOKEN_B)
        ca.sinAutorizar.set(serie, '1')
        cb.sinAutorizar.set(serie, '1')
        cuenta(a, ca)
        cuenta(b, cb)
        await instancia(a, TOKEN_A, {
            perfiles: [{ smartolt_olt_id: '1', plan_id: s.planId, authorization_preset_id: 31 }],
        })
        const idB = await instancia(b, TOKEN_B, {
            perfiles: [{ smartolt_olt_id: '1', plan_id: s.planId, authorization_preset_id: 77 }],
        })
        const oltSur = await oltDeArgos(unico('OLT Sur'))
        const refB = await db.from('integraciones.smartolt_olts').where('instancia_id', idB).firstOrFail()
        await db.from('integraciones.smartolt_olts').where('id', refB.id).update({ olt_id: oltSur })
        await servicioEnOlt(s.servicioId, s.routerId, oltSur)
        a.peticiones.length = 0
        b.peticiones.length = 0

        const iris = await tokenIris()
        const r = await estado(pedirOnt(client, iris, s.servicioId, serie), 202)
        assert.equal(await procesarAprovisionamiento(r.body().aprovisionamiento_id), 'listo')
        assert.lengthOf(a.peticiones, 0)
        const autorizar = b.de('/api/onu/authorize_onu')
        assert.lengthOf(autorizar, 1)
        assert.equal(autorizar[0]!.form.get('authorization_preset_id'), '77')
        const equipo = await db
            .from('integraciones.equipos_servicio')
            .where('servicio_id', s.servicioId)
            .firstOrFail()
        assert.equal(Number(equipo.smartolt_instancia_id), idB)

        // 8: el estado se lee en B, no en A
        const ver = await estado(
            client
                .get(`/api/v1/servicios/${s.servicioId}/equipo`)
                .bearerToken(iris)
                .header('X-Iris-Actor', 'usuario:57'),
            200,
        )
        assert.equal(ver.body().fuente, 'smartolt')
        assert.lengthOf(a.peticiones, 0)
        assert.isAbove(b.de('/api/onu/get_onu_status/').length, 0)

        // 6: otro servicio sin OLT en Argos con la serie solo en A → preset 31 de A
        const s2 = await servicioPendiente({ router_id: s.routerId, plan_id: s.planId })
        const serie2 = serieUnica()
        ca.sinAutorizar.set(serie2, '1')
        const r2 = await estado(pedirOnt(client, iris, s2.servicioId, serie2), 202)
        assert.equal(await procesarAprovisionamiento(r2.body().aprovisionamiento_id), 'listo')
        assert.equal(a.de('/api/onu/authorize_onu')[0]!.form.get('authorization_preset_id'), '31')
    })

    test('5: sin OLT en Argos → la instancia que tiene la serie; en las dos → fallido con causa otro', async ({
        client,
        assert,
    }) => {
        const ca = nuevaCuenta([{ id: '1', name: 'Norte' }], TOKEN_A)
        const cb = nuevaCuenta([{ id: '2', name: 'Sur' }], TOKEN_B)
        cuenta(a, ca)
        cuenta(b, cb)
        const idA = await instancia(a, TOKEN_A, {
            perfiles: [{ smartolt_olt_id: '1', authorization_preset_id: 31 }],
        })
        await instancia(b, TOKEN_B, { perfiles: [{ smartolt_olt_id: '2', authorization_preset_id: 77 }] })
        const iris = await tokenIris()

        const s = await servicioPendiente()
        const serie = serieUnica()
        ca.sinAutorizar.set(serie, '1')
        const r = await estado(pedirOnt(client, iris, s.servicioId, serie), 202)
        assert.equal(await procesarAprovisionamiento(r.body().aprovisionamiento_id), 'listo')
        assert.lengthOf(b.de('/api/onu/authorize_onu'), 0)
        const pedido = await db
            .from('integraciones.aprovisionamientos')
            .where('id', r.body().aprovisionamiento_id)
            .firstOrFail()
        assert.equal(Number(pedido.smartolt_instancia_id), idA)

        const s2 = await servicioPendiente()
        const doble = serieUnica()
        ca.sinAutorizar.set(doble, '1')
        cb.sinAutorizar.set(doble, '2')
        const r2 = await estado(pedirOnt(client, iris, s2.servicioId, doble), 202)
        assert.equal(await procesarAprovisionamiento(r2.body().aprovisionamiento_id), 'fallido')
        const fallido = await db
            .from('integraciones.aprovisionamientos')
            .where('id', r2.body().aprovisionamiento_id)
            .firstOrFail()
        assert.equal(fallido.causa, 'otro')
        assert.include(fallido.detalle, 'más de una instancia')
    })

    test('7: OLT ligada a una instancia apagada → 422 aprovisionamiento_no_disponible al aceptar', async ({
        client,
        assert,
    }) => {
        cuenta(a, nuevaCuenta([{ id: '1', name: 'Norte' }], TOKEN_A))
        cuenta(b, nuevaCuenta([{ id: '1', name: 'Sur' }], TOKEN_B))
        await instancia(a, TOKEN_A)
        const idB = await instancia(b, TOKEN_B)
        const filaB = await db.from('integraciones.smartolt_instancias').where('id', idB).firstOrFail()
        await new EditarInstanciaSmartOlt().execute(
            { id: idB, version: filaB.version, activo: false },
            ctxGlobal(),
        )
        const s = await servicioPendiente()
        const oltSur = await oltDeArgos(unico('OLT Sur'))
        await db.from('integraciones.smartolt_olts').where('instancia_id', idB).update({ olt_id: oltSur })
        await servicioEnOlt(s.servicioId, s.routerId, oltSur)
        const iris = await tokenIris()
        const r = await estado(pedirOnt(client, iris, s.servicioId, serieUnica()), 422)
        assert.equal(r.body().type, 'urn:argosisp:problema:aprovisionamiento_no_disponible')
        assert.include(r.body().detail, 'apagada o sin probar')
    })

    test('9: ligar OLT: ya ligada 409, de otra empresa 422, null desliga; sincronizar liga sola la del mismo nombre', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresas()
        const nombre = unico('OLT Centro')
        const oltArgos = await oltDeArgos(nombre)
        const oltOtra = await oltDeArgos(unico('OLT B'), e.B)
        cuenta(
            a,
            nuevaCuenta(
                [
                    { id: '1', name: nombre },
                    { id: '2', name: 'Otra' },
                ],
                TOKEN_A,
            ),
        )
        const idA = await instancia(a, TOKEN_A)
        const olts = await db
            .from('integraciones.smartolt_olts')
            .where('instancia_id', idA)
            .orderBy('smartolt_olt_id')
        assert.equal(Number(olts[0].olt_id), oltArgos, 'se ligó sola por el nombre')
        assert.isNull(olts[1].olt_id)
        const accion = await db
            .from('audit.acciones')
            .where({ accion: 'smartolt.probar_instancia', entidad_id: idA })
            .orderBy('id', 'desc')
            .firstOrFail()
        assert.include(JSON.stringify(accion), 'vinculadas_por_nombre')

        const { token } = await usuarioConRoles(['admin'])
        const vincular = (id: number, oltId: number | null) =>
            client
                .post(`/api/v1/integraciones/smartolt/olts/${id}/vincular`)
                .bearerToken(token)
                .header('X-Empresa-Id', '1')
                .json({ olt_id: oltId })
        const ya = await estado(vincular(Number(olts[1].id), oltArgos), 409)
        assert.equal(ya.body().type, 'urn:argosisp:problema:olt_ya_vinculada')
        const otra = await estado(vincular(Number(olts[1].id), oltOtra), 422)
        assert.equal(otra.body().type, 'urn:argosisp:problema:olt_de_otra_empresa')
        const suelta = await estado(vincular(Number(olts[0].id), null), 200)
        assert.isNull(suelta.body().olt)
        const ligada = await estado(vincular(Number(olts[1].id), oltArgos), 200)
        assert.deepEqual(ligada.body().olt, { id: oltArgos, nombre })
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'equipos.config_cambiada')
            .whereRaw(`payload ->> 'accion' = 'olt_vinculada'`)
            .orderBy('id', 'desc')
            .firstOrFail()
        assert.equal(evento.payload.instancia_id, idA)
    })

    test('10: eliminar con un equipo gestionado 409 instancia_en_uso; sin uso 204 y se van sus OLT y perfiles', async ({
        client,
        assert,
    }) => {
        cuenta(a, nuevaCuenta([{ id: '1', name: 'Norte' }], TOKEN_A))
        const idA = await instancia(a, TOKEN_A, {
            perfiles: [{ smartolt_olt_id: '1', authorization_preset_id: 31 }],
        })
        const s = await servicioPendiente()
        await db.table('integraciones.equipos_servicio').insert({
            servicio_id: s.servicioId,
            empresa_id: 1,
            tipo: 'ont',
            serie: serieUnica(),
            smartolt_external_id: `argos${s.servicioId}`,
            smartolt_instancia_id: idA,
        })
        const { token } = await usuarioConRoles(['admin'])
        const borrar = () =>
            client
                .delete(`/api/v1/integraciones/smartolt/instancias/${idA}`)
                .bearerToken(token)
                .header('X-Empresa-Id', '1')
        const enUso = await estado(borrar(), 409)
        assert.equal(enUso.body().type, 'urn:argosisp:problema:instancia_en_uso')
        await db.from('integraciones.equipos_servicio').where('servicio_id', s.servicioId).delete()
        await estado(borrar(), 204)
        assert.lengthOf(await db.from('integraciones.smartolt_olts').where('instancia_id', idA), 0)
        assert.lengthOf(await db.from('integraciones.equipos_perfiles'), 0)
    })

    test('11: compartida: solo con alcance global; la ven las dos empresas y las dos tienen ftth', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresas()
        cuenta(a, nuevaCuenta([{ id: '1', name: 'Norte' }], TOKEN_A))
        const { token: deUna } = await usuarioEnEmpresas(['admin'], [1])
        const cuerpo = { nombre: 'Compartida', url: a.url, token: TOKEN_A, compartida: true, activo: true }
        const negada = await estado(
            client
                .post('/api/v1/integraciones/smartolt/instancias')
                .bearerToken(deUna)
                .header('X-Empresa-Id', '1')
                .json(cuerpo),
            403,
        )
        assert.equal(negada.body().type, 'urn:argosisp:problema:empresa_no_permitida')

        const { token: global } = await usuarioConRoles(['admin'])
        const creada = await estado(
            client
                .post('/api/v1/integraciones/smartolt/instancias')
                .bearerToken(global)
                .header('X-Empresa-Id', '1')
                .json(cuerpo),
            201,
        )
        assert.isNull(creada.body().empresa_id)
        assert.isTrue(creada.body().compartida)
        await estado(
            client
                .post(`/api/v1/integraciones/smartolt/instancias/${creada.body().id}/probar`)
                .bearerToken(global)
                .header('X-Empresa-Id', '1'),
            200,
        )
        for (const empresa of [1, e.B]) {
            const lista = await estado(
                client
                    .get('/api/v1/integraciones/smartolt/instancias')
                    .bearerToken(global)
                    .header('X-Empresa-Id', String(empresa)),
                200,
            )
            assert.deepEqual(
                lista.body().data.map((i: { id: number }) => i.id),
                [creada.body().id],
            )
        }
        // la de una empresa la ve pero no la edita
        const ver = await estado(
            client
                .get(`/api/v1/integraciones/smartolt/instancias/${creada.body().id}`)
                .bearerToken(deUna)
                .header('X-Empresa-Id', '1'),
            200,
        )
        assert.isTrue(ver.body().compartida)
        await estado(
            client
                .put(`/api/v1/integraciones/smartolt/instancias/${creada.body().id}`)
                .bearerToken(deUna)
                .header('X-Empresa-Id', '1')
                .json({ version: ver.body().version, nombre: 'Otra' }),
            403,
        )
        const c = await capacidadesIris(db.connection(), { empresas: [1, e.B], contratoIris: '0.14.3' })
        assert.isTrue(c.aprovisionamiento.find((f) => f.empresa_id === 1)!.ftth)
        assert.isTrue(c.aprovisionamiento.find((f) => f.empresa_id === e.B)!.ftth)
    })

    test('12: el mismo subdominio dos veces 409; el token nunca sale en respuestas ni auditoría', async ({
        client,
        assert,
    }) => {
        cuenta(a, nuevaCuenta([{ id: '1', name: 'Norte' }], TOKEN_A))
        const { token } = await usuarioConRoles(['admin'])
        const crear = (nombre: string) =>
            client
                .post('/api/v1/integraciones/smartolt/instancias')
                .bearerToken(token)
                .header('X-Empresa-Id', '1')
                .json({ nombre, url: `${a.url}/api`, token: TOKEN_A, nota: 'Cuenta principal' })
        const primera = await estado(crear('Principal'), 201)
        assert.equal(primera.body().token, '***')
        assert.equal(primera.body().nota, 'Cuenta principal')
        assert.equal(primera.body().url, a.url)
        const repetida = await estado(crear('Otra'), 409)
        assert.equal(repetida.body().type, 'urn:argosisp:problema:subdominio_duplicado')
        const prueba = await estado(
            client
                .post(`/api/v1/integraciones/smartolt/instancias/${primera.body().id}/probar`)
                .bearerToken(token)
                .header('X-Empresa-Id', '1'),
            200,
        )
        assert.isTrue(prueba.body().ok)
        const textos = [
            JSON.stringify(primera.body()),
            JSON.stringify(prueba.body()),
            JSON.stringify(await db.from('audit.acciones').whereLike('accion', 'smartolt.%')),
            JSON.stringify(await db.from('audit.cambios').where('entidad_tipo', 'instancia_smartolt')),
            JSON.stringify(
                await db.from('audit.red').where('tipo', 'smartolt').orderBy('id', 'desc').limit(20),
            ),
            JSON.stringify(await db.from('audit.outbox').where('evento', 'equipos.config_cambiada')),
        ]
        for (const t of textos) assert.notInclude(t, TOKEN_A)
    })

    test('ficha del servicio: cuenta, OLT y perfil que usa; sin OLT ligada, en qué cuentas se busca; sin llamar a SmartOLT', async ({
        client,
        assert,
    }) => {
        cuenta(a, nuevaCuenta([{ id: '1', name: 'Norte' }], TOKEN_A))
        cuenta(b, nuevaCuenta([{ id: '1', name: 'Sur' }], TOKEN_B))
        const s = await servicioPendiente()
        await instancia(a, TOKEN_A, { nombre: 'Zona norte' })
        const idB = await instancia(b, TOKEN_B, {
            nombre: 'Zona sur',
            perfiles: [{ smartolt_olt_id: '1', plan_id: s.planId, authorization_preset_id: 77 }],
        })
        const { token } = await usuarioConRoles(['soporte'])
        const ver = () =>
            client
                .get(`/api/v1/servicios/${s.servicioId}/equipo/gestion`)
                .bearerToken(token)
                .header('X-Empresa-Id', '1')
        a.peticiones.length = 0
        b.peticiones.length = 0
        const sinOlt = await estado(ver(), 200)
        assert.equal(sinOlt.body().smartolt.origen, 'sin_buscar')
        assert.sameMembers(
            sinOlt.body().smartolt.cuentas.map((c: { nombre: string }) => c.nombre),
            ['Zona norte', 'Zona sur'],
        )
        assert.isNull(sinOlt.body().smartolt.instancia)
        assert.deepEqual(sinOlt.body().acs, {
            configurado: false,
            activo: false,
            operativo: false,
            pppoe_por_acs: false,
        })

        const oltSur = await oltDeArgos(unico('OLT Sur'))
        await db.from('integraciones.smartolt_olts').where('instancia_id', idB).update({ olt_id: oltSur })
        await servicioEnOlt(s.servicioId, s.routerId, oltSur)
        const conOlt = await estado(ver(), 200)
        assert.equal(conOlt.body().smartolt.origen, 'olt')
        assert.equal(conOlt.body().smartolt.instancia.id, idB)
        assert.equal(conOlt.body().smartolt.olt_smartolt.smartolt_olt_id, '1')
        assert.equal(conOlt.body().smartolt.puerto_pon, '0/1/3')
        assert.deepEqual(conOlt.body().smartolt.perfil, { authorization_preset_id: 77, pon_type: 'gpon' })
        assert.notInclude(JSON.stringify(conOlt.body()), TOKEN_B)
        assert.lengthOf(a.peticiones, 0)
        assert.lengthOf(b.peticiones, 0)

        // con el token de Iris: no
        const iris = await tokenIris()
        await estado(
            client
                .get(`/api/v1/servicios/${s.servicioId}/equipo/gestion`)
                .bearerToken(iris)
                .header('X-Iris-Actor', 'usuario:57'),
            403,
        )
    })

    test('alta con otra empresa dueña; editar la nota; la última prueba dice cuánto tardó y quién', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresas()
        cuenta(a, nuevaCuenta([{ id: '1', name: 'Norte' }], TOKEN_A))
        const { token, usuario } = await usuarioConRoles(['admin'])
        const creada = await estado(
            client
                .post('/api/v1/integraciones/smartolt/instancias')
                .bearerToken(token)
                .header('X-Empresa-Id', '1')
                .json({ nombre: 'De B', url: a.url, token: TOKEN_A, empresa_id: e.B }),
            201,
        )
        assert.equal(creada.body().empresa_id, e.B)
        // desde la empresa 1 no se ve
        await estado(
            client
                .get(`/api/v1/integraciones/smartolt/instancias/${creada.body().id}`)
                .bearerToken(token)
                .header('X-Empresa-Id', '1'),
            404,
        )
        const conB = (r: any) => r.bearerToken(token).header('X-Empresa-Id', String(e.B))
        const prueba = await estado(
            conB(client.post(`/api/v1/integraciones/smartolt/instancias/${creada.body().id}/probar`)),
            200,
        )
        assert.isNumber(prueba.body().instancia.prueba_latencia_ms)
        assert.equal(prueba.body().instancia.probado_por, usuario.nombre)
        const nota = await estado(
            conB(
                client
                    .put(`/api/v1/integraciones/smartolt/instancias/${creada.body().id}`)
                    .json({ version: prueba.body().instancia.version, nota: 'La renueva Luis' }),
            ),
            200,
        )
        assert.equal(nota.body().nota, 'La renueva Luis')
        assert.isTrue(nota.body().prueba_ok, 'cambiar la nota no borra la prueba')
    })
})
