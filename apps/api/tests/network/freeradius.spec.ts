import { execFile, spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import { createSocket } from 'node:dgram'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import type { Worker } from 'bullmq'
import { Redis } from 'ioredis'
import env from '#start/env'
import { cifrar } from '#shared/cifrado'
import CambiarEstadoServicio from '#core/actions/cambiar_estado_servicio'
import DesconectarSesion from '#network/sesiones/actions/desconectar_sesion'
import { crearWorkerAccounting } from '#network/sesiones/cola'
import { contextoPrueba, unico } from '#tests/ayudas'
import {
    crearClienteFila,
    crearPlanFila,
    crearRouterFila,
    crearServicioFila,
    redUnica,
} from '#tests/core/fabricas'

/**
 * Tarea 10 de A2: todo el camino RADIUS con FreeRADIUS 3.2 real en Docker y los procesos reales.
 *
 *   radtest / radclient (dentro del contenedor, como el MikroTik)
 *     → FreeRADIUS (config de services/aaa/freeradius) → rlm_rest → services/aaa (proceso)
 *       → Redis vacío → GET /api/v1/internal/aaa/servicio (esta API, Postgres real)
 *     → accounting → BullMQ → worker de sesiones (este proceso) → network.sesiones + eventos
 *   CambiarEstadoServicio / DesconectarSesion → audit.outbox → stream (lo que hace el relay)
 *     → services/coa (proceso) → el mismo FreeRADIUS haciendo de NAS (listen type=coa, 3799)
 *     → CoA-ACK / CoA-NAK / Disconnect-ACK → audit.red y coa.fallido
 *
 * El "NAS" de FreeRADIUS responde NAK a los `User-Name` que empiezan con `nak-` y en el ACK
 * devuelve en `Reply-Message` los atributos que recibió, para comprobar que los decodificó.
 *
 * Requiere Docker y la imagen de `infra/docker-compose.yml`; sin ellos se omite
 * (`AAA_PRUEBAS_DOCKER=0` también la omite). Cómo correrla: `services/aaa/README.md`, "Pruebas".
 */

const exec = promisify(execFile)
const RAIZ = app.makePath('../..')
const CONF = join(RAIZ, 'services/aaa/freeradius')
const IMAGEN =
    readFileSync(join(RAIZ, 'infra/docker-compose.yml'), 'utf8').match(
        /freeradius\/freeradius-server:[0-9.]+/,
    )?.[0] ?? 'freeradius/freeradius-server:3.2.10'

const SECRET_LOCAL = 'secreto-local-de-prueba'
const SECRET_NAS = 'secreto-del-nas-de-prueba'
const NAS_IP = '127.0.0.6'
const PREFIJO = `a2fr-${randomUUID().slice(0, 8)}`
const STREAM = `${PREFIJO}:argos:eventos`

function motivoSinDocker(): string | null {
    if (process.env.AAA_PRUEBAS_DOCKER === '0') return 'AAA_PRUEBAS_DOCKER=0'
    if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) return 'Docker no disponible'
    if (spawnSync('docker', ['image', 'inspect', IMAGEN], { stdio: 'ignore' }).status === 0) return null
    const pull = spawnSync('docker', ['pull', IMAGEN], { stdio: 'ignore', timeout: 180_000 })
    return pull.status === 0 ? null : `no se pudo obtener ${IMAGEN}`
}

const MOTIVO = motivoSinDocker()

/** Virtual server que hace de NAS: recibe CoA y Disconnect en 3799. */
const SITIO_NAS = `
clients nas_coa {
	client cualquiera {
		ipaddr = 0.0.0.0/0
		secret = "${SECRET_NAS}"
		require_message_authenticator = yes
	}
}

listen {
	type = coa
	ipaddr = *
	port = 3799
	virtual_server = nas_coa
	clients = nas_coa
}

server nas_coa {
	recv-coa {
		if (&User-Name =~ /^nak-/) {
			update reply {
				&Error-Cause := Session-Context-Not-Found
			}
			reject
		}
		update reply {
			&Reply-Message := "%{Packet-Type}|%{%{Mikrotik-Rate-Limit}:-}|%{%{Mikrotik-Address-List}:-}|%{%{Filter-Id}:-}|%{Acct-Session-Id}"
		}
		ok
	}
	send-coa {
		ok
	}
}
`

function puertoLibre(tipo: 'tcp' | 'udp'): Promise<number> {
    if (tipo === 'udp') {
        return new Promise((resolver) => {
            const s = createSocket('udp4')
            s.bind(0, '127.0.0.1', () => {
                const { port } = s.address()
                s.close(() => resolver(port))
            })
        })
    }
    return new Promise((resolver) => {
        const s = createServer()
        s.listen(0, '0.0.0.0', () => {
            const { port } = s.address() as AddressInfo
            s.close(() => resolver(port))
        })
    })
}

class Proceso {
    readonly lineas: string[] = []
    readonly hijo: ChildProcess

    constructor(args: string[], entorno: Record<string, string>) {
        this.hijo = spawn(process.execPath, args, {
            cwd: RAIZ,
            env: { ...process.env, ...entorno },
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        createInterface({ input: this.hijo.stdout! }).on('line', (l) => this.lineas.push(l))
        createInterface({ input: this.hijo.stderr! }).on('line', (l) => this.lineas.push(`stderr: ${l}`))
    }

    detener() {
        this.hijo.kill('SIGTERM')
    }
}

async function esperarHasta<T>(
    fn: () => Promise<T | null | undefined | false> | T | null | undefined | false,
    ms = 10_000,
): Promise<T> {
    const limite = Date.now() + ms
    for (;;) {
        const valor = await fn()
        if (valor) return valor
        if (Date.now() > limite) throw new Error(`No se cumplió la condición en ${ms} ms`)
        await new Promise((resolver) => setTimeout(resolver, 50))
    }
}

interface Respuesta {
    tipo: string
    atributos: Record<string, string>
}

function parsearRespuesta(salida: string, tipos: string[]): Respuesta {
    const tipo = tipos.find((t) => salida.includes(`Received ${t}`)) ?? 'sin respuesta'
    const atributos: Record<string, string> = {}
    if (tipo !== 'sin respuesta') {
        const lineas = salida
            .slice(salida.indexOf(`Received ${tipo}`))
            .split('\n')
            .slice(1)
        for (const linea of lineas) {
            const m = /^\t([\w-]+) = "?(.*?)"?$/.exec(linea)
            if (!m) break
            if (m[1] !== 'Message-Authenticator') atributos[m[1]!] = m[2]!
        }
    }
    return { tipo, atributos }
}

test.group('RADIUS de punta a punta con FreeRADIUS en Docker (tarea 10)', (group) => {
    let redis: Redis
    let aaa: Proceso
    let coa: Proceso
    let worker: Worker
    let directorio: string
    let routerId: number
    let planId: number
    let redId: number
    let base: string
    const contenedor = `${PREFIJO}-freeradius`

    // Sin Docker se omite todo el grupo (igual que las pruebas de services/aaa).
    group.tap((t) => {
        if (MOTIVO) t.skip(true, MOTIVO)
    })

    async function enContenedor(comando: string): Promise<string> {
        const r = await exec('docker', ['exec', contenedor, 'sh', '-c', comando], { timeout: 20_000 }).catch(
            (e: { stdout?: string }) => ({ stdout: e.stdout ?? '' }),
        )
        return r.stdout
    }

    async function radtest(usuario: string, clave: string, metodo: 'pap' | 'chap') {
        const salida = await enContenedor(
            `radtest -t ${metodo} '${usuario}' '${clave}' 127.0.0.1 0 '${SECRET_LOCAL}'`,
        )
        return parsearRespuesta(salida, ['Access-Accept', 'Access-Reject'])
    }

    async function radacct(atributos: string): Promise<boolean> {
        const salida = await enContenedor(
            `printf '%s\\n' '${atributos}' | radclient -x -c 1 -r 2 -t 3 127.0.0.1:1813 acct '${SECRET_LOCAL}'`,
        )
        return salida.includes('Received Accounting-Response')
    }

    let ipSiguiente = 10
    async function servicio(estado: string, opciones: { userPpp?: string; clave?: string } = {}) {
        const userPpp = opciones.userPpp ?? unico(`fr-${estado}`)
        const clave = opciones.clave ?? `clave-${estado}`
        const servicioId = await crearServicioFila({
            cliente_id: await crearClienteFila(),
            router_id: routerId,
            plan_id: planId,
            user_ppp: userPpp,
            pass_ppp: cifrar(clave),
            estado,
            ipv6_modo: 'radius_servicio',
        })
        const n = ipSiguiente++
        const ipv4 = `${base}.${n}`
        const enlace = `2001:db8:fa${(n % 256).toString(16)}:1::/64`
        const delegado = `2001:db8:fb${(n % 256).toString(16)}:100::/56`
        await db
            .table('network.ipv4_asignaciones')
            .insert({ servicio_id: servicioId, red_id: redId, ip: `${ipv4}/32` })
        await db.table('network.ipv6_asignaciones').multiInsert([
            { servicio_id: servicioId, prefijo: enlace, tipo: 'enlace' },
            { servicio_id: servicioId, prefijo: delegado, tipo: 'delegacion' },
        ])
        return { servicioId, userPpp, clave, ipv4, enlace, delegado }
    }

    /** Start por radclient como lo manda el MikroTik; espera la fila abierta en network.sesiones. */
    async function iniciarSesion(s: Awaited<ReturnType<typeof servicio>>) {
        const acct = unico('81a0')
        assert(
            await radacct(
                `Acct-Status-Type = Start, User-Name = "${s.userPpp}", NAS-IP-Address = ${NAS_IP}, ` +
                    `Acct-Session-Id = "${acct}", Framed-IP-Address = ${s.ipv4}, Framed-IPv6-Prefix = ${s.enlace}`,
            ),
        )
        const fila = await esperarHasta(() =>
            db.from('network.sesiones').where('acct_session_id', acct).whereNull('fin').select('id').first(),
        )
        return { acct, sesionId: Number(fila.id) }
    }

    function assert(valor: boolean, mensaje = 'radclient sin Accounting-Response'): asserts valor {
        if (!valor) throw new Error(mensaje)
    }

    /** Lo que hace el relay de A1: publica las filas nuevas del outbox en el stream de la prueba. */
    async function relayar(desdeId: number): Promise<number[]> {
        const filas = (await db
            .from('audit.outbox')
            .whereIn('evento', [
                'servicio.estado_cambiado',
                'servicio.config_cambiada',
                'sesion.desconexion_solicitada',
            ])
            .where('id', '>', desdeId)
            .orderBy('id')) as Array<{
            id: number
            evento: string
            payload: unknown
            request_id: string | null
        }>
        for (const f of filas) {
            await redis.xadd(
                STREAM,
                '*',
                'id',
                String(f.id),
                'evento',
                f.evento,
                'payload',
                JSON.stringify(f.payload),
                'request_id',
                f.request_id ?? '',
            )
        }
        return filas.map((f) => Number(f.id))
    }

    async function ultimoOutbox(): Promise<number> {
        const fila = (await db.from('audit.outbox').max('id as id').first()) as { id: number | null }
        return Number(fila.id ?? 0)
    }

    async function respuestaFinal(eventoId: number) {
        return esperarHasta(async () => {
            const filas = await db
                .from('audit.red')
                .whereRaw(`comando->>'evento_id' = ?`, [String(eventoId)])
                .orderBy('id')
                .select('tipo', 'servicio_id', 'comando', 'respuesta', 'ok')
            const final = filas.find((f) => f.respuesta.final === true)
            return final ? { final, filas } : null
        })
    }

    group.setup(async () => {
        if (MOTIVO) return () => {}
        redis = new Redis({ host: env.get('REDIS_HOST') ?? '127.0.0.1', port: env.get('REDIS_PORT') ?? 6379 })

        routerId = await crearRouterFila({ nas_ip: NAS_IP, radius_secret: cifrar(SECRET_NAS) })
        planId = await crearPlanFila({
            subida_kbps: 5120,
            bajada_kbps: 20480,
            subida_limitada_kbps: 1024,
            bajada_limitada_kbps: 2048,
        })
        const cidr = redUnica()
        base = cidr.replace('.0/24', '')
        const [red] = (await db
            .table('network.redes_ipv4')
            .insert({ router_id: routerId, cidr, gateway: `${base}.1`, tipo: 'estatico' })
            .returning('id')) as Array<{ id: number }>
        redId = red!.id

        // aaa como proceso: Redis con prefijo propio (vacío) y respaldo a esta API
        const puertoAaa = await puertoLibre('tcp')
        aaa = new Proceso(['services/aaa/src/index.ts'], {
            NODE_ENV: 'development',
            PORT: String(puertoAaa),
            HOST: '0.0.0.0',
            LOG_LEVEL: 'info',
            REDIS_HOST: env.get('REDIS_HOST') ?? '127.0.0.1',
            REDIS_PORT: String(env.get('REDIS_PORT') ?? 6379),
            REDIS_DB: '0',
            AAA_REDIS_PREFIJO: `${PREFIJO}:aaa:user:`,
            AAA_RESPALDO: 'api',
            API_INTERNAL_URL: `http://127.0.0.1:${env.get('PORT')}/api/v1/`,
            AAA_INTERNAL_TOKEN: env.get('INTERNAL_TOKEN'),
            AAA_API_TIMEOUT_MS: '2000',
            AAA_PPP_KEY: env.get('AAA_PPP_KEY') ?? '',
            COLAS_PREFIJO: PREFIJO,
        })
        await esperarHasta(() => aaa.lineas.some((l) => l.includes('aaa listo')), 15_000)

        worker = crearWorkerAccounting({ prefijo: PREFIJO, concurrencia: 1 })

        // FreeRADIUS con la config del repo + el sitio que hace de NAS (CoA en 3799)
        directorio = mkdtempSync(join(tmpdir(), `${PREFIJO}-`))
        cpSync(join(CONF, 'sites-enabled'), join(directorio, 'sites-enabled'), { recursive: true })
        writeFileSync(join(directorio, 'sites-enabled', 'nas_coa'), SITIO_NAS)
        const puertoCoa = await puertoLibre('udp')
        await exec('docker', [
            'run',
            '-d',
            '--name',
            contenedor,
            '--add-host',
            'host.docker.internal:host-gateway',
            '-p',
            `${NAS_IP}:${puertoCoa}:3799/udp`,
            '-e',
            `AAA_URL=http://host.docker.internal:${puertoAaa}`,
            '-e',
            `RADIUS_LOCAL_SECRET=${SECRET_LOCAL}`,
            '-e',
            'RADIUS_LAB_NAS_IP=192.0.2.250',
            '-e',
            'RADIUS_LAB_SECRET=secreto-lab-de-prueba',
            '-v',
            `${CONF}/mods-enabled:/etc/freeradius/mods-enabled:ro`,
            '-v',
            `${directorio}/sites-enabled:/etc/freeradius/sites-enabled:ro`,
            '-v',
            `${CONF}/clients.conf:/etc/freeradius/clients.conf:ro`,
            '-v',
            `${CONF}/clients.d:/etc/freeradius/clients.d:ro`,
            IMAGEN,
            '-f',
            '-l',
            'stdout',
        ])
        const listo = async () => {
            const salida = await enContenedor(
                `echo 'Message-Authenticator = 0x00' | radclient -x -c 1 -r 1 -t 1 127.0.0.1:1812 status '${SECRET_LOCAL}'`,
            )
            return salida.includes('Received Access-Accept')
        }
        await esperarHasta(listo, 30_000).catch(async (error) => {
            const { stdout } = await exec('docker', ['logs', contenedor]).catch(() => ({ stdout: '' }))
            throw new Error(`FreeRADIUS no arrancó: ${(error as Error).message}\n${stdout.slice(-2000)}`)
        })

        coa = new Proceso(['services/coa/src/index.ts'], {
            PORT: '0',
            HOST: '127.0.0.1',
            LOG_LEVEL: 'info',
            REDIS_HOST: env.get('REDIS_HOST') ?? '127.0.0.1',
            REDIS_PORT: String(env.get('REDIS_PORT') ?? 6379),
            COA_STREAM: STREAM,
            COA_GRUPO_INICIO: '0',
            DB_HOST: env.get('DB_HOST'),
            DB_PORT: String(env.get('DB_PORT')),
            DB_USER: env.get('DB_USER'),
            DB_PASSWORD: env.get('DB_PASSWORD') ?? '',
            DB_DATABASE: env.get('DB_DATABASE'),
            AAA_PPP_KEY: env.get('AAA_PPP_KEY') ?? '',
            COA_NAS_PORT: String(puertoCoa),
            COA_TIMEOUT_MS: '1000',
            COA_REINTENTOS: '1',
            COA_ESPERA_MS: '100',
        })
        await esperarHasta(() => coa.lineas.some((l) => l.includes('coa escuchando')))

        return async () => {
            coa?.detener()
            aaa?.detener()
            await worker?.close()
            await exec('docker', ['rm', '-f', contenedor]).catch(() => {})
            rmSync(directorio, { recursive: true, force: true })
            const claves = await redis.keys(`${PREFIJO}:*`)
            if (claves.length > 0) await redis.del(...claves)
            redis.disconnect()
        }
    })

    test('authorize PAP y CHAP: activo, limitado, suspendido, retirado e inexistente (respaldo a la API)', async ({
        assert: a,
    }) => {
        const activo = await servicio('activo')
        const limitado = await servicio('limitado')
        const suspendido = await servicio('suspendido')
        const retirado = await servicio('retirado')

        for (const metodo of ['pap', 'chap'] as const) {
            a.deepEqual(await radtest(activo.userPpp, activo.clave, metodo), {
                tipo: 'Access-Accept',
                atributos: {
                    'Mikrotik-Rate-Limit': '5120k/20480k',
                    'Framed-IP-Address': activo.ipv4,
                    'Framed-IPv6-Prefix': activo.enlace,
                    'Delegated-IPv6-Prefix': activo.delegado,
                    'Acct-Interim-Interval': '300',
                },
            })
            a.deepEqual(await radtest(limitado.userPpp, limitado.clave, metodo), {
                tipo: 'Access-Accept',
                atributos: {
                    'Mikrotik-Rate-Limit': '1024k/2048k',
                    'Framed-IP-Address': limitado.ipv4,
                    'Framed-IPv6-Prefix': limitado.enlace,
                    'Delegated-IPv6-Prefix': limitado.delegado,
                    'Acct-Interim-Interval': '300',
                },
            })
            a.deepEqual(await radtest(suspendido.userPpp, suspendido.clave, metodo), {
                tipo: 'Access-Accept',
                atributos: {
                    'Mikrotik-Rate-Limit': '256k/256k',
                    'Mikrotik-Group': 'suspendido',
                    'Mikrotik-Address-List': 'suspendidos',
                    'Filter-Id': 'argos-corte.in',
                    'Framed-IP-Address': suspendido.ipv4,
                    'Framed-IPv6-Prefix': suspendido.enlace,
                    'Delegated-IPv6-Prefix': suspendido.delegado,
                    'Acct-Interim-Interval': '300',
                },
            })
            a.deepEqual(await radtest(retirado.userPpp, retirado.clave, metodo), {
                tipo: 'Access-Reject',
                atributos: {},
            })
            const inexistente = await radtest(unico('fr-no-existe'), 'x', metodo)
            a.equal(inexistente.tipo, 'Access-Reject')
            const claveMala = await radtest(activo.userPpp, 'clave-mala', metodo)
            a.equal(claveMala.tipo, 'Access-Reject')
        }
        // el respaldo dejó la autorización en Redis sin TTL (la invalida A1 por evento)
        a.equal(await redis.ttl(`${PREFIJO}:aaa:user:${activo.userPpp}`), -1)
    })

    test('accounting Start / Interim-Update / Stop → network.sesiones, eventos y auditoría', async ({
        assert: a,
    }) => {
        const s = await servicio('activo')
        const { acct, sesionId } = await iniciarSesion(s)
        const comunes = `User-Name = "${s.userPpp}", NAS-IP-Address = ${NAS_IP}, Acct-Session-Id = "${acct}"`
        assert(
            await radacct(
                `Acct-Status-Type = Interim-Update, ${comunes}, Acct-Input-Octets = 1000, Acct-Output-Octets = 5000, ` +
                    'Acct-Output-Gigawords = 1, Acct-Session-Time = 300',
            ),
        )
        await esperarHasta(async () => {
            const f = await db.from('network.sesiones').where('id', sesionId).select('bytes_in').first()
            return Number(f.bytes_in) === 1000
        })
        assert(
            await radacct(
                `Acct-Status-Type = Stop, ${comunes}, Acct-Input-Octets = 2000, Acct-Output-Octets = 9000, ` +
                    'Acct-Session-Time = 600, Acct-Terminate-Cause = User-Request',
            ),
        )
        const fila = await esperarHasta(() =>
            db
                .from('network.sesiones')
                .where('id', sesionId)
                .whereNotNull('fin')
                .select(
                    '*',
                    db.raw('host(ipv4) AS ipv4_txt'),
                    db.raw('prefijo_enlace_v6::text AS enlace'),
                    db.raw('prefijo_delegado_v6::text AS delegado'),
                )
                .first(),
        )
        a.equal(Number(fila.servicio_id), s.servicioId)
        a.equal(Number(fila.router_id), routerId)
        a.equal(fila.ipv4_txt, s.ipv4)
        a.equal(fila.enlace, s.enlace)
        a.equal(fila.delegado, s.delegado, 'el /56 sale de la asignación (RouterOS no lo manda)')
        a.equal(String(fila.bytes_in), '2000')
        a.equal(String(fila.bytes_out), String(4_294_967_296 + 5000), 'gigawords del Interim, GREATEST')
        a.equal(fila.causa_fin, 'User-Request')

        const eventos = await db
            .from('audit.outbox')
            .whereIn('evento', ['sesion.iniciada', 'sesion.terminada'])
            .whereRaw(`payload->>'acct_session_id' = ?`, [acct])
            .orderBy('id')
            .select('evento', 'payload')
        a.deepEqual(
            eventos.map((e) => e.evento),
            ['sesion.iniciada', 'sesion.terminada'],
        )
        a.deepEqual(eventos[1].payload, {
            servicio_id: s.servicioId,
            nas_ip: NAS_IP,
            acct_session_id: acct,
            ipv4: s.ipv4,
            prefijos_v6: [s.enlace, s.delegado],
        })
        const acciones = await db
            .from('audit.acciones')
            .where('entidad_tipo', 'sesion')
            .where('entidad_id', sesionId)
            .orderBy('id')
            .select('accion')
        a.deepEqual(
            acciones.map((x) => x.accion),
            ['sesiones.iniciar', 'sesiones.terminar'],
            'el Interim que solo actualiza contadores no se audita',
        )
    })

    test('suspender → CoA-ACK del NAS con el perfil de corte; reactivar → Disconnect-ACK', async ({
        assert: a,
    }) => {
        const s = await servicio('activo')
        const { acct } = await iniciarSesion(s)

        let desde = await ultimoOutbox()
        await new CambiarEstadoServicio().execute(
            { servicioId: s.servicioId, nuevo: 'suspendido', motivo: 'prueba freeradius' },
            contextoPrueba(),
        )
        const [suspender] = await relayar(desde)
        const inicio = Date.now()
        const { final } = await respuestaFinal(suspender!)
        a.isBelow(Date.now() - inicio, 5000)
        a.equal(final.tipo, 'coa')
        a.isTrue(final.ok)
        a.equal(final.respuesta.codigo, 'CoA-ACK')
        // el NAS (FreeRADIUS) decodificó los atributos y la firma con el secret del router
        a.equal(
            final.respuesta.atributos['Reply-Message'],
            `CoA-Request|256k/256k|suspendidos|argos-corte.in|${acct}`,
        )

        desde = await ultimoOutbox()
        await new CambiarEstadoServicio().execute(
            { servicioId: s.servicioId, nuevo: 'activo', motivo: 'pago' },
            contextoPrueba(),
        )
        const [reactivar] = await relayar(desde)
        const r = await respuestaFinal(reactivar!)
        a.equal(r.final.tipo, 'disconnect')
        a.isTrue(r.final.ok)
        a.equal(r.final.respuesta.codigo, 'Disconnect-ACK')
        a.equal(r.final.respuesta.atributos['Reply-Message'], `Disconnect-Request||||${acct}`)
    })

    test('CoA-NAK del NAS (Session-Context-Not-Found) → audit.red y coa.fallido', async ({ assert: a }) => {
        const s = await servicio('activo', { userPpp: unico('nak-fr') })
        await iniciarSesion(s)
        const desde = await ultimoOutbox()
        await new CambiarEstadoServicio().execute(
            { servicioId: s.servicioId, nuevo: 'limitado', motivo: 'mora' },
            contextoPrueba(),
        )
        const [limitar] = await relayar(desde)
        const { final, filas } = await respuestaFinal(limitar!)
        a.lengthOf(filas, 1, 'un NAK no se reintenta')
        a.isFalse(final.ok)
        a.equal(final.respuesta.codigo, 'CoA-NAK')
        a.equal(final.respuesta.atributos['Error-Cause'], 'Session-Context-Not-Found')
        a.equal(final.comando.atributos['Mikrotik-Rate-Limit'], '1024k/2048k')
        const fallido = await esperarHasta(() =>
            db
                .from('audit.outbox')
                .where('evento', 'coa.fallido')
                .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [s.servicioId])
                .first(),
        )
        a.deepEqual(fallido.payload, {
            servicio_id: s.servicioId,
            nas_ip: NAS_IP,
            tipo: 'coa',
            error: 'CoA-NAK: Session-Context-Not-Found',
        })
    })

    test('desconexión manual → Disconnect-ACK del NAS; el Stop cierra la sesión', async ({ assert: a }) => {
        const s = await servicio('activo')
        const { acct, sesionId } = await iniciarSesion(s)
        const desde = await ultimoOutbox()
        await new DesconectarSesion().execute({ id: sesionId, motivo: 'cambio de CPE' }, contextoPrueba())
        const [evento] = await relayar(desde)
        const { final } = await respuestaFinal(evento!)
        a.equal(final.tipo, 'disconnect')
        a.isTrue(final.ok)
        a.equal(final.respuesta.codigo, 'Disconnect-ACK')
        a.equal(final.comando.razon, 'manual: cambio de CPE')
        a.equal(final.respuesta.atributos['Reply-Message'], `Disconnect-Request||||${acct}`)

        // el MikroTik manda el Stop al cortar
        assert(
            await radacct(
                `Acct-Status-Type = Stop, User-Name = "${s.userPpp}", NAS-IP-Address = ${NAS_IP}, ` +
                    `Acct-Session-Id = "${acct}", Acct-Session-Time = 30, Acct-Terminate-Cause = Admin-Reset`,
            ),
        )
        const cerrada = await esperarHasta(() =>
            db.from('network.sesiones').where('id', sesionId).whereNotNull('fin').first(),
        )
        a.equal(cerrada.causa_fin, 'Admin-Reset')
    })
})
