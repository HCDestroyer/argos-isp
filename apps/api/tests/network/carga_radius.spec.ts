import { execFile, spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { loadavg, tmpdir } from 'node:os'
import { createServer, type AddressInfo } from 'node:net'
import { createSocket } from 'node:dgram'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import { Redis } from 'ioredis'
import env from '#start/env'
import { cifrar } from '#shared/cifrado'
import { unico } from '#tests/ayudas'
import {
    crearClienteFila,
    crearPlanFila,
    crearRouterFila,
    crearServicioFila,
    redUnica,
} from '#tests/core/fabricas'

/**
 * Prueba de carga de RADIUS (semana 2, criterio del plan): N reconexiones PPPoE simultáneas
 * dual-stack (por defecto 200) contra FreeRADIUS 3.2 en Docker (config del repo) → rlm_rest →
 * services/aaa (proceso) → Redis o el respaldo `GET /api/v1/internal/aaa/servicio` (esta API,
 * Postgres real), con accounting Stop/Start → BullMQ → worker de sesiones → network.sesiones.
 *
 * Rondas: arranque (Redis vacío, procesos sin calentar) y luego `AAA_CARGA_REPETICIONES` (3) pares
 * de reconexión con Redis vaciado (todo por la API) y con caché caliente. Criterio: cero timeouts
 * ni rechazos en todas; p95 de autorización (mediana de las repeticiones) < 100 ms con caché
 * caliente y < 400 ms con Redis vacío (ver la nota junto a las aserciones). Los generadores (`services/aaa/carga/generador.ts`) firman como RouterOS 7.15+
 * (CHAP + Message-Authenticator) y entran por el cliente `mikrotik-lab` de `clients.conf`.
 *
 * Solo corre con `AAA_CARGA=1` (`pnpm aaa:carga`) y Docker. `AAA_CARGA_CLIENTES` cambia N,
 * `AAA_CARGA_SALIDA` guarda el resultado en JSON.
 */

const exec = promisify(execFile)

/** Entrada y salida JSON de `services/aaa/carga/cli.ts` (tipos de `generador.ts`, fuera de este paquete). */
interface UsuarioCarga {
    user: string
    clave: string
    ipv4: string
    enlace: string
    delegado?: string
    sesionAnterior?: string
}
interface OpcionesCarga {
    host: string
    puertoAuth: number
    puertoAcct: number
    secret: string
    nasIp: string
    usuarios: UsuarioCarga[]
    timeoutMs?: number
}
interface ResultadoCarga {
    clientes: number
    accept: number
    reject: number
    timeoutsAuth: number
    sinDualStack: number
    latenciaMs: { p50: number; p95: number; p99: number; max: number; media: number }
    acct: { start: number; stop: number; timeouts: number }
    duracionMs: number
    sesiones: Record<string, string>
    rechazados: string[]
}
const RAIZ = app.makePath('../..')
const CONF = join(RAIZ, 'services/aaa/freeradius')
const IMAGEN =
    readFileSync(join(RAIZ, 'infra/docker-compose.yml'), 'utf8').match(
        /freeradius\/freeradius-server:[0-9.]+/,
    )?.[0] ?? 'freeradius/freeradius-server:3.2.10'

const CLIENTES = Number(process.env.AAA_CARGA_CLIENTES ?? 200)
const SECRET = 'secreto-de-carga'
const PREFIJO = `a2carga-${randomUUID().slice(0, 8)}`
const P95_MAXIMO_MS = 100
/** Con Redis vacío: la mitad del timeout de rlm_rest (authorize, 0,8 s) */
const P95_FRIA_MAXIMO_MS = 400
/** Pares de rondas (Redis vacío, caché caliente) tras la de arranque */
const REPETICIONES = Number(process.env.AAA_CARGA_REPETICIONES ?? 3)

function mediana(valores: number[]): number {
    const o = [...valores].sort((a, b) => a - b)
    const m = Math.floor(o.length / 2)
    return o.length % 2 ? o[m]! : (o[m - 1]! + o[m]!) / 2
}

function motivoParaOmitir(): string | null {
    if (process.env.AAA_CARGA !== '1') return 'solo con AAA_CARGA=1 (pnpm aaa:carga)'
    if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) return 'Docker no disponible'
    if (spawnSync('docker', ['image', 'inspect', IMAGEN], { stdio: 'ignore' }).status === 0) return null
    const pull = spawnSync('docker', ['pull', IMAGEN], { stdio: 'ignore', timeout: 180_000 })
    return pull.status === 0 ? null : `no se pudo obtener ${IMAGEN}`
}

const MOTIVO = motivoParaOmitir()

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

async function esperarHasta<T>(fn: () => Promise<T | null | undefined | false>, ms: number): Promise<T> {
    const limite = Date.now() + ms
    for (;;) {
        const valor = await fn()
        if (valor) return valor
        if (Date.now() > limite) throw new Error(`No se cumplió la condición en ${ms} ms`)
        await new Promise((resolver) => setTimeout(resolver, 100))
    }
}

function tabla(rondas: Array<{ nombre: string; r: ResultadoCarga }>): string {
    const filas = rondas.map(
        ({ nombre, r }) =>
            `| ${nombre} | ${r.clientes} | ${r.accept} | ${r.reject} | ${r.timeoutsAuth} | ${r.latenciaMs.p50} | ` +
            `${r.latenciaMs.p95} | ${r.latenciaMs.p99} | ${r.latenciaMs.max} | ${r.acct.start}/${r.acct.stop} | ` +
            `${r.acct.timeouts} | ${r.duracionMs} |`,
    )
    return [
        '| Ronda | Clientes | Accept | Reject | Timeouts | p50 ms | p95 ms | p99 ms | máx ms | Start/Stop | Acct sin resp. | Duración ms |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
        ...filas,
    ].join('\n')
}

test.group('Carga RADIUS: reconexiones PPPoE simultáneas dual-stack', (group) => {
    let redis: Redis
    let aaa: ChildProcess
    const lineasAaa: string[] = []
    let worker: ChildProcess
    let routerId: number
    let nasIp: string
    let usuarios: UsuarioCarga[] = []
    let puertoAuth: number
    let puertoAcct: number
    const contenedor = `${PREFIJO}-freeradius`

    group.tap((t) => {
        if (MOTIVO) t.skip(true, MOTIVO)
    })

    group.setup(async () => {
        if (MOTIVO) return () => {}
        redis = new Redis({ host: env.get('REDIS_HOST') ?? '127.0.0.1', port: env.get('REDIS_PORT') ?? 6379 })

        nasIp = `10.254.${Math.floor(Math.random() * 250)}.${2 + Math.floor(Math.random() * 250)}`
        routerId = await crearRouterFila({ nas_ip: nasIp, radius_secret: cifrar(SECRET) })
        const planId = await crearPlanFila({ subida_kbps: 5120, bajada_kbps: 20480 })
        // Cada /24 aloja 250 servicios: tantas redes como hagan falta.
        const redes: Array<{ id: number; base: string }> = []
        for (let i = 0; i < Math.ceil(CLIENTES / 250); i++) {
            const cidr = redUnica()
            const base = cidr.replace('.0/24', '')
            const [red] = (await db
                .table('network.redes_ipv4')
                .insert({ router_id: routerId, cidr, gateway: `${base}.1`, tipo: 'estatico' })
                .returning('id')) as Array<{ id: number }>
            redes.push({ id: red!.id, base })
        }
        const raiz = `2001:db8:${(0xc000 + Math.floor(Math.random() * 0x3fff)).toString(16)}`
        const clienteId = await crearClienteFila()
        for (let i = 0; i < CLIENTES; i++) {
            const userPpp = unico(`carga-${i}`)
            const clave = `clave-${i}`
            const servicioId = await crearServicioFila({
                cliente_id: clienteId,
                router_id: routerId,
                plan_id: planId,
                user_ppp: userPpp,
                pass_ppp: cifrar(clave),
                estado: 'activo',
                ipv6_modo: 'radius_servicio',
            })
            const red = redes[Math.floor(i / 250)]!
            const ipv4 = `${red.base}.${2 + (i % 250)}`
            const enlace = `${raiz}:${(i + 1).toString(16)}::/64`
            const delegado = `${raiz}:${(0x1000 + i * 0x100).toString(16)}::/56`
            await db
                .table('network.ipv4_asignaciones')
                .insert({ servicio_id: servicioId, red_id: red.id, ip: `${ipv4}/32` })
            await db.table('network.ipv6_asignaciones').multiInsert([
                { servicio_id: servicioId, prefijo: enlace, tipo: 'enlace' },
                { servicio_id: servicioId, prefijo: delegado, tipo: 'delegacion' },
            ])
            usuarios.push({ user: userPpp, clave, ipv4, enlace, delegado })
        }

        // aaa como proceso, con los valores por defecto de producción (timeouts de Redis y de la API).
        const puertoAaa = await puertoLibre('tcp')
        aaa = spawn(process.execPath, ['services/aaa/src/index.ts'], {
            cwd: RAIZ,
            env: {
                ...process.env,
                NODE_ENV: 'production',
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
                AAA_PPP_KEY: env.get('AAA_PPP_KEY') ?? '',
                COLAS_PREFIJO: PREFIJO,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        createInterface({ input: aaa.stdout! }).on('line', (l) => lineasAaa.push(l))
        createInterface({ input: aaa.stderr! }).on('line', (l) => lineasAaa.push(`stderr: ${l}`))
        await esperarHasta(async () => {
            const r = await fetch(`http://127.0.0.1:${puertoAaa}/health`).catch(() => null)
            return r?.ok ?? false
        }, 15_000)

        // Worker de sesiones como proceso aparte, igual que en el compose (`sesiones-worker`): en este
        // proceso quedan la API y la prueba.
        worker = spawn(process.execPath, ['ace.js', 'sesiones:worker'], {
            cwd: app.makePath(),
            env: { ...process.env, COLAS_PREFIJO: PREFIJO, LOG_LEVEL: 'warn' },
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        let workerListo = false
        createInterface({ input: worker.stdout! }).on('line', (l) => {
            if (l.includes('escuchando')) workerListo = true
        })
        worker.stderr!.resume()
        await esperarHasta(async () => workerListo, 30_000)

        // FreeRADIUS con la config del repo. El generador corre en el host: entra por el puerto
        // publicado y FreeRADIUS lo ve con la IP del gateway de Docker, que se declara como el
        // cliente `mikrotik-lab` (require_message_authenticator = yes, como el MikroTik real).
        const { stdout: gateway } = await exec('docker', [
            'network',
            'inspect',
            'bridge',
            '-f',
            '{{(index .IPAM.Config 0).Gateway}}',
        ])
        puertoAuth = await puertoLibre('udp')
        puertoAcct = await puertoLibre('udp')
        await exec('docker', [
            'run',
            '-d',
            '--name',
            contenedor,
            '--add-host',
            'host.docker.internal:host-gateway',
            '-p',
            `127.0.0.1:${puertoAuth}:1812/udp`,
            '-p',
            `127.0.0.1:${puertoAcct}:1813/udp`,
            '-e',
            `AAA_URL=http://host.docker.internal:${puertoAaa}`,
            '-e',
            'RADIUS_LOCAL_SECRET=secreto-local-de-carga',
            '-e',
            `RADIUS_LAB_NAS_IP=${gateway.trim()}`,
            '-e',
            `RADIUS_LAB_SECRET=${SECRET}`,
            '-v',
            `${CONF}/mods-enabled:/etc/freeradius/mods-enabled:ro`,
            '-v',
            `${CONF}/sites-enabled:/etc/freeradius/sites-enabled:ro`,
            '-v',
            `${CONF}/clients.conf:/etc/freeradius/clients.conf:ro`,
            '-v',
            `${CONF}/clients.d:/etc/freeradius/clients.d:ro`,
            // Para comparar ajustes del pool de hilos sin tocar la config del repo.
            ...(process.env.AAA_CARGA_RADIUSD
                ? ['-v', `${process.env.AAA_CARGA_RADIUSD}:/etc/freeradius/radiusd.conf:ro`]
                : []),
            IMAGEN,
            '-f',
            '-l',
            'stdout',
        ])
        await esperarHasta(async () => {
            const { stdout } = await exec('docker', ['logs', contenedor]).catch(() => ({ stdout: '' }))
            return stdout.includes('Ready to process requests')
        }, 30_000)

        return async () => {
            await exec('docker', ['rm', '-f', contenedor]).catch(() => {})
            aaa?.kill('SIGTERM')
            if (process.env.AAA_CARGA_LOG) writeFileSync(process.env.AAA_CARGA_LOG, lineasAaa.join('\n'))
            worker?.kill('SIGTERM')
            const claves = await redis.keys(`${PREFIJO}*`)
            if (claves.length > 0) await redis.del(...claves)
            redis.disconnect()
        }
    })

    async function vaciarCache() {
        const claves = await redis.keys(`${PREFIJO}:aaa:user:*`)
        if (claves.length > 0) await redis.del(...claves)
    }

    /** El generador corre en su propio proceso: en este corre la API (respaldo de aaa). */
    async function ronda(anteriores: Record<string, string>): Promise<ResultadoCarga> {
        const opciones: OpcionesCarga = {
            host: '127.0.0.1',
            puertoAuth,
            puertoAcct,
            secret: SECRET,
            nasIp,
            usuarios: usuarios.map((u) => ({ ...u, sesionAnterior: anteriores[u.user] })),
            timeoutMs: 1000,
        }
        const dir = mkdtempSync(join(tmpdir(), `${PREFIJO}-`))
        try {
            writeFileSync(join(dir, 'opciones.json'), JSON.stringify(opciones))
            const { stdout } = await exec(
                process.execPath,
                [join(RAIZ, 'services/aaa/carga/cli.ts'), join(dir, 'opciones.json')],
                { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
            )
            return JSON.parse(stdout) as ResultadoCarga
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    }

    /** El worker terminó: N sesiones abiertas (las de la última ronda) y las anteriores cerradas. */
    async function esperarSesiones(abiertasEsperadas: string[]) {
        return esperarHasta(async () => {
            const abiertas = await db
                .from('network.sesiones')
                .whereRaw('nas_ip = ?::inet', [nasIp])
                .whereNull('fin')
                .select('acct_session_id', 'ipv4', 'prefijo_enlace_v6', 'prefijo_delegado_v6')
            const ids = new Set(abiertas.map((s) => s.acct_session_id as string))
            return abiertas.length === abiertasEsperadas.length && abiertasEsperadas.every((s) => ids.has(s))
                ? abiertas
                : null
        }, 60_000)
    }

    test('N reconexiones simultáneas: cero timeouts; p95 < 100 ms con caché caliente', async ({ assert }) => {
        const rondas: Array<{ nombre: string; tipo: 'arranque' | 'fria' | 'caliente'; r: ResultadoCarga }> =
            []
        let anteriores: Record<string, string> = {}
        let abiertas: Awaited<ReturnType<typeof esperarSesiones>> = []
        const correr = async (nombre: string, tipo: 'arranque' | 'fria' | 'caliente') => {
            if (tipo !== 'caliente') await vaciarCache()
            else {
                const cacheadas = await redis.keys(`${PREFIJO}:aaa:user:*`)
                assert.equal(cacheadas.length, CLIENTES, 'aaa cacheó a todos')
            }
            const r = await ronda(anteriores)
            rondas.push({ nombre, tipo, r })
            abiertas = await esperarSesiones(Object.values(r.sesiones))
            anteriores = r.sesiones
        }

        await correr('Arranque en frío de los procesos, Redis vacío (respaldo API)', 'arranque')
        for (let i = 1; i <= REPETICIONES; i++) {
            await correr(`Reconexión ${i}, Redis vacío (respaldo API)`, 'fria')
            await correr(`Reconexión ${i}, caché caliente`, 'caliente')
        }

        const salida = tabla(rondas)
        const carga = loadavg()
            .map((x) => x.toFixed(1))
            .join(' ')
        console.log(
            `\nCarga RADIUS (${CLIENTES} clientes, FreeRADIUS ${IMAGEN.split(':')[1]}, loadavg ${carga}):\n${salida}\n`,
        )
        if (process.env.AAA_CARGA_SALIDA) {
            writeFileSync(
                process.env.AAA_CARGA_SALIDA,
                JSON.stringify({ clientes: CLIENTES, rondas }, null, 2),
            )
        }

        for (const { nombre, r } of rondas) {
            assert.equal(r.timeoutsAuth, 0, `${nombre}: timeouts de autorización ${r.rechazados.join(', ')}`)
            assert.equal(r.reject, 0, `${nombre}: rechazos`)
            assert.equal(r.accept, CLIENTES, nombre)
            assert.equal(r.sinDualStack, 0, `${nombre}: Accept sin /64 o /56`)
            assert.equal(r.acct.timeouts, 0, `${nombre}: accounting sin respuesta`)
            if (r !== rondas[0]!.r) {
                assert.equal(r.acct.stop, CLIENTES, `${nombre}: Stop de la sesión anterior`)
            }
        }
        // p95: mediana de las repeticiones de cada tipo (la máquina de CI es compartida y una ronda
        // suelta mide también a los vecinos). La ronda de arranque incluye el calentamiento de procesos
        // recién iniciados (JIT, hilos de FreeRADIUS, conexiones de rlm_rest): cuenta para timeouts,
        // no para el p95.
        // Con caché caliente (operación normal: A1 mantiene Redis por evento) el criterio del plan.
        // Con Redis vacío cada autorización consulta la API una por una; su p95 depende de la API
        // (`.claude/integration/a2.md`: consulta por lotes y repoblado de Redis) y aquí se exige solo
        // que quede lejos del timeout de rlm_rest (0,8 s).
        const p95Caliente = mediana(
            rondas.filter((x) => x.tipo === 'caliente').map((x) => x.r.latenciaMs.p95),
        )
        const p95Fria = mediana(rondas.filter((x) => x.tipo === 'fria').map((x) => x.r.latenciaMs.p95))
        assert.isBelow(p95Caliente, P95_MAXIMO_MS, `p95 (mediana) con caché caliente: ${p95Caliente} ms`)
        assert.isBelow(p95Fria, P95_FRIA_MAXIMO_MS, `p95 (mediana) con Redis vacío: ${p95Fria} ms`)
        // network.sesiones: cada sesión abierta trae IPv4, /64 y el /56 de la asignación.
        assert.isTrue(abiertas.every((s) => s.ipv4 && s.prefijo_enlace_v6 && s.prefijo_delegado_v6))
        const cerradas = await db
            .from('network.sesiones')
            .whereRaw('nas_ip = ?::inet', [nasIp])
            .whereNotNull('fin')
            .count('* as n')
            .first()
        assert.equal(Number(cerradas?.n), CLIENTES * (rondas.length - 1))
        assert.notInclude(lineasAaa.join('\n'), 'stderr:')
        assert.notInclude(lineasAaa.join('\n'), 'sin Redis ni respaldo')
    }).timeout(300_000)
})
