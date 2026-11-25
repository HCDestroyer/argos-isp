import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { Queue, type Worker } from 'bullmq'
import env from '#start/env'
import { contextoPrueba, estado, soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { crearClienteFila, crearServicioFila } from '#tests/core/fabricas'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import GenerarTokenIris from '#core/actions/generar_token_iris'
import { usuarioIris } from '#core/integraciones_iris'
import ConfigurarAcs from '#integraciones/equipos/actions/configurar_acs'
import ProbarAcs from '#integraciones/equipos/actions/probar_acs'
import { vistaAcs } from '#integraciones/equipos/acs'
import {
    NOMBRE_COLA_EQUIPOS,
    crearWorkerEquipos,
    encolarEquipos,
    fijarPrefijoColaEquipos,
    procesarAprovisionamiento,
    procesarWifi,
} from '#integraciones/equipos/cola'
import { fijarEsperaReintentos } from '#integraciones/equipos/http'
import {
    Simulado,
    borrarEquiposDe,
    configurarEquipos,
    dispositivoTr098,
    limpiarEquipos,
    onuSinConfigurar,
} from '#tests/integraciones/equipos_simulado'

/**
 * GenieACS en un servidor aparte (decisión del PM, crecimiento horizontal):
 * - el NBI detrás de un proxy HTTPS con autenticación básica (simulado con un servidor HTTPS local
 *   con un certificado autofirmado que genera `openssl` en la prueba);
 * - un ACS por empresa, sin nada global;
 * - varias instancias de `equipos-worker` sobre la misma cola sin trabajar dos veces un pedido.
 */

const USUARIO = 'argos'
const CLAVE = 'clave-del-proxy-123'

interface Certificado {
    key: string
    cert: string
}

/** Certificado autofirmado para `127.0.0.1` (o solo para `acs.otro.local`, para el de nombre equivocado). */
function certificado(dir: string, nombre: string, san: string): Certificado {
    const key = join(dir, `${nombre}.key`)
    const cert = join(dir, `${nombre}.crt`)
    execFileSync(
        'openssl',
        [
            'req',
            '-x509',
            '-newkey',
            'rsa:2048',
            '-nodes',
            '-days',
            '1',
            '-keyout',
            key,
            '-out',
            cert,
            '-subj',
            `/CN=${nombre}`,
            '-addext',
            `subjectAltName=${san}`,
        ],
        { stdio: 'ignore' },
    )
    return { key: readFileSync(key, 'utf8'), cert: readFileSync(cert, 'utf8') }
}

/** El proxy del NBI: exige autenticación básica (401) y puede negar la IP (403). */
function proxyNbi(acs: Simulado, opciones: { negarIp?: boolean } = {}) {
    const esperada = `Basic ${Buffer.from(`${USUARIO}:${CLAVE}`).toString('base64')}`
    acs.responder('GET /devices/', (p) => {
        if (opciones.negarIp) return { status: 403, cuerpo: 'Prohibido' }
        if (p.cabeceras.authorization !== esperada) return { status: 401, cuerpo: 'Unauthorized' }
        return { status: 200, cuerpo: [] }
    })
}

const ctxEmpresa = (empresaId = 1) => ({ ...contextoPrueba(), empresaId, empresasPermitidas: null })

async function configurarAcs(empresaId: number, url: string, extra: { ca?: string | null } = {}) {
    const { version } = await vistaAcs(empresaId)
    await new ConfigurarAcs().execute(
        { version, activo: true, url, usuario: USUARIO, clave: CLAVE, ...extra },
        ctxEmpresa(empresaId),
    )
    return new ProbarAcs().execute({}, ctxEmpresa(empresaId))
}

async function tokenIris() {
    const { token } = await new GenerarTokenIris().execute({ nombre: unico('Iris') }, contextoPrueba())
    const id = (await usuarioIris())!
    await db.from('core.usuarios').where('id', id).update({ activo: true, alcance_global: true })
    await db.from('core.usuarios_empresas').where('usuario_id', id).delete()
    return token
}

test.group('Equipos · GenieACS en otro servidor, varios ACS y varios workers', (group) => {
    let dir = ''
    let valido: Certificado
    let otroNombre: Certificado
    group.setup(() => {
        fijarEsperaReintentos(0)
        dir = mkdtempSync(join(tmpdir(), 'acs-tls-'))
        valido = certificado(dir, 'acs-ip', 'IP:127.0.0.1')
        otroNombre = certificado(dir, 'acs-otro', 'DNS:acs.otro.local')
        return () => rmSync(dir, { recursive: true, force: true })
    })
    group.each.teardown(async () => {
        await limpiarEquipos()
        await db.from('integraciones.iris_conector').delete()
    })

    test('probar conexión contra el NBI detrás de HTTPS con autenticación básica', async ({ assert }) => {
        const acs = await new Simulado().iniciar({ tls: valido })
        const ajeno = await new Simulado().iniciar({ tls: otroNombre })
        try {
            proxyNbi(acs)
            proxyNbi(ajeno)
            // con la autoridad propia guardada y las credenciales correctas: ok, con la cabecera Basic
            const ok = await configurarAcs(1, acs.url, { ca: valido.cert })
            assert.isTrue(ok.ok, ok.error ?? '')
            assert.isTrue(ok.config.operativo)
            assert.lengthOf(acs.de('/devices/'), 1)

            // clave equivocada: 401 con un texto claro, y sin capacidad
            const { version: v } = await vistaAcs(1)
            await new ConfigurarAcs().execute({ version: v, clave: 'otra-clave-mala' }, ctxEmpresa())
            const mala = await new ProbarAcs().execute({}, ctxEmpresa())
            assert.isFalse(mala.ok)
            assert.include(mala.error!, 'rechazó el usuario o la clave (401)')
            assert.isFalse(mala.config.operativo)

            // sin la autoridad propia: el certificado autofirmado no se acepta (y no se reintenta)
            acs.peticiones.length = 0
            const sinCa = await configurarAcs(1, acs.url, { ca: null })
            assert.isFalse(sinCa.ok)
            assert.include(sinCa.error!, 'El certificado HTTPS de GenieACS no es válido: es autofirmado')
            assert.lengthOf(acs.peticiones, 0, 'no se mandan credenciales a un servidor no confiable')

            // certificado de otro nombre (aunque su autoridad esté guardada)
            const nombre = await configurarAcs(1, ajeno.url, { ca: otroNombre.cert })
            assert.isFalse(nombre.ok)
            assert.include(nombre.error!, 'no es del nombre de la URL')

            // el proxy niega la IP de Argos: 403 con su explicación
            const negado = await new Simulado().iniciar({ tls: valido })
            proxyNbi(negado, { negarIp: true })
            const ip = await configurarAcs(1, negado.url, { ca: valido.cert })
            assert.include(ip.error!, 'la IP de Argos no está permitida')
            await negado.detener()

            // un PEM que no es un certificado: 422
            const config = await vistaAcs(1)
            await assert.rejects(
                () => new ConfigurarAcs().execute({ version: config.version, ca: 'hola' }, ctxEmpresa()),
                /no son válidos|Datos inválidos|validos/i,
            )

            // la clave del proxy nunca queda en audit.red ni en la auditoría
            const todo = JSON.stringify([
                await db.from('audit.red').where('tipo', 'genieacs').orderBy('id', 'desc').limit(20),
                await db
                    .from('audit.acciones')
                    .where('accion', 'acs.configurar')
                    .orderBy('id', 'desc')
                    .limit(10),
            ])
            assert.notInclude(todo, CLAVE)
        } finally {
            await acs.detener()
            await ajeno.detener()
        }
    })

    test('un ACS por empresa: el Wi-Fi de un servicio va al GenieACS de su empresa', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const acs1 = await new Simulado().iniciar({ tls: valido })
        const acs2 = await new Simulado().iniciar({ tls: valido })
        try {
            for (const acs of [acs1, acs2]) {
                acs.responder('GET /devices/', (p) => {
                    const q = JSON.parse(p.consulta.get('query') ?? '{}')
                    if (q._id) return { status: 200, cuerpo: [dispositivoTr098(q._id, 'SERIE1')] }
                    return { status: 200, cuerpo: [] }
                }).responder('POST /devices/*', (p) => ({ status: 200, cuerpo: { ...p.json, _id: 't1' } }))
            }
            await configurarAcs(1, acs1.url, { ca: valido.cert })
            await configurarAcs(e.B, acs2.url, { ca: valido.cert })
            const clienteId = await crearClienteFila()
            const servicioId = await crearServicioFila({
                cliente_id: clienteId,
                empresa_id: e.B,
                estado: 'activo',
            })
            await db.table('integraciones.equipos_servicio').insert({
                servicio_id: servicioId,
                empresa_id: e.B,
                tipo: 'router_tr069',
                serie: 'SERIE1',
                acs_device_id: 'OUI-MODELO-SERIE1',
            })
            const iris = await tokenIris()
            const pedir = () =>
                client
                    .post(`/api/v1/servicios/${servicioId}/wifi`)
                    .bearerToken(iris)
                    .header('X-Iris-Actor', 'usuario:57')
                    .header('Idempotency-Key', `iris:wifi:orden:5:${unico('u')}`)
                    .json({
                        ssid: 'Red Empresa B',
                        origen_tipo: 'iris_orden',
                        origen_id: '5',
                        verificacion: {
                            metodo: 'presencial',
                            verificado_en: new Date().toISOString(),
                            cliente_id: clienteId,
                        },
                    })
            const r = await estado(pedir(), 202)
            assert.equal(await procesarWifi(r.body().solicitud_id), 'aplicado')
            assert.lengthOf(acs2.de('/devices/OUI-MODELO-SERIE1/tasks'), 1)
            assert.lengthOf(acs1.peticiones, 1, 'el ACS de la empresa 1 solo recibió su prueba de conexión')

            // el equipo registrado con el ACS de otra empresa no vale para este servicio
            await db
                .from('integraciones.equipos_servicio')
                .where('servicio_id', servicioId)
                .update({ empresa_id: 1 })
            const otra = await estado(pedir(), 409)
            assert.equal(otra.body().type, 'urn:argosisp:problema:equipo_sin_gestion')
        } finally {
            await acs1.detener()
            await acs2.detener()
            await borrarEquiposDe(e.B)
            await soloEmpresaPrincipal()
        }
    })

    test('dos equipos-worker sobre la misma cola: un pedido se trabaja una sola vez', async ({
        client,
        assert,
    }) => {
        process.env.EQUIPOS_PERMITIR_HTTP = 'true'
        const so = await new Simulado().iniciar()
        const acs = await new Simulado().iniciar()
        const prefijo = `${env.get('COLAS_PREFIJO') ?? 'a6'}-equipos-prueba-${unico('p')}`
        await fijarPrefijoColaEquipos(prefijo)
        const workers: Worker[] = []
        try {
            const serie = 'ZTEG77777777'
            let autorizada = false
            so.responder('GET /api/system/get_olts', () => ({
                status: 200,
                cuerpo: { status: true, response: [] },
            }))
                .responder('GET /api/onu/get_onus_details_by_sn/*', () => ({
                    status: 200,
                    cuerpo: {
                        status: true,
                        onus: autorizada ? [{ unique_external_id: 'otro', sn: serie }] : [],
                    },
                }))
                .responder('GET /api/onu/unconfigured_onus', () => ({
                    status: 200,
                    cuerpo: { status: true, response: [onuSinConfigurar(serie)] },
                }))
                .responder('POST /api/onu/authorize_onu', async () => {
                    // autorizar en línea tarda: la otra instancia toma el job mientras tanto
                    await new Promise((r) => setTimeout(r, 800))
                    autorizada = true
                    return { status: 200, cuerpo: { status: true, response: 'ONU configuration saved' } }
                })
                .responder('GET /api/onu/get_onu_signal/*', () => ({ status: 200, cuerpo: { status: true } }))
            acs.responder('GET /devices/', () => ({ status: 200, cuerpo: [] }))
            const clienteId = await crearClienteFila()
            const servicioId = await crearServicioFila({ cliente_id: clienteId, empresa_id: 1 })
            await db
                .from('core.servicios')
                .where('id', servicioId)
                .update({ estado: 'pendiente_instalacion', instalado_en: null })
            const { plan_id: planId } = await db.from('core.servicios').where('id', servicioId).firstOrFail()
            await configurarEquipos({
                smartolt: {
                    url: so.url,
                    perfiles: [{ smartolt_olt_id: '1', plan_id: planId, authorization_preset_id: 31 }],
                },
            })

            // sin cola durante la petición: se encola a mano dos veces, una por instancia
            process.env.EQUIPOS_SIN_COLA = 'true'
            const iris = await tokenIris()
            const r = await estado(
                client
                    .post(`/api/v1/servicios/${servicioId}/aprovisionar`)
                    .bearerToken(iris)
                    .header('X-Iris-Actor', 'usuario:57')
                    .header('Idempotency-Key', `iris:aprovisionar:8:${unico('i')}`)
                    .json({ equipo: { tipo: 'ont', serie }, origen_tipo: 'iris_orden', origen_id: '8' }),
                202,
            )
            const id = r.body().aprovisionamiento_id
            delete process.env.EQUIPOS_SIN_COLA

            workers.push(crearWorkerEquipos({ concurrencia: 1 }), crearWorkerEquipos({ concurrencia: 1 }))
            await Promise.all(workers.map((w) => w.waitUntilReady()))
            const resultados: unknown[] = []
            for (const w of workers) w.on('completed', (_job, valor) => resultados.push(valor))
            await encolarEquipos('aprovisionar', id)
            await encolarEquipos('aprovisionar', id)

            const limite = Date.now() + 20_000
            while (resultados.length < 2 && Date.now() < limite) {
                await new Promise((res) => setTimeout(res, 100))
            }
            assert.lengthOf(resultados, 2, 'las dos instancias terminaron su job')
            assert.lengthOf(
                resultados.filter((x) => x === 'listo'),
                1,
                'una sola instancia lo trabajó',
            )
            assert.includeMembers(
                [null, 'omitido'],
                resultados.filter((x) => x !== 'listo'),
            )
            assert.lengthOf(so.de('/api/onu/authorize_onu'), 1, 'la ONT se autorizó una sola vez')
            const fila = await db.from('integraciones.aprovisionamientos').where('id', id).firstOrFail()
            assert.equal(fila.estado, 'listo')
            const eventos = await db
                .from('audit.outbox')
                .where('evento', 'instalacion.aprovisionada')
                .whereRaw(`(payload->>'aprovisionamiento_id')::int = ?`, [id])
            assert.lengthOf(eventos, 1)

            // y en el mismo proceso: dos llamadas a la vez, una sola corre
            const otra = await Promise.all([procesarAprovisionamiento(id), procesarAprovisionamiento(id)])
            assert.lengthOf(
                otra.filter((x) => x === 'listo'),
                0,
                'un pedido terminado no se vuelve a trabajar',
            )
        } finally {
            await Promise.all(workers.map((w) => w.close()))
            const cola = new Queue(NOMBRE_COLA_EQUIPOS, {
                connection: {
                    host: env.get('REDIS_HOST') ?? '127.0.0.1',
                    port: env.get('REDIS_PORT') ?? 6379,
                    password: env.get('REDIS_PASSWORD') || undefined,
                },
                prefix: prefijo,
            })
            await cola.obliterate({ force: true })
            await cola.close()
            await fijarPrefijoColaEquipos(null)
            await so.detener()
            await acs.detener()
            delete process.env.EQUIPOS_PERMITIR_HTTP
            delete process.env.EQUIPOS_SIN_COLA
        }
    })
})
