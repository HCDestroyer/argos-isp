import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { after, before, describe, it } from 'node:test'
import type { ColaAccounting, RegistroAccounting } from '../src/accounting.ts'
import { crearApp } from '../src/app.ts'
import { cifrar } from '../src/cifrado.ts'
import { FuenteFixtures, ResolutorServicios } from '../src/fuentes.ts'
import { leerAtributos } from '../src/radius.ts'
import { idDerivado } from '../src/request_id.ts'
import { borrarPrefijo, CLAVE, PERFIL, prefijoDePrueba, redisDePrueba, servicio } from './ayudas.ts'
import { CONF, exec, IMAGEN_FREERADIUS, motivoSinDocker } from './docker.ts'

/**
 * Tarea 3: FreeRADIUS 3.2 real (Docker, config del repo) → rlm_rest → aaa (este proceso, fixtures +
 * Redis base 2) y `radtest` PAP y CHAP desde dentro del contenedor, como haría el MikroTik.
 * Se omite si no hay Docker (`AAA_PRUEBAS_DOCKER=0` la desactiva).
 */

const SECRET = 'secreto-local-de-prueba'
const motivo = motivoSinDocker()

interface Respuesta {
    tipo: 'Access-Accept' | 'Access-Reject' | 'sin respuesta'
    atributos: Record<string, string>
    /** RouterOS 7.15+ exige Message-Authenticator en las respuestas (Blast-RADIUS). */
    messageAuthenticator: boolean
}

function parsear(salida: string): Respuesta {
    const tipo = /Received (Access-Accept|Access-Reject)/.exec(salida)?.[1] as Respuesta['tipo'] | undefined
    const atributos: Record<string, string> = {}
    let messageAuthenticator = false
    if (tipo) {
        const despues = salida
            .slice(salida.indexOf(`Received ${tipo}`))
            .split('\n')
            .slice(1)
        for (const linea of despues) {
            const m = /^\t([\w-]+) = "?(.*?)"?$/.exec(linea)
            if (!m) break
            if (m[1] === 'Message-Authenticator') messageAuthenticator = true
            else atributos[m[1] as string] = m[2] as string
        }
    }
    return { tipo: tipo ?? 'sin respuesta', atributos, messageAuthenticator }
}

describe('FreeRADIUS en Docker → aaa (radtest PAP/CHAP)', { skip: motivo ?? false }, () => {
    const redis = redisDePrueba()
    const prefijo = prefijoDePrueba()
    const contenedor = `a2-freeradius-prueba-${randomBytes(3).toString('hex')}`
    let app: ReturnType<typeof crearApp>
    const encolados: RegistroAccounting[] = []
    /** X-Request-Id que mandó FreeRADIUS y el que aaa derivaría del mismo paquete. */
    const ids: { ruta: string; cabecera: unknown; derivado: string | null }[] = []
    const cola: ColaAccounting = {
        encolar: async (r) => {
            encolados.push(r)
        },
    }

    /** Accounting-Request desde el contenedor como lo mandaría el MikroTik (radclient → 1813). */
    async function radacct(atributos: string): Promise<boolean> {
        const r = await exec(
            'docker',
            [
                'exec',
                contenedor,
                'sh',
                '-c',
                `printf '%s\\n' '${atributos}' | radclient -x -c 1 -r 1 -t 3 127.0.0.1:1813 acct ${SECRET}`,
            ],
            { timeout: 15_000 },
        ).catch((e: { stdout?: string }) => ({ stdout: e.stdout ?? '' }))
        return /Received Accounting-Response/.test(r.stdout)
    }

    async function radtest(usuario: string, clave: string, metodo: 'pap' | 'chap'): Promise<Respuesta> {
        const r = await exec(
            'docker',
            ['exec', contenedor, 'radtest', '-t', metodo, usuario, clave, '127.0.0.1', '0', SECRET],
            { timeout: 15_000 },
        ).catch((e: { stdout?: string }) => ({ stdout: e.stdout ?? '' }))
        return parsear(r.stdout)
    }

    before(async () => {
        const fuente = await FuenteFixtures.desdeArchivo(
            fileURLToPath(new URL('../fixtures/servicios.json', import.meta.url)),
            CLAVE,
        )
        app = crearApp({
            resolutor: new ResolutorServicios({ redis, prefijo, respaldo: fuente, log: { warn: () => {} } }),
            claveSecretos: CLAVE,
            perfil: PERFIL,
            logLevel: 'silent',
            cola,
        })
        app.addHook('preHandler', async (req) => {
            ids.push({
                ruta: req.routeOptions.url ?? '',
                cabecera: req.headers['x-request-id'],
                derivado: idDerivado(leerAtributos(req.body)),
            })
        })
        // 0.0.0.0: el contenedor llega al host por host-gateway (sin --network host, sin chocar con 1812 del host).
        await app.listen({ port: 0, host: '0.0.0.0' })
        const puerto = (app.server.address() as AddressInfo).port

        await exec('docker', [
            'run',
            '-d',
            '--name',
            contenedor,
            '--add-host',
            'host.docker.internal:host-gateway',
            '-e',
            `AAA_URL=http://host.docker.internal:${puerto}`,
            '-e',
            `RADIUS_LOCAL_SECRET=${SECRET}`,
            '-e',
            'RADIUS_LAB_NAS_IP=192.0.2.250',
            '-e',
            'RADIUS_LAB_SECRET=secreto-lab-de-prueba',
            '-v',
            `${CONF}/mods-enabled:/etc/freeradius/mods-enabled:ro`,
            '-v',
            `${CONF}/sites-enabled:/etc/freeradius/sites-enabled:ro`,
            '-v',
            `${CONF}/clients.conf:/etc/freeradius/clients.conf:ro`,
            '-v',
            `${CONF}/clients.d:/etc/freeradius/clients.d:ro`,
            IMAGEN_FREERADIUS,
            '-f',
            '-l',
            'stdout',
        ])

        // Listo cuando responde un Status-Server.
        const limite = Date.now() + 30_000
        for (;;) {
            const ok = await exec(
                'docker',
                [
                    'exec',
                    contenedor,
                    'sh',
                    '-c',
                    `echo 'Message-Authenticator = 0x00' | radclient -q -c 1 -r 1 -t 1 127.0.0.1:1812 status ${SECRET}`,
                ],
                { timeout: 5000 },
            ).then(
                () => true,
                () => false,
            )
            if (ok) break
            if (Date.now() > limite) {
                const { stdout } = await exec('docker', ['logs', contenedor]).catch(() => ({ stdout: '' }))
                throw new Error(`FreeRADIUS no arrancó:\n${stdout.slice(-2000)}`)
            }
            await new Promise((r) => setTimeout(r, 500))
        }
    })

    after(async () => {
        await exec('docker', ['rm', '-f', contenedor]).catch(() => {})
        await borrarPrefijo(redis, prefijo)
        await app?.close()
        redis.disconnect()
    })

    for (const metodo of ['pap', 'chap'] as const) {
        it(`${metodo}: activo → Accept con rate-limit del plan, IPv4 estática, /64 y /56`, async () => {
            const r = await radtest('prueba-activo', 'clave-activo', metodo)
            assert.equal(r.tipo, 'Access-Accept')
            assert.ok(r.messageAuthenticator)
            assert.deepEqual(r.atributos, {
                'Mikrotik-Rate-Limit': '5120k/20480k',
                'Framed-IP-Address': '10.10.1.10',
                'Framed-IPv6-Prefix': '2001:db8:101:1::/64',
                'Delegated-IPv6-Prefix': '2001:db8:300:100::/56',
                'Acct-Interim-Interval': '300',
            })
        })

        it(`${metodo}: limitado → Accept con rate-limit reducido y pools`, async () => {
            const r = await radtest('prueba-limitado', 'clave-limitado', metodo)
            assert.equal(r.tipo, 'Access-Accept')
            assert.ok(r.messageAuthenticator)
            assert.deepEqual(r.atributos, {
                'Mikrotik-Rate-Limit': '1024k/2048k',
                'Framed-Pool': 'argos-v4-pppoe',
                'Framed-IPv6-Pool': 'argos-v6-enlace',
                'Delegated-IPv6-Prefix-Pool': 'argos-v6-pd',
                'Mikrotik-Delegated-IPv6-Pool': 'argos-v6-pd',
                'Acct-Interim-Interval': '300',
            })
        })

        it(`${metodo}: suspendido → Accept con el perfil de corte`, async () => {
            const r = await radtest('prueba-suspendido', 'clave-suspendido', metodo)
            assert.equal(r.tipo, 'Access-Accept')
            assert.ok(r.messageAuthenticator)
            assert.deepEqual(r.atributos, {
                'Mikrotik-Rate-Limit': '256k/256k',
                'Mikrotik-Group': 'suspendido',
                'Mikrotik-Address-List': 'suspendidos',
                'Filter-Id': 'argos-corte.in',
                'Framed-IP-Address': '10.10.1.11',
                'Framed-IPv6-Prefix': '2001:db8:101:2::/64',
                'Delegated-IPv6-Prefix': '2001:db8:300:200::/56',
                'Acct-Interim-Interval': '300',
            })
        })

        it(`${metodo}: retirado → Reject sin atributos`, async () => {
            const r = await radtest('prueba-retirado', 'clave-retirado', metodo)
            assert.deepEqual(r, { tipo: 'Access-Reject', atributos: {}, messageAuthenticator: true })
        })

        it(`${metodo}: inexistente → Reject`, async () => {
            const r = await radtest('prueba-inexistente', 'cualquiera', metodo)
            assert.deepEqual(r, { tipo: 'Access-Reject', atributos: {}, messageAuthenticator: true })
        })

        it(`${metodo}: contraseña errónea → Reject`, async () => {
            const r = await radtest('prueba-activo', 'clave-mala', metodo)
            assert.deepEqual(r, { tipo: 'Access-Reject', atributos: {}, messageAuthenticator: true })
        })
    }

    it('activo con rate_limit_override (burst) y profile_ppp', async () => {
        const r = await radtest('prueba-burst', 'clave-burst', 'chap')
        assert.equal(r.tipo, 'Access-Accept')
        assert.equal(r.atributos['Mikrotik-Rate-Limit'], '5M/20M 10M/40M 4M/16M 16/16 8 1M/4M')
        assert.equal(r.atributos['Mikrotik-Group'], 'plan-20m')
    })

    it('el respaldo dejó la clave en Redis; un cambio de A1 en Redis se aplica en el siguiente login', async () => {
        const clave = `${prefijo}prueba-activo`
        assert.ok(await redis.exists(clave), 'cacheado tras el primer login')
        assert.equal(await redis.ttl(clave), -1)
        // A1 escribe el servicio suspendido (write-through). FreeRADIUS no cachea: el siguiente login lo ve.
        await redis.set(
            clave,
            JSON.stringify(
                servicio({
                    user_ppp: 'prueba-activo',
                    estado: 'suspendido',
                    pass_ppp: cifrar('clave-activo', CLAVE),
                }),
            ),
        )
        const r = await radtest('prueba-activo', 'clave-activo', 'pap')
        assert.equal(r.tipo, 'Access-Accept')
        assert.equal(r.atributos['Mikrotik-Address-List'], 'suspendidos')
        assert.equal(r.atributos['Filter-Id'], 'argos-corte.in')
    })

    it('accounting Start / Interim-Update / Stop → Accounting-Response y un job por paquete', async () => {
        const comunes =
            'User-Name = "prueba-activo", NAS-IP-Address = 127.0.0.1, Acct-Session-Id = "81a0000f", ' +
            'Framed-IP-Address = 10.10.1.10, Framed-IPv6-Prefix = 2001:db8:101:1::/64'
        assert.ok(await radacct(`Acct-Status-Type = Start, ${comunes}`))
        assert.ok(
            await radacct(
                `Acct-Status-Type = Interim-Update, ${comunes}, Acct-Input-Octets = 100, Acct-Output-Gigawords = 1, Acct-Session-Time = 300`,
            ),
        )
        assert.ok(
            await radacct(
                `Acct-Status-Type = Stop, ${comunes}, Acct-Input-Octets = 200, Acct-Session-Time = 600, Acct-Terminate-Cause = User-Request`,
            ),
        )
        assert.deepEqual(
            encolados.map((r) => r.tipo),
            ['Start', 'Interim-Update', 'Stop'],
        )
        const [inicio, interino, fin] = encolados
        assert.equal(inicio?.user_ppp, 'prueba-activo')
        assert.equal(inicio?.nas_ip, '127.0.0.1')
        assert.equal(inicio?.acct_session_id, '81a0000f')
        assert.equal(inicio?.ipv4, '10.10.1.10')
        assert.equal(inicio?.prefijo_enlace_v6, '2001:db8:101:1::/64')
        assert.equal(interino?.bytes_in, '100')
        assert.equal(interino?.bytes_out, '4294967296')
        assert.equal(fin?.duracion_s, 600)
        assert.equal(fin?.causa_fin, 'User-Request')
        // Mismo request_id en los tres paquetes de la sesión (NAS + Acct-Session-Id).
        const esperado = idDerivado(
            new Map([
                ['NAS-IP-Address', '127.0.0.1'],
                ['Acct-Session-Id', '81a0000f'],
            ]),
        )
        assert.deepEqual(
            encolados.map((r) => r.request_id),
            [esperado, esperado, esperado],
        )
    })

    it('X-Request-Id: FreeRADIUS lo manda en authorize, post-auth y accounting, igual al que deriva aaa', () => {
        const rutas = new Set(ids.map((i) => i.ruta))
        for (const ruta of ['/aaa/authorize', '/aaa/post-auth', '/aaa/accounting']) {
            assert.ok(rutas.has(ruta), `sin peticiones a ${ruta}`)
        }
        for (const { ruta, cabecera, derivado } of ids) {
            assert.match(String(cabecera), /^rad-[0-9a-f]{32}$/, ruta)
            assert.equal(cabecera, derivado, ruta)
        }
    })

    it('accounting sin cola disponible → sin Accounting-Response (el NAS reintenta)', async () => {
        const original = cola.encolar
        cola.encolar = async () => {
            throw new Error('Redis caído')
        }
        try {
            const ok = await radacct(
                'Acct-Status-Type = Start, User-Name = "prueba-activo", NAS-IP-Address = 127.0.0.1, Acct-Session-Id = "81a00010"',
            )
            assert.equal(ok, false)
        } finally {
            cola.encolar = original
        }
    })
})
