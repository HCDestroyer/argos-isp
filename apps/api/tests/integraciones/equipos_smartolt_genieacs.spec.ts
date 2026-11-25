import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearServicioFila } from '#tests/core/fabricas'
import GenerarTokenIris from '#core/actions/generar_token_iris'
import { usuarioIris } from '#core/integraciones_iris'
import CrearInstanciaSmartOlt from '#integraciones/equipos/actions/crear_instancia_smartolt'
import EditarInstanciaSmartOlt from '#integraciones/equipos/actions/editar_instancia_smartolt'
import ProbarInstanciaSmartOlt from '#integraciones/equipos/actions/probar_instancia_smartolt'
import ConfigurarAcs from '#integraciones/equipos/actions/configurar_acs'
import ProbarAcs from '#integraciones/equipos/actions/probar_acs'
import { vistaAcs } from '#integraciones/equipos/acs'
import {
    procesarAprovisionamiento,
    procesarPendientesEquipos,
    procesarWifi,
} from '#integraciones/equipos/cola'
import { fijarEsperaReintentos } from '#integraciones/equipos/http'
import { payloadParaIris } from '#integraciones/iris/envios'
import { avisoAlTitular } from '#notify/contactos'
import {
    Simulado,
    borrarEquiposDe,
    dispositivoTr098,
    limpiarEquipos,
    onuSinConfigurar,
} from '#tests/integraciones/equipos_simulado'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import { unicoBdMayusculas } from '#tests/billing/ayudas_billing'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { bodegaEn, productoEn } from '#tests/inventario/ayudas_inventario'
import CargarSaldoInicial from '#inventario/actions/cargar_saldo_inicial'

/**
 * Equipos del cliente con SmartOLT y GenieACS (contrato Iris 0.9.0 §12: A32, A33, A35) contra
 * servidores HTTP locales que imitan las respuestas documentadas. Nada sale a internet.
 */

const TOKEN_SO = 'token-smartolt-secreto-123'
const CLAVE_ACS = 'clave-acs-secreta-456'
const CLAVE_WIFI = 'ClaveWifiSecreta!9'

const ctxEmpresa = (empresaId = 1) => ({ ...contextoPrueba(), empresaId, empresasPermitidas: null })

async function tokenIris() {
    const { token } = await new GenerarTokenIris().execute({ nombre: unico('Iris') }, contextoPrueba())
    const id = (await usuarioIris())!
    await db.from('core.usuarios').where('id', id).update({ activo: true, alcance_global: true })
    await db.from('core.usuarios_empresas').where('usuario_id', id).delete()
    return token
}

async function servicioPendiente() {
    const clienteId = await crearClienteFila()
    const servicioId = await crearServicioFila({ cliente_id: clienteId, empresa_id: 1 })
    await db
        .from('core.servicios')
        .where('id', servicioId)
        .update({ estado: 'pendiente_instalacion', instalado_en: null })
    const { plan_id: planId } = (await db.from('core.servicios').where('id', servicioId).first()) as {
        plan_id: number
    }
    return { clienteId, servicioId, planId: Number(planId) }
}

/** Una instancia de SmartOLT (con sus perfiles) y el ACS de la empresa, guardados y probados por sus acciones. */
async function configurar(
    so: Simulado,
    acs: Simulado,
    perfiles: Array<Record<string, unknown>> = [],
    empresaId = 1,
) {
    const ctx = ctxEmpresa(empresaId)
    const inst = await new CrearInstanciaSmartOlt().execute(
        { nombre: 'SmartOLT', url: so.url, token: TOKEN_SO, activo: true },
        ctx,
    )
    if (perfiles.length > 0) {
        await new EditarInstanciaSmartOlt().execute(
            { id: inst.id, version: inst.version, perfiles: perfiles as never },
            ctx,
        )
    }
    await new ProbarInstanciaSmartOlt().execute({ id: inst.id }, ctx)
    const { version } = await vistaAcs(empresaId)
    await new ConfigurarAcs().execute(
        { version, activo: true, url: acs.url, usuario: 'argos', clave: CLAVE_ACS },
        ctx,
    )
    return new ProbarAcs().execute({}, ctx)
}

/** SmartOLT con una ONT por autorizar y GenieACS con su dispositivo TR-098. */
function escenarioFeliz(so: Simulado, acs: Simulado, serie: string) {
    let autorizada = false
    so.responder('GET /api/system/get_olts', () => ({
        status: 200,
        cuerpo: {
            status: true,
            response: [{ id: '1', name: 'OLT-Centro', olt_hardware_version: 'Huawei-MA5680T' }],
        },
    }))
        .responder('GET /api/onu/get_onus_details_by_sn/*', () => ({
            status: 200,
            cuerpo: { status: true, onus: autorizada ? [{ unique_external_id: 'x', sn: serie }] : [] },
        }))
        .responder('GET /api/onu/unconfigured_onus', () => ({
            status: 200,
            cuerpo: { status: true, response: autorizada ? [] : [onuSinConfigurar(serie)] },
        }))
        .responder('POST /api/onu/authorize_onu', () => {
            autorizada = true
            return { status: 200, cuerpo: { status: true, response: 'ONU configuration saved' } }
        })
        .responder('GET /api/onu/get_onu_signal/*', () => ({
            status: 200,
            cuerpo: {
                status: true,
                onu_signal: 'Very good',
                onu_signal_value: '-19.80 dBm / -21.10 dBm ',
                onu_signal_1310: '-21.10 dBm',
                onu_signal_1490: '-19.80 dBm',
            },
        }))
        .responder('GET /api/onu/get_onu_status/*', () => ({
            status: 200,
            cuerpo: { status: true, onu_status: 'Online', last_status_change: '2026-11-21 15:00:00' },
        }))
    acs.responder('GET /devices/', (p) => {
        const q = JSON.parse(p.consulta.get('query') ?? '{}')
        if (q._id === '00259E-F670L-' + serie || q['_deviceId._SerialNumber'] === serie) {
            return { status: 200, cuerpo: [dispositivoTr098('00259E-F670L-' + serie, serie)] }
        }
        if (Object.keys(q).length === 0) return { status: 200, cuerpo: [{ _id: 'cualquiera' }] }
        return { status: 200, cuerpo: [] }
    }).responder('POST /devices/*', (p) => ({ status: 200, cuerpo: { ...p.json, _id: 'tarea1' } }))
}

const cuerpoOnt = (serie: string, wifi = true) => ({
    equipo: { tipo: 'ont', serie, mac: null, unidad_id: null, modelo: 'F670L' },
    planta: { olt: 'OLT-Centro', slot: 1, pon: 7, caja: 'CJ-118', puerto: 4 },
    wifi: wifi ? { ssid: 'Familia Pérez', clave: CLAVE_WIFI } : null,
    tecnico: null,
    origen_tipo: 'iris_orden',
    origen_id: '9123',
})

test.group('Equipos · SmartOLT y GenieACS (A32, A33, A35)', (group) => {
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
        await limpiarEquipos()
        await db.from('integraciones.iris_conector').delete()
    })

    test('configurar y probar: secretos cifrados y como ***; capacidad solo probada', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        so.responder('GET /api/system/get_olts', (p) =>
            p.cabeceras['x-token'] === TOKEN_SO
                ? { status: 200, cuerpo: { status: true, response: [{ id: '7', name: 'OLT-Norte' }] } }
                : { status: 403, cuerpo: { status: false, error: 'Invalid API Key.' } },
        )
        acs.responder('GET /devices/', (p) =>
            p.cabeceras.authorization === `Basic ${Buffer.from(`argos:${CLAVE_ACS}`).toString('base64')}`
                ? { status: 200, cuerpo: [] }
                : { status: 401, cuerpo: 'Unauthorized' },
        )
        const conToken = <T extends { header: (k: string, v: string) => T; bearerToken: (t: string) => T }>(
            r: T,
        ) => r.bearerToken(token).header('X-Empresa-Id', '1')
        const creada = await estado(
            conToken(
                client.post('/api/v1/integraciones/smartolt/instancias').json({
                    nombre: 'Principal',
                    url: `${so.url}/api`,
                    token: TOKEN_SO,
                    activo: true,
                }),
            ),
            201,
        )
        const id = creada.body().id as number
        const putSo = (cuerpo: Record<string, unknown>) =>
            conToken(client.put(`/api/v1/integraciones/smartolt/instancias/${id}`).json(cuerpo))
        const conPerfil = await estado(
            putSo({
                version: creada.body().version,
                perfiles: [{ smartolt_olt_id: '7', plan_id: null, authorization_preset_id: 31 }],
            }),
            200,
        )
        assert.equal(conPerfil.body().url, so.url)
        assert.equal(conPerfil.body().token, '***')
        assert.isFalse(conPerfil.body().operativa)
        const acsGuardado = await estado(
            conToken(
                client
                    .put('/api/v1/integraciones/acs')
                    .json({ version: 0, activo: true, url: acs.url, usuario: 'argos', clave: CLAVE_ACS }),
            ),
            200,
        )
        assert.equal(acsGuardado.body().clave, '***')
        const instancia = await db.from('integraciones.smartolt_instancias').where('empresa_id', 1).first()
        assert.notInclude(instancia.token_cifrado, TOKEN_SO)
        const filaAcs = await db.from('integraciones.acs_config').where('empresa_id', 1).first()
        assert.match(filaAcs.clave_cifrada, /^v1\./)

        const prueba = await estado(
            conToken(client.post(`/api/v1/integraciones/smartolt/instancias/${id}/probar`)),
            200,
        )
        assert.isTrue(prueba.body().ok)
        assert.deepEqual(
            prueba
                .body()
                .instancia.olts.map((o: { smartolt_olt_id: string; nombre: string }) => [
                    o.smartolt_olt_id,
                    o.nombre,
                ]),
            [['7', 'OLT-Norte']],
        )
        assert.isNumber(prueba.body().instancia.prueba_latencia_ms)
        assert.isString(prueba.body().instancia.probado_por)
        const pruebaAcs = await estado(conToken(client.post('/api/v1/integraciones/acs/probar')), 200)
        assert.isTrue(pruebaAcs.body().ok)

        // capacidades hacia Iris
        const iris = await tokenIris()
        const est = await estado(client.get('/api/v1/integraciones/iris/estado').bearerToken(iris), 200)
        assert.deepInclude(est.body().capacidades.aprovisionamiento, {
            empresa_id: 1,
            ftth: true,
            wireless: true,
            tr069: true,
        })

        // otro token: borra la prueba de SmartOLT; con token malo la prueba falla y no hay ftth
        const v = prueba.body().instancia.version as number
        const otro = await estado(putSo({ version: v, token: 'token-equivocado-999' }), 200)
        assert.isNull(otro.body().prueba_ok)
        assert.isNull(otro.body().prueba_latencia_ms)
        assert.isFalse(otro.body().operativa)
        const mala = await estado(
            conToken(client.post(`/api/v1/integraciones/smartolt/instancias/${id}/probar`)),
            200,
        )
        assert.isFalse(mala.body().ok)
        assert.include(mala.body().error, 'Invalid API Key')
        const despues = await estado(client.get('/api/v1/integraciones/iris/estado').bearerToken(iris), 200)
        assert.deepInclude(despues.body().capacidades.aprovisionamiento, {
            empresa_id: 1,
            ftth: false,
            wireless: true,
            tr069: true,
        })
        // versión vieja: 409
        await estado(putSo({ version: v, activo: false }), 409)

        // ningún secreto en la auditoría ni en audit.red
        const auditoria = JSON.stringify(
            await db
                .from('audit.acciones')
                .where((q) => q.whereLike('accion', 'smartolt.%').orWhereLike('accion', 'acs.%')),
        )
        const cambios = JSON.stringify(
            await db
                .from('audit.cambios')
                .whereIn('entidad_tipo', ['instancia_smartolt', 'configuracion_acs']),
        )
        const red = JSON.stringify(await db.from('audit.red').whereIn('tipo', ['smartolt', 'genieacs']))
        for (const texto of [auditoria, cambios, red]) {
            assert.notInclude(texto, TOKEN_SO)
            assert.notInclude(texto, CLAVE_ACS)
        }
        assert.include(red, '/api/system/get_olts')

        // sin permiso
        const { token: lectura } = await usuarioConRoles(['cajero'])
        await estado(
            client
                .post('/api/v1/integraciones/smartolt/instancias')
                .bearerToken(lectura)
                .header('X-Empresa-Id', '1')
                .json({ nombre: 'X', url: so.url, token: TOKEN_SO }),
            403,
        )
        await estado(
            client.get('/api/v1/integraciones/acs').bearerToken(lectura).header('X-Empresa-Id', '1'),
            403,
        )
    })

    test('A32: ONT por SmartOLT + Wi-Fi por GenieACS → listo, activo y sin la clave en ningún lado', async ({
        client,
        assert,
    }) => {
        const serie = `ZTEG${unico('')
            .replace(/[^0-9]/g, '')
            .slice(-8)
            .padStart(8, '0')}`
        escenarioFeliz(so, acs, serie)
        const { servicioId, planId } = await servicioPendiente()
        await configurar(so, acs, [{ smartolt_olt_id: '1', plan_id: planId, authorization_preset_id: 31 }])
        const iris = await tokenIris()
        const clave = `iris:aprovisionar:9123:${unico('i')}`
        const pedir = () =>
            client
                .post(`/api/v1/servicios/${servicioId}/aprovisionar`)
                .bearerToken(iris)
                .header('X-Iris-Actor', 'usuario:57')
                .header('Idempotency-Key', clave)
                .json(cuerpoOnt(serie))
        const r = await estado(pedir(), 202)
        assert.equal(r.body().estado, 'en_proceso')
        const id = r.body().aprovisionamiento_id
        // otro pedido con otra clave mientras está en curso: 409 con la extensión
        const enCurso = await estado(
            client
                .post(`/api/v1/servicios/${servicioId}/aprovisionar`)
                .bearerToken(iris)
                .header('X-Iris-Actor', 'usuario:57')
                .header('Idempotency-Key', `${clave}:otra`)
                .json(cuerpoOnt(serie)),
            409,
        )
        assert.equal(enCurso.body().type, 'urn:argosisp:problema:aprovisionamiento_en_curso')
        assert.equal(enCurso.body().extensions.aprovisionamiento_id, id)

        const guardada = await db.from('integraciones.aprovisionamientos').where('id', id).first()
        assert.match(guardada.wifi_clave_cifrada, /^v1\./)

        assert.equal(await procesarAprovisionamiento(id), 'listo')

        const autorizar = so.de('/api/onu/authorize_onu')[0]!
        assert.equal(autorizar.form.get('sn'), serie)
        assert.equal(autorizar.form.get('olt_id'), '1')
        assert.equal(autorizar.form.get('board'), '2')
        assert.equal(autorizar.form.get('port'), '3')
        assert.equal(autorizar.form.get('authorization_preset_id'), '31')
        assert.equal(autorizar.form.get('onu_external_id'), `argos${servicioId}`)
        assert.equal(autorizar.cabeceras['x-token'], TOKEN_SO)
        const tarea = acs.de('/devices/')[acs.de('/devices/').length - 1]!
        assert.equal(tarea.metodo, 'POST')
        assert.isTrue(tarea.consulta.has('connection_request'))
        assert.deepEqual(tarea.json.parameterValues, [
            ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID', 'Familia Pérez', 'xsd:string'],
            ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase', CLAVE_WIFI, 'xsd:string'],
        ])

        const fila = await db.from('integraciones.aprovisionamientos').where('id', id).first()
        assert.equal(fila.estado, 'listo')
        assert.isNull(fila.wifi_clave_cifrada)
        assert.isNull(fila.wifi_ssid_cifrado)
        const servicio = await db.from('core.servicios').where('id', servicioId).first()
        assert.equal(servicio.estado, 'activo')

        const ver = await estado(client.get(`/api/v1/aprovisionamientos/${id}`).bearerToken(iris), 200)
        assert.equal(ver.body().estado, 'listo')
        assert.equal(ver.body().servicio_estado, 'activo')
        assert.deepEqual(
            ver.body().pasos.map((p: { paso: string; estado: string }) => `${p.paso}:${p.estado}`),
            ['ip:hecho', 'equipo:hecho', 'wifi:hecho', 'activacion:hecho'],
        )
        assert.deepEqual(ver.body().senal, { rx_dbm: -19.8, tx_dbm: -21.1 })

        // la misma clave otra vez: 200 con el estado final
        const repetida = await estado(pedir(), 200)
        assert.equal(repetida.body().estado, 'listo')

        const evento = await db
            .from('audit.outbox')
            .where('evento', 'instalacion.aprovisionada')
            .whereRaw(`(payload->>'aprovisionamiento_id')::int = ?`, [id])
            .firstOrFail()
        assert.equal(evento.payload.servicio_estado, 'activo')
        assert.equal(evento.payload.idempotency_key, clave)
        const webhook = await payloadParaIris('instalacion.aprovisionada', evento.payload)
        assert.equal(webhook!.payload.origen_id, '9123')
        assert.deepEqual(webhook!.payload.equipo, { tipo: 'ont', serie, mac: null, unidad_id: null })

        // la clave Wi-Fi no está en auditoría, eventos ni audit.red
        const todo = JSON.stringify([
            await db.from('audit.acciones').where('entidad_tipo', 'servicio').where('entidad_id', servicioId),
            await db
                .from('audit.acciones')
                .where('entidad_tipo', 'aprovisionamiento')
                .where('entidad_id', id),
            await db.from('audit.outbox').whereRaw(`(payload->>'servicio_id')::int = ?`, [servicioId]),
            await db.from('audit.red').where('servicio_id', servicioId),
        ])
        assert.notInclude(todo, CLAVE_WIFI)
        assert.notInclude(todo, TOKEN_SO)
        assert.include(todo, 'authorize_onu')

        // A33: estado del equipo, completo para una persona y reducido para el asistente
        const equipo = await estado(
            client
                .get(`/api/v1/servicios/${servicioId}/equipo`)
                .bearerToken(iris)
                .header('X-Iris-Actor', 'usuario:57'),
            200,
        )
        assert.equal(equipo.body().tecnologia, 'ftth')
        assert.equal(equipo.body().fuente, 'smartolt')
        assert.isTrue(equipo.body().en_linea)
        assert.deepEqual(equipo.body().senal, { rx_dbm: -19.8, tx_dbm: -21.1 })
        assert.equal(equipo.body().serie, serie)
        assert.equal(equipo.body().firmware, 'V9.0.10P2N3')
        assert.equal(equipo.body().ssid, 'Casa')
        const antes = so.peticiones.length
        const ia = await estado(
            client
                .get(`/api/v1/servicios/${servicioId}/equipo`)
                .bearerToken(iris)
                .header('X-Iris-Actor', 'asistente_ia'),
            200,
        )
        assert.equal(so.peticiones.length, antes, 'responde la lectura de menos de 60 s')
        assert.sameMembers(Object.keys(ia.body()), [
            'servicio_id',
            'tecnologia',
            'en_linea',
            'senal',
            'ultimo_contacto',
            'leido_en',
        ])
    })

    test('A32: perfil sin mapear termina en el acto; equipo no encontrado se reintenta y luego falla', async ({
        client,
        assert,
    }) => {
        const serie = 'HWTC0000AAAA'
        escenarioFeliz(so, acs, serie)
        const iris = await tokenIris()
        await configurar(so, acs, []) // sin perfiles
        const a = await servicioPendiente()
        const r = await estado(
            client
                .post(`/api/v1/servicios/${a.servicioId}/aprovisionar`)
                .bearerToken(iris)
                .header('X-Iris-Actor', 'usuario:57')
                .header('Idempotency-Key', `iris:aprovisionar:1:${unico('k')}`)
                .json(cuerpoOnt(serie, false)),
            202,
        )
        assert.equal(await procesarAprovisionamiento(r.body().aprovisionamiento_id), 'fallido')
        const fila = await db
            .from('integraciones.aprovisionamientos')
            .where('id', r.body().aprovisionamiento_id)
            .first()
        assert.equal(fila.causa, 'perfil_sin_mapear')
        assert.isFalse(fila.reintentable)
        const fallida = await db
            .from('audit.outbox')
            .where('evento', 'instalacion.fallida')
            .whereRaw(`(payload->>'aprovisionamiento_id')::int = ?`, [fila.id])
            .firstOrFail()
        assert.equal(fallida.payload.causa, 'perfil_sin_mapear')
        const sigue = await db.from('core.servicios').where('id', a.servicioId).first()
        assert.equal(sigue.estado, 'pendiente_instalacion')
        assert.lengthOf(so.de('/api/onu/authorize_onu'), 0)

        // ONT que no aparece en la OLT: se reintenta (próximo intento) y al agotar queda reintentable
        so.responder('GET /api/onu/unconfigured_onus', () => ({
            status: 200,
            cuerpo: { status: true, response: [] },
        }))
        const b = await servicioPendiente()
        const r2 = await estado(
            client
                .post(`/api/v1/servicios/${b.servicioId}/aprovisionar`)
                .bearerToken(iris)
                .header('X-Iris-Actor', 'usuario:57')
                .header('Idempotency-Key', `iris:aprovisionar:2:${unico('k')}`)
                .json(cuerpoOnt(serie, false)),
            202,
        )
        const id = r2.body().aprovisionamiento_id
        assert.equal(await procesarAprovisionamiento(id), 'reintentar')
        const mientras = await estado(client.get(`/api/v1/aprovisionamientos/${id}`).bearerToken(iris), 200)
        assert.equal(mientras.body().estado, 'en_proceso')
        assert.isNull(mientras.body().causa)
        for (let i = 0; i < 6; i++) {
            await db
                .from('integraciones.aprovisionamientos')
                .where('id', id)
                .update({ proximo_intento_en: new Date(0) })
            await procesarPendientesEquipos()
        }
        const final = await db.from('integraciones.aprovisionamientos').where('id', id).first()
        assert.equal(final.estado, 'fallido')
        assert.equal(final.causa, 'equipo_no_encontrado')
        assert.isTrue(final.reintentable)
    })

    test('A32: sin la tecnología configurada 422; wifi sin ACS 422 wifi_no_disponible', async ({
        client,
        assert,
    }) => {
        const iris = await tokenIris()
        so.responder('GET /api/system/get_olts', () => ({
            status: 200,
            cuerpo: { status: true, response: [] },
        }))
        // solo SmartOLT
        const inst = await new CrearInstanciaSmartOlt().execute(
            { nombre: 'SmartOLT', url: so.url, token: TOKEN_SO, activo: true },
            ctxEmpresa(),
        )
        await new ProbarInstanciaSmartOlt().execute({ id: inst.id }, ctxEmpresa())
        const { servicioId } = await servicioPendiente()
        const pedir = (cuerpo: Record<string, unknown>) =>
            client
                .post(`/api/v1/servicios/${servicioId}/aprovisionar`)
                .bearerToken(iris)
                .header('X-Iris-Actor', 'usuario:57')
                .header('Idempotency-Key', `iris:aprovisionar:3:${unico('k')}`)
                .json(cuerpo)
        const router = await estado(
            pedir({
                equipo: { tipo: 'router_tr069', mac: 'AA:BB:CC:11:22:33' },
                origen_tipo: 'iris_orden',
                origen_id: '1',
            }),
            422,
        )
        assert.equal(router.body().type, 'urn:argosisp:problema:aprovisionamiento_no_disponible')
        const wifi = await estado(pedir(cuerpoOnt('ZTEG00000001')), 422)
        assert.equal(wifi.body().type, 'urn:argosisp:problema:wifi_no_disponible')
        // un CPE sin ACS: solo IP y activación (equipo y wifi no aplican)
        const cpe = await estado(
            pedir({
                equipo: { tipo: 'cpe_wireless', mac: 'AA:BB:CC:11:22:44' },
                origen_tipo: 'iris_orden',
                origen_id: '2',
            }),
            202,
        )
        assert.equal(await procesarAprovisionamiento(cpe.body().aprovisionamiento_id), 'listo')
        const fila = await db
            .from('integraciones.aprovisionamientos')
            .where('id', cpe.body().aprovisionamiento_id)
            .first()
        assert.deepEqual(
            fila.pasos.map((p: { estado: string }) => p.estado),
            ['hecho', 'no_aplica', 'no_aplica', 'hecho'],
        )
    })

    test('A35: cambio de Wi-Fi por GenieACS, tope de 3 al día, aviso al titular y equipo sin respuesta', async ({
        client,
        assert,
    }) => {
        const serie = 'ZTEGC8A1B2C3'
        escenarioFeliz(so, acs, serie)
        await configurar(so, acs, [])
        const iris = await tokenIris()
        const { servicioId, clienteId } = await servicioPendiente()
        await db.from('core.servicios').where('id', servicioId).update({ estado: 'activo' })
        await db.table('integraciones.equipos_servicio').insert({
            servicio_id: servicioId,
            empresa_id: 1,
            tipo: 'router_tr069',
            serie,
            acs_device_id: `00259E-F670L-${serie}`,
        })
        const pedir = (cuerpo: Record<string, unknown> = {}) =>
            client
                .post(`/api/v1/servicios/${servicioId}/wifi`)
                .bearerToken(iris)
                .header('X-Iris-Actor', 'usuario:57')
                .header('Idempotency-Key', `iris:wifi:orden:1:${unico('u')}`)
                .json({
                    ssid: 'Nueva Red',
                    clave: CLAVE_WIFI,
                    origen_tipo: 'iris_orden',
                    origen_id: '9123',
                    verificacion: {
                        metodo: 'presencial',
                        verificado_en: new Date().toISOString(),
                        cliente_id: clienteId,
                    },
                    ...cuerpo,
                })
        const r = await estado(pedir(), 202)
        const id = r.body().solicitud_id
        assert.equal(await procesarWifi(id), 'aplicado')
        const tarea = acs.de('/devices/').find((p) => p.metodo === 'POST')!
        assert.deepEqual(tarea.json.parameterValues[0], [
            'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID',
            'Nueva Red',
            'xsd:string',
        ])
        const fila = await db.from('integraciones.wifi_solicitudes').where('id', id).first()
        assert.equal(fila.estado, 'aplicado')
        assert.isNull(fila.clave_cifrada)
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'equipo.wifi_resuelto')
            .whereRaw(`(payload->>'solicitud_id')::int = ?`, [id])
            .firstOrFail()
        assert.equal(evento.payload.estado, 'aplicado')
        const webhook = await payloadParaIris('equipo.wifi_resuelto', evento.payload)
        assert.notInclude(JSON.stringify(webhook), 'Nueva Red')
        assert.equal(webhook!.payload.causa, null)
        const aviso = await avisoAlTitular(db.connection(), 'equipo.wifi_resuelto', evento.payload)
        assert.equal(aviso!.evento, 'equipo.wifi_cambiado')
        const todo = JSON.stringify([
            await db.from('audit.acciones').where('entidad_tipo', 'servicio').where('entidad_id', servicioId),
            await db.from('audit.red').where('servicio_id', servicioId),
            evento,
        ])
        assert.notInclude(todo, CLAVE_WIFI)
        assert.include(todo, '"metodo":"presencial"')

        // el equipo no abre sesión: GenieACS deja la tarea en cola (202), Argos la borra y reintenta
        acs.responder('POST /devices/*', (p) => ({
            status: 202,
            statusText: 'Task queued but not processed',
            cuerpo: { ...p.json, _id: 'tarea-cola' },
        })).responder('DELETE /tasks/*', () => ({ status: 200 }))
        const r2 = await estado(pedir({ ssid: null }), 202)
        assert.equal(await procesarWifi(r2.body().solicitud_id), 'reintentar')
        for (let i = 0; i < 3; i++) {
            await db
                .from('integraciones.wifi_solicitudes')
                .where('id', r2.body().solicitud_id)
                .update({ proximo_intento_en: new Date(0) })
            await procesarPendientesEquipos()
        }
        const fallida = await db
            .from('integraciones.wifi_solicitudes')
            .where('id', r2.body().solicitud_id)
            .first()
        assert.equal(fallida.estado, 'fallido')
        assert.equal(fallida.causa, 'equipo_sin_respuesta')
        assert.isAtLeast(acs.de('/tasks/tarea-cola').length, 1)

        // tope: cuentan los aceptados que no fallaron (1 aplicado + 2 más = 3); el cuarto es 429
        await estado(pedir(), 202)
        await estado(pedir(), 202)
        const tope = await estado(pedir(), 429)
        assert.equal(tope.body().type, 'urn:argosisp:problema:demasiados_cambios_wifi')
        assert.isAbove(Number(tope.header('retry-after')), 0)
    })

    test('A32 con la ONT del inventario: comodato al activar; A33 y A35 descubren el equipo de un servicio viejo', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        try {
            const serie = await unicoBdMayusculas('zteg')
            escenarioFeliz(so, acs, serie)
            const producto = await productoEn(e.B, e.ctx, { tipo: 'equipo', seguimiento: 'serie' })
            const bodega = await bodegaEn(e.B, e.ctx)
            await new CargarSaldoInicial().execute(
                { producto_id: producto.id, bodega_id: bodega.id, unidad: { serie }, costo_total: '200.00' },
                e.ctx,
            )
            const { clienteId } = await servicioEn(e.B)
            const servicioId = await crearServicioFila({
                cliente_id: clienteId,
                empresa_id: e.B,
                estado: 'pendiente_instalacion',
                instalado_en: null,
            })
            const { plan_id: planId } = await db.from('core.servicios').where('id', servicioId).firstOrFail()
            await configurar(
                so,
                acs,
                [{ smartolt_olt_id: '1', plan_id: planId, authorization_preset_id: 31 }],
                e.B,
            )
            const iris = await tokenIris()
            const r = await estado(
                client
                    .post(`/api/v1/servicios/${servicioId}/aprovisionar`)
                    .bearerToken(iris)
                    .header('X-Iris-Actor', 'usuario:57')
                    .header('Idempotency-Key', `iris:aprovisionar:77:${unico('i')}`)
                    .json(cuerpoOnt(serie.toLowerCase(), false)),
                202,
            )
            assert.equal(await procesarAprovisionamiento(r.body().aprovisionamiento_id), 'listo')
            const unidad = await db
                .from('inventario.unidades')
                .where('empresa_id', e.B)
                .whereRaw('serie = ?', [serie])
                .firstOrFail()
            assert.equal(unidad.estado, 'en_comodato')
            assert.equal(Number(unidad.servicio_id), servicioId)
            const ver = await estado(
                client.get(`/api/v1/aprovisionamientos/${r.body().aprovisionamiento_id}`).bearerToken(iris),
                200,
            )
            assert.equal(ver.body().equipo.unidad_id, Number(unidad.id))

            // un servicio «viejo»: sin equipo gestionado guardado, se descubre por la serie del comodato
            await db.from('integraciones.equipos_servicio').where('servicio_id', servicioId).delete()
            so.responder('GET /api/onu/get_onus_details_by_sn/*', () => ({
                status: 200,
                cuerpo: {
                    status: true,
                    onus: [
                        { unique_external_id: `argos${servicioId}`, sn: serie, onu_type_name: 'ZTE-F670L' },
                    ],
                },
            }))
            const equipo = await estado(
                client
                    .get(`/api/v1/servicios/${servicioId}/equipo`)
                    .bearerToken(iris)
                    .header('X-Iris-Actor', 'usuario:57'),
                200,
            )
            assert.equal(equipo.body().fuente, 'smartolt')
            assert.equal(equipo.body().modelo, 'ZTE-F670L')
            // A35 descubre dentro de la transacción que bloquea el servicio (sin bloquearse a sí misma)
            await db.from('integraciones.equipos_servicio').where('servicio_id', servicioId).delete()
            const wifi = await estado(
                client
                    .post(`/api/v1/servicios/${servicioId}/wifi`)
                    .bearerToken(iris)
                    .header('X-Iris-Actor', 'usuario:57')
                    .header('Idempotency-Key', `iris:wifi:orden:77:${unico('u')}`)
                    .json({
                        clave: CLAVE_WIFI,
                        origen_tipo: 'iris_orden',
                        origen_id: '77',
                        verificacion: {
                            metodo: 'presencial',
                            verificado_en: new Date().toISOString(),
                            cliente_id: clienteId,
                        },
                    }),
                202,
            )
            assert.equal(await procesarWifi(wifi.body().solicitud_id), 'aplicado')
            const guardado = await db
                .from('integraciones.equipos_servicio')
                .where('servicio_id', servicioId)
                .firstOrFail()
            assert.equal(guardado.acs_device_id, `00259E-F670L-${serie}`)
        } finally {
            await borrarEquiposDe(e.B)
            await soloEmpresaPrincipal()
        }
    })

    test('A33 sin respuesta de ningún sistema: 503 equipo_sin_respuesta', async ({ client, assert }) => {
        escenarioFeliz(so, acs, 'ZTEG99999999')
        await configurar(so, acs, [])
        const iris = await tokenIris()
        const { servicioId } = await servicioPendiente()
        await db.table('integraciones.equipos_servicio').insert({
            servicio_id: servicioId,
            empresa_id: 1,
            tipo: 'ont',
            serie: 'ZTEG99999999',
            smartolt_external_id: `argos${servicioId}`,
        })
        so.responder('GET /api/onu/get_onu_status/*', () => ({
            status: 500,
            cuerpo: { status: false, error: 'boom' },
        }))
        const r = await estado(
            client
                .get(`/api/v1/servicios/${servicioId}/equipo`)
                .bearerToken(iris)
                .header('X-Iris-Actor', 'usuario:57'),
            503,
        )
        assert.equal(r.body().type, 'urn:argosisp:problema:equipo_sin_respuesta')
    })
})
