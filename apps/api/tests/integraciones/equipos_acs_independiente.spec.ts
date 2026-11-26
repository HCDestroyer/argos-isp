import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, unico, usuarioConRoles, soloEmpresaPrincipal } from '#tests/ayudas'
import { crearClienteFila, crearServicioFila } from '#tests/core/fabricas'
import GenerarTokenIris from '#core/actions/generar_token_iris'
import { usuarioIris } from '#core/integraciones_iris'
import { procesarAprovisionamiento } from '#integraciones/equipos/cola'
import { fijarEsperaReintentos } from '#integraciones/equipos/http'
import { capacidadesIris } from '#integraciones/equipos/equipos'
import { prepararEmpresas } from '#tests/contabilidad/ayudas_contabilidad'
import {
    Simulado,
    configurarEquipos,
    dispositivoTr098,
    limpiarEquipos,
} from '#tests/integraciones/equipos_simulado'

/**
 * ACS independiente de SmartOLT (`contratos/equipos-olt-acs.md`, lote 2, casos 1 a 7): una empresa
 * solo con ACS gestiona TR-069 sin tocar SmartOLT; `PUT`/`POST /integraciones/acs` con su propia
 * versión, su prueba y su evento.
 */

const CLAVE_ACS = 'clave-acs-independiente-1'
const CLAVE_WIFI = 'ClaveWifiSecreta!9'

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
    return { clienteId, servicioId }
}

/** GenieACS con un router TR-098 que responde a cualquier búsqueda con su MAC o su id. */
function acsConRouter(acs: Simulado, id: string, serie: string) {
    acs.responder('GET /devices/', (p) => {
        const q = p.consulta.get('query') ?? '{}'
        if (q === '{}') return { status: 200, cuerpo: [{ _id: 'cualquiera' }] }
        return { status: 200, cuerpo: [dispositivoTr098(id, serie)] }
    }).responder('POST /devices/*', (p) => ({ status: 200, cuerpo: { ...p.json, _id: 'tarea1' } }))
}

test.group('Equipos · ACS independiente de SmartOLT (lote 2)', (group) => {
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
    group.each.setup(async () => {
        so.limpiar()
        acs.limpiar()
        await limpiarEquipos()
    })
    group.each.teardown(async () => {
        await limpiarEquipos()
    })

    test('1: solo ACS probado → tr069 sí, ftth no; estado_equipo y wifi sí', async ({ assert }) => {
        await configurarEquipos({ acs: { url: acs.url, usuario: 'argos', clave: CLAVE_ACS } })
        const c = await capacidadesIris(db.connection(), { empresas: [1], contratoIris: '0.14.3' })
        assert.deepInclude(c.aprovisionamiento, { empresa_id: 1, ftth: false, wireless: true, tr069: true })
        const marcas = c.equipos.find((e) => e.empresa_id === 1)!
        assert.isTrue(marcas.estado_equipo)
        assert.isTrue(marcas.wifi)
    })

    test('2 y 3: solo ACS → router TR-069 con Wi-Fi listo sin tocar SmartOLT; una ONT no está disponible', async ({
        client,
        assert,
    }) => {
        await configurarEquipos({ acs: { url: acs.url, usuario: 'argos', clave: CLAVE_ACS } })
        const serie = `RT${unico('s').replace(/\W/g, '').slice(-10).toUpperCase()}`
        acsConRouter(acs, `00259E-F670L-${serie}`, serie)
        const iris = await tokenIris()
        const { servicioId } = await servicioPendiente()
        const pedir = (cuerpo: Record<string, unknown>) =>
            client
                .post(`/api/v1/servicios/${servicioId}/aprovisionar`)
                .bearerToken(iris)
                .header('X-Iris-Actor', 'usuario:57')
                .header('Idempotency-Key', `iris:aprovisionar:1:${unico('i')}`)
                .json(cuerpo)

        const ont = await estado(
            pedir({
                equipo: { tipo: 'ont', serie: 'ZTEG00000099' },
                origen_tipo: 'iris_orden',
                origen_id: '1',
            }),
            422,
        )
        assert.equal(ont.body().type, 'urn:argosisp:problema:aprovisionamiento_no_disponible')

        const r = await estado(
            pedir({
                equipo: { tipo: 'router_tr069', mac: 'AA:BB:CC:00:11:22', serie },
                wifi: { ssid: 'Casa', clave: CLAVE_WIFI },
                origen_tipo: 'iris_orden',
                origen_id: '2',
            }),
            202,
        )
        assert.equal(await procesarAprovisionamiento(r.body().aprovisionamiento_id), 'listo')
        assert.lengthOf(so.peticiones, 0)
        assert.lengthOf(
            await db.from('audit.red').where('tipo', 'smartolt').where('servicio_id', servicioId),
            0,
        )
        assert.isAbove(acs.de('/devices/').length, 0)
    })

    test('4: PUT /integraciones/acs: encender sin URL 422; cambiar la clave borra la prueba; *** en respuesta y auditoría', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const put = (cuerpo: Record<string, unknown>) =>
            client
                .put('/api/v1/integraciones/acs')
                .bearerToken(token)
                .header('X-Empresa-Id', '1')
                .json(cuerpo)
        const sinUrl = await estado(put({ version: 0, activo: true }), 422)
        assert.equal(sinUrl.body().errors[0].field, 'activo')

        const creado = await estado(
            put({ version: 0, activo: true, url: acs.url, usuario: 'argos', clave: CLAVE_ACS }),
            200,
        )
        assert.equal(creado.body().clave, '***')
        assert.equal(creado.body().version, 1)
        assert.isFalse(creado.body().operativo)

        acs.responder('GET /devices/', () => ({ status: 200, cuerpo: [] }))
        const prueba = await estado(
            client.post('/api/v1/integraciones/acs/probar').bearerToken(token).header('X-Empresa-Id', '1'),
            200,
        )
        assert.isTrue(prueba.body().ok)
        assert.isTrue(prueba.body().config.operativo)

        const otra = await estado(put({ version: 1, clave: 'otra-clave-del-acs' }), 200)
        assert.isNull(otra.body().prueba_ok)
        assert.isFalse(otra.body().operativo)
        assert.equal(otra.body().clave, '***')

        const cambios = JSON.stringify(
            await db.from('audit.cambios').where({ entidad_tipo: 'configuracion_acs', entidad_id: 1 }),
        )
        const acciones = JSON.stringify(await db.from('audit.acciones').where('accion', 'acs.configurar'))
        for (const texto of [cambios, acciones, JSON.stringify(otra.body())]) {
            assert.notInclude(texto, CLAVE_ACS)
            assert.notInclude(texto, 'otra-clave-del-acs')
        }
        assert.include(cambios, '*** (nuevo)')

        // sin permiso
        const { token: cajero } = await usuarioConRoles(['cajero'])
        await estado(
            client.get('/api/v1/integraciones/acs').bearerToken(cajero).header('X-Empresa-Id', '1'),
            403,
        )
    })

    test('5: probar el ACS no llama a SmartOLT', async ({ client, assert }) => {
        await configurarEquipos({
            smartolt: { url: so.url },
            acs: { url: acs.url, usuario: 'argos', clave: CLAVE_ACS, probado: false },
        })
        acs.responder('GET /devices/', () => ({ status: 200, cuerpo: [] }))
        const { token } = await usuarioConRoles(['admin'])
        const r = await estado(
            client.post('/api/v1/integraciones/acs/probar').bearerToken(token).header('X-Empresa-Id', '1'),
            200,
        )
        assert.isTrue(r.body().ok)
        assert.lengthOf(so.peticiones, 0)
        assert.lengthOf(acs.de('/devices/'), 1)
    })

    test('6: versión vieja 409; el ACS de A no se ve desde B', async ({ client, assert }) => {
        const e = await prepararEmpresas()
        try {
            const { token } = await usuarioConRoles(['admin'])
            const put = (empresa: number, cuerpo: Record<string, unknown>) =>
                client
                    .put('/api/v1/integraciones/acs')
                    .bearerToken(token)
                    .header('X-Empresa-Id', String(empresa))
                    .json(cuerpo)
            await estado(put(1, { version: 0, url: acs.url }), 200)
            await estado(put(1, { version: 1, usuario: 'otro' }), 200)
            const vieja = await estado(put(1, { version: 1, usuario: 'tercero' }), 409)
            assert.equal(vieja.body().type, 'urn:argosisp:problema:conflicto_version')
            const deB = await estado(
                client
                    .get('/api/v1/integraciones/acs')
                    .bearerToken(token)
                    .header('X-Empresa-Id', String(e.B)),
                200,
            )
            assert.isNull(deB.body().url)
            assert.equal(deB.body().version, 0)
            assert.equal(deB.body().empresa_id, e.B)
        } finally {
            await soloEmpresaPrincipal()
        }
    })

    test('7: emite equipos.config_cambiada con sistema acs y sin valores', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const desde = new Date()
        await estado(
            client
                .put('/api/v1/integraciones/acs')
                .bearerToken(token)
                .header('X-Empresa-Id', '1')
                .json({ version: 0, activo: true, url: acs.url, usuario: 'argos', clave: CLAVE_ACS }),
            200,
        )
        const eventos = await db
            .from('audit.outbox')
            .where('evento', 'equipos.config_cambiada')
            .where('created_at', '>=', desde)
        assert.lengthOf(eventos, 1)
        const p = eventos[0].payload
        assert.equal(p.sistema, 'acs')
        assert.equal(p.empresa_id, 1)
        assert.isNull(p.instancia_id)
        assert.equal(p.accion, 'creada')
        assert.sameMembers(p.campos, ['activo', 'url', 'usuario', 'clave'])
        assert.isFalse(p.operativa)
        const texto = JSON.stringify(p)
        assert.notInclude(texto, CLAVE_ACS)
        assert.notInclude(texto, acs.url)
    })
})
