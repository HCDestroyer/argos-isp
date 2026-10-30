import assert from 'node:assert/strict'
import { execFile, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { after, before, describe, it } from 'node:test'
import radius from 'radius'
import { leerConfig } from '../src/config.ts'
import { firmarPeticion, verificarPeticion, verificarRespuesta } from '../src/firma.ts'
import { atributosRadius, ClienteNasUdp } from '../src/nas.ts'
import { NasSimulado } from './nas_simulado.ts'
import { TIMEOUT_ACK_MS } from './ayudas.ts'

const SECRET = 'secreto-de-prueba'

describe('firma RFC 5176', () => {
    it('una petición firmada se verifica con el secret y no con otro', () => {
        const paquete = firmarPeticion(
            radius.encode({
                code: 'CoA-Request',
                secret: SECRET,
                identifier: 7,
                attributes: [
                    ...atributosRadius({ 'User-Name': 'u', 'Mikrotik-Rate-Limit': '1M/1M' }),
                    ['Message-Authenticator', Buffer.alloc(16)],
                ],
                add_message_authenticator: false,
            }),
            SECRET,
        )
        assert.ok(verificarPeticion(paquete, SECRET))
        assert.ok(!verificarPeticion(paquete, 'otro'))
        const alterado = Buffer.from(paquete)
        const i = alterado.length - 20
        alterado.writeUInt8(alterado.readUInt8(i) ^ 1, i)
        assert.ok(!verificarPeticion(alterado, SECRET))
    })

    it('la respuesta de encode_response (con MA) se verifica contra su petición', () => {
        const peticion = firmarPeticion(
            radius.encode({
                code: 'Disconnect-Request',
                secret: SECRET,
                identifier: 9,
                attributes: [
                    ['User-Name', 'u'],
                    ['Message-Authenticator', Buffer.alloc(16)],
                ],
                add_message_authenticator: false,
            }),
            SECRET,
        )
        const respuesta = radius.encode_response({
            packet: radius.decode_without_secret({ packet: peticion }),
            code: 'Disconnect-ACK',
            secret: SECRET,
        })
        assert.ok(verificarRespuesta(peticion, respuesta, SECRET))
        assert.ok(!verificarRespuesta(peticion, respuesta, 'otro'))
    })
})

describe('ClienteNasUdp ↔ NAS simulado', () => {
    const nas = new NasSimulado({ ip: '127.0.0.1', secret: SECRET })
    const cliente = new ClienteNasUdp()
    const envio = (tipo: 'coa' | 'disconnect', secret = SECRET, timeoutMs = TIMEOUT_ACK_MS) => ({
        tipo,
        nasIp: '127.0.0.1',
        puerto: nas.puerto,
        secret,
        timeoutMs,
        atributos: {
            'User-Name': 'cliente-101',
            'Acct-Session-Id': '81a00003',
            ...(tipo === 'coa'
                ? {
                      'Mikrotik-Rate-Limit': '256k/256k',
                      'Mikrotik-Address-List': 'suspendidos',
                      'Filter-Id': 'argos-corte.in',
                  }
                : {}),
        },
    })

    before(() => nas.iniciar())
    after(() => nas.cerrar())

    it('CoA → CoA-ACK; el NAS recibe los VSA de MikroTik, Filter-Id y Message-Authenticator', async () => {
        nas.modo = 'ack'
        const r = await cliente.enviar(envio('coa'))
        assert.equal(r.resultado, 'ack')
        assert.equal(r.codigo, 'CoA-ACK')
        const recibido = nas.recibidos.at(-1)!
        assert.equal(recibido.codigo, 'CoA-Request')
        assert.ok(recibido.firmaValida)
        assert.ok(recibido.messageAuthenticator)
        assert.deepEqual(recibido.atributos, {
            'User-Name': 'cliente-101',
            'Acct-Session-Id': '81a00003',
            'Mikrotik-Rate-Limit': '256k/256k',
            'Mikrotik-Address-List': 'suspendidos',
            'Filter-Id': 'argos-corte.in',
        })
    })

    it('Disconnect → Disconnect-NAK con Error-Cause', async () => {
        nas.modo = 'nak'
        const r = await cliente.enviar(envio('disconnect'))
        assert.equal(r.resultado, 'nak')
        assert.equal(r.codigo, 'Disconnect-NAK')
        assert.equal(r.atributos?.['Error-Cause'], 'Session-Context-Not-Found')
    })

    it('NAS que no responde → timeout', async () => {
        nas.modo = 'silencio'
        const r = await cliente.enviar(envio('coa', SECRET, 200))
        assert.equal(r.resultado, 'timeout')
    })

    it('secret distinto: el NAS no responde (firma inválida) → timeout', async () => {
        nas.modo = 'ack'
        const r = await cliente.enviar(envio('coa', 'secreto-equivocado', 200))
        assert.equal(r.resultado, 'timeout')
        assert.equal(nas.recibidos.at(-1)?.firmaValida, false)
    })
})

/**
 * Interoperabilidad: `radclient` de FreeRADIUS 3.2 (la misma pila que el PM usó contra RouterOS
 * 7.24.5) firma una CoA con Message-Authenticator; el NAS simulado debe validarla con `firma.ts`.
 * Así `firmarPeticion` queda comprobado contra la implementación de referencia.
 */
const exec = promisify(execFile)
const IMAGEN = (() => {
    const compose = readFileSync(
        fileURLToPath(new URL('../../../infra/docker-compose.yml', import.meta.url)),
        'utf8',
    )
    return (
        compose.match(/freeradius\/freeradius-server:[0-9.]+/)?.[0] ?? 'freeradius/freeradius-server:3.2.10'
    )
})()
const sinDocker =
    process.env.AAA_PRUEBAS_DOCKER === '0'
        ? 'AAA_PRUEBAS_DOCKER=0'
        : spawnSync('docker', ['image', 'inspect', IMAGEN], { stdio: 'ignore' }).status !== 0
          ? `sin Docker o sin ${IMAGEN}`
          : null

describe('origen de los CoA (contratos/conexion-routers.md §6.4)', () => {
    // Con WireGuard, `COA_ORIGEN_IP` queda vacía: el socket no se ata a una IP y el origen lo pone la
    // ruta (y el enmascarado de Docker en el host: la .1 del túnel, `infra/wireguard/README.md`).
    const nas = new NasSimulado({ ip: '127.0.0.7', secret: SECRET })
    const envio = {
        tipo: 'disconnect' as const,
        nasIp: '127.0.0.7',
        secret: SECRET,
        timeoutMs: TIMEOUT_ACK_MS,
        atributos: { 'User-Name': 'cliente-101', 'Acct-Session-Id': '81a00009' },
    }

    before(() => nas.iniciar())
    after(() => nas.cerrar())

    it('COA_ORIGEN_IP vacía: sin origen fijo; el NAS ve la IP que elige la ruta', async () => {
        assert.equal(leerConfig({ COA_ORIGEN_IP: '' }).nas.origen, undefined)
        assert.equal(leerConfig({}).nas.origen, undefined)
        const r = await new ClienteNasUdp(leerConfig({ COA_ORIGEN_IP: '' }).nas.origen).enviar({
            ...envio,
            puerto: nas.puerto,
        })
        assert.equal(r.resultado, 'ack')
        // El origen es la dirección preferida de la interfaz de salida (en loopback, 127.0.0.1), como
        // en el host con WireGuard lo es la .1 de `wg-argos` tras el enmascarado: nada lo fijó.
        assert.equal(nas.recibidos.at(-1)?.origen, '127.0.0.1')
    })

    it('COA_ORIGEN_IP con valor (router en la LAN): el paquete sale de esa IP', async () => {
        const origen = leerConfig({ COA_ORIGEN_IP: '127.0.0.3' }).nas.origen
        assert.equal(origen, '127.0.0.3')
        const r = await new ClienteNasUdp(origen).enviar({ ...envio, puerto: nas.puerto })
        assert.equal(r.resultado, 'ack')
        assert.equal(nas.recibidos.at(-1)?.origen, '127.0.0.3')
    })
})

describe('radclient (FreeRADIUS) → NAS simulado', { skip: sinDocker ?? false }, () => {
    const nas = new NasSimulado({ ip: '0.0.0.0', secret: SECRET, modo: 'ack' })
    before(() => nas.iniciar())
    after(() => nas.cerrar())

    it('valida la firma de radclient y radclient acepta el CoA-ACK', async () => {
        const { stdout } = await exec(
            'docker',
            [
                'run',
                '--rm',
                '--add-host',
                'host.docker.internal:host-gateway',
                '--entrypoint',
                'sh',
                IMAGEN,
                '-c',
                `printf '%s\\n' 'User-Name = "cliente-101", Acct-Session-Id = "81a00003", Mikrotik-Rate-Limit = "1M/1M", Message-Authenticator = 0x00' | radclient -x -r 1 -t 3 host.docker.internal:${nas.puerto} coa ${SECRET}`,
            ],
            { timeout: 60_000 },
        )
        const recibido = nas.recibidos.at(-1)
        assert.ok(recibido, 'el NAS simulado recibió la CoA')
        assert.ok(recibido.messageAuthenticator)
        assert.ok(recibido.firmaValida, 'firma de radclient válida según firma.ts')
        assert.equal(recibido.atributos['Mikrotik-Rate-Limit'], '1M/1M')
        assert.match(stdout, /Received CoA-ACK/)
    })
})
