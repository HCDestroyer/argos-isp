import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import pg from 'pg'
import { cifrar } from '../src/cifrado.ts'
import { ConsumidorClientes } from '../src/clientes/consumidor.ts'
import { escribirClientes, leerRouters, type RouterRadius } from '../src/clientes/generar.ts'
import { avisarRecarga, FIFO_RECARGA } from '../src/clientes/recarga.ts'
import { CLAVE, redisDePrueba } from './ayudas.ts'
import { CONF, exec, IMAGEN_FREERADIUS, motivoSinDocker } from './docker.ts'

/**
 * Clientes de FreeRADIUS por evento (`contratos/conexion-routers.md` §6.4): un router que se
 * registra por el túnel WireGuard cambia su `nas_ip` a la IP del túnel; con
 * `router.conexion_registrada` (y `_rotada`, `_eliminada`) `aaa` regenera `clients.d` y avisa a
 * FreeRADIUS por el FIFO, y `freeradius/recargar.sh` lo reinicia con los clientes nuevos.
 */

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function hasta<T>(fn: () => Promise<T | null | false>, ms = 10_000): Promise<T> {
    const limite = Date.now() + ms
    for (;;) {
        const v = await fn()
        if (v) return v
        if (Date.now() > limite) throw new Error('tiempo agotado')
        await esperar(100)
    }
}

/** Lector del FIFO como el de `recargar.sh` (lo abre en lectura y escritura): junta las líneas. */
function lectorFifo(dir: string) {
    const lineas: string[] = []
    const hijo = spawn('sh', ['-c', `exec 3<> "$1"; exec cat <&3`, 'lector', join(dir, FIFO_RECARGA)])
    hijo.stdout.setEncoding('utf8')
    hijo.stdout.on('data', (t: string) => lineas.push(...t.split('\n').filter(Boolean)))
    return { lineas, cerrar: async () => void hijo.kill() }
}

describe('clientes RADIUS por evento (Redis + Postgres reales)', () => {
    const redis = redisDePrueba()
    const pool = new pg.Pool({
        host: process.env.DB_HOST ?? '127.0.0.1',
        port: Number(process.env.DB_PORT ?? 5432),
        user: process.env.DB_USER ?? 'argosisp',
        password: process.env.DB_PASSWORD ?? 'argosisp',
        database: process.env.AAA_PRUEBAS_DB ?? 'argosisp_test_a2',
        max: 2,
        connectionTimeoutMillis: 2000,
    })
    const stream = `prueba-a2-eventos-${randomBytes(4).toString('hex')}`
    const n = (parseInt(randomBytes(1).toString('hex'), 16) % 200) + 20
    const NAS_VIEJA = `198.51.100.${n}`
    const IP_TUNEL = `10.255.${n}.2`
    let motivo: string | null = null
    let dir = ''
    let routerId = 0
    let consumidor: ConsumidorClientes
    let lector: ReturnType<typeof lectorFifo>
    const recargas: string[] = []

    before(async () => {
        try {
            const { rows } = await pool.query<{ t: string | null }>(
                "SELECT to_regclass('network.routers') AS t",
            )
            if (!rows[0]?.t) motivo = 'network.routers no existe (migra la base de pruebas de A2)'
        } catch (e) {
            motivo = `sin Postgres de pruebas: ${(e as Error).message}`
        }
        if (motivo) return
        dir = await mkdtemp(join(tmpdir(), 'a2-clientes-ev-'))
        const { rows } = await pool.query<{ id: string }>(
            `INSERT INTO network.routers (nombre, host, nas_ip, radius_secret, modo_seguridad, activo)
             VALUES ($1, 'router.example', $2, $3, 'radius', true) RETURNING id`,
            [`a2-tunel-${stream}`, NAS_VIEJA, cifrar('secreto-del-tunel-1', CLAVE)],
        )
        routerId = Number(rows[0]?.id)
        consumidor = new ConsumidorClientes({
            redis,
            stream,
            grupo: 'radius-clientes:prueba',
            consumidor: 'prueba',
            bloqueoMs: 200,
            // Solo el router de la prueba (la base la comparten otras suites de A2).
            regenerar: async () =>
                escribirClientes({
                    routers: (await leerRouters(pool)).filter((r) => r.id === routerId),
                    clave: CLAVE,
                    dir,
                }),
            recargar: async (m) => {
                recargas.push(m)
                return avisarRecarga(dir, m)
            },
            log: { info: () => {}, warn: () => {}, error: () => {} },
        })
    })

    after(async () => {
        await consumidor?.detener()
        await lector?.cerrar()
        if (routerId) await pool.query('DELETE FROM network.routers WHERE id = $1', [routerId])
        await redis.del(stream)
        redis.disconnect()
        await pool.end()
        if (dir) await rm(dir, { recursive: true, force: true })
    })

    const archivo = () => readFile(join(dir, `router-${routerId}.conf`), 'utf8').catch(() => null)
    const publicar = (evento: string) =>
        redis.xadd(
            stream,
            '*',
            'id',
            String(Date.now()),
            'evento',
            evento,
            'payload',
            JSON.stringify({ router_id: routerId, empresa_id: 1, ip_tunel: IP_TUNEL }),
            'request_id',
            '',
        )

    it('al arrancar regenera; sin lector del FIFO avisa sin_lector', async (t) => {
        if (motivo) return t.skip(motivo)
        assert.equal(await avisarRecarga(dir, 'prueba'), 'sin_lector')
        await consumidor.iniciar()
        const texto = await hasta(archivo)
        assert.match(texto, new RegExp(`ipaddr = ${NAS_VIEJA.replaceAll('.', '\\.')}$`, 'm'))
        assert.deepEqual(recargas, ['arranque'])
    })

    it('router.conexion_registrada: el nas_ip del túnel entra, el viejo sale y FreeRADIUS recibe el aviso', async (t) => {
        if (motivo) return t.skip(motivo)
        lector = lectorFifo(dir)
        await esperar(200)
        // Lo que hace A1 al registrar (`registro.ts`): nas_ip = ip_tunel, en la misma transacción que el evento.
        await pool.query('UPDATE network.routers SET nas_ip = $1 WHERE id = $2', [IP_TUNEL, routerId])
        await publicar('router.conexion_registrada')
        const texto = await hasta(async () => {
            const a = await archivo()
            return a?.includes(IP_TUNEL) ? a : null
        })
        assert.match(texto, new RegExp(`^\\tipaddr = ${IP_TUNEL.replaceAll('.', '\\.')}$`, 'm'))
        assert.doesNotMatch(texto, new RegExp(NAS_VIEJA.replaceAll('.', '\\.')))
        await hasta(async () => lector.lineas.length > 0)
        assert.match(lector.lineas[0]!, / router\.conexion_registrada$/)
        assert.deepEqual(await redis.xpending(stream, 'radius-clientes:prueba'), [0, null, null, null])
    })

    it('router.conexion_rotada sin cambios en nas_ip ni secret: no recarga; otro evento del stream se ignora', async (t) => {
        if (motivo) return t.skip(motivo)
        const antes = recargas.length
        await publicar('router.conexion_rotada')
        await publicar('servicio.creado')
        await hasta(async () => {
            const [pendientes] = (await redis.xpending(stream, 'radius-clientes:prueba')) as [number]
            const info = (await redis.xinfo('GROUPS', stream)) as unknown[][]
            const leidos = Number((info[0] as unknown[])[(info[0] as unknown[]).indexOf('entries-read') + 1])
            return pendientes === 0 && leidos >= 3
        })
        assert.equal(recargas.length, antes)
    })

    it('router.conexion_eliminada (router desactivado): su cliente sale y se recarga', async (t) => {
        if (motivo) return t.skip(motivo)
        await pool.query('UPDATE network.routers SET activo = false WHERE id = $1', [routerId])
        await publicar('router.conexion_eliminada')
        await hasta(async () => (await archivo()) === null)
        assert.deepEqual(
            (await readdir(dir)).filter((a) => a.endsWith('.conf')),
            [],
        )
        await hasta(async () => lector.lineas.some((l) => l.endsWith('router.conexion_eliminada')))
    })
})

describe(
    'FreeRADIUS en Docker con recargar.sh: el cliente nuevo responde sin reiniciar el contenedor',
    {
        skip: motivoSinDocker() ?? false,
    },
    () => {
        const contenedor = `a2-freeradius-recarga-${randomBytes(3).toString('hex')}`
        const SECRET_LOCAL = 'secreto-local-de-prueba'
        const SECRET_ROUTER = 'secreto-del-router-tunel'
        let dir = ''
        let ipPropia = ''
        // rlm_rest abre una conexión a aaa al instanciar: basta un servidor HTTP que responda.
        let aaaFalso: Server

        /** Status-Server desde la IP del contenedor hacia sí mismo: FreeRADIUS lo ve venir de `ipPropia`. */
        async function responde(): Promise<boolean> {
            const r = await exec(
                'docker',
                [
                    'exec',
                    contenedor,
                    'sh',
                    '-c',
                    `echo 'Message-Authenticator = 0x00' | radclient -c 1 -r 1 -t 1 ${ipPropia}:1812 status ${SECRET_ROUTER}`,
                ],
                { timeout: 10_000 },
            ).catch((e: { stdout?: string }) => ({ stdout: e.stdout ?? '' }))
            return /Received Access-Accept/.test(r.stdout)
        }

        const router = (nas_ip: string): RouterRadius => ({
            id: 7,
            nombre: 'tunel',
            nas_ip,
            radius_secret: cifrar(SECRET_ROUTER, CLAVE),
        })

        before(async () => {
            aaaFalso = createServer((_req, res) => res.writeHead(204).end())
            await new Promise<void>((r) => aaaFalso.listen(0, '0.0.0.0', r))
            const puerto = (aaaFalso.address() as AddressInfo).port
            dir = await mkdtemp(join(tmpdir(), 'a2-recarga-'))
            await escribirClientes({ routers: [router('198.51.100.7')], clave: CLAVE, dir })
            // El FIFO lo crea aaa (el volumen es de solo lectura para FreeRADIUS).
            assert.equal(await avisarRecarga(dir, 'antes'), 'sin_lector')
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
                `RADIUS_LOCAL_SECRET=${SECRET_LOCAL}`,
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
                `${CONF}/recargar.sh:/usr/local/bin/argosisp-recargar:ro`,
                '-v',
                `${dir}:/etc/freeradius/clients.d:ro`,
                '--entrypoint',
                '/usr/local/bin/argosisp-recargar',
                IMAGEN_FREERADIUS,
                '-l',
                'stdout',
            ])
            ipPropia = (
                await exec('docker', [
                    'inspect',
                    '-f',
                    '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
                    contenedor,
                ])
            ).stdout.trim()
            assert.match(ipPropia, /^\d+\.\d+\.\d+\.\d+$/)
            // Listo cuando responde al cliente localhost.
            await hasta(async () => {
                const r = await exec(
                    'docker',
                    [
                        'exec',
                        contenedor,
                        'sh',
                        '-c',
                        `echo 'Message-Authenticator = 0x00' | radclient -q -c 1 -r 1 -t 1 127.0.0.1:1812 status ${SECRET_LOCAL}`,
                    ],
                    { timeout: 5000 },
                ).then(
                    () => true,
                    () => false,
                )
                return r
            }, 30_000)
        })

        after(async () => {
            await exec('docker', ['rm', '-f', contenedor]).catch(() => {})
            await new Promise((r) => aaaFalso?.close(r))
            if (dir) await rm(dir, { recursive: true, force: true })
        })

        it('antes del aviso el nas_ip nuevo no es cliente; después del aviso sí, y el viejo ya no está', async () => {
            assert.equal(await responde(), false, 'la IP del túnel todavía no es cliente')
            const r = await escribirClientes({ routers: [router(ipPropia)], clave: CLAVE, dir })
            assert.deepEqual(r.escritos, ['router-7.conf'])
            // Sin aviso, FreeRADIUS sigue con los clientes viejos (los lee solo al arrancar).
            assert.equal(await responde(), false)
            assert.equal(await avisarRecarga(dir, 'router.conexion_registrada'), 'avisado')
            await hasta(responde, 30_000)
            const { stdout } = await exec('docker', [
                'exec',
                contenedor,
                'cat',
                '/etc/freeradius/clients.d/router-7.conf',
            ])
            assert.doesNotMatch(stdout, /198\.51\.100\.7/)
            const logs = await exec('docker', ['logs', contenedor])
            assert.match(logs.stderr + logs.stdout, /recargando clientes \(router\.conexion_registrada\)/)
            const estado = await exec('docker', [
                'inspect',
                '-f',
                '{{.RestartCount}} {{.State.Running}}',
                contenedor,
            ])
            assert.equal(estado.stdout.trim(), '0 true', 'se reinició radiusd, no el contenedor')
        })

        it('una configuración inválida no tumba a radiusd: sigue con la anterior', async () => {
            // Cliente con la misma IP que mikrotik-lab de clients.conf: FreeRADIUS no arranca con eso.
            await escribirClientes({ routers: [router('192.0.2.250')], clave: CLAVE, dir })
            assert.equal(await avisarRecarga(dir, 'prueba-invalida'), 'avisado')
            await hasta(async () => {
                const logs = await exec('docker', ['logs', contenedor])
                return /configuración inválida/.test(logs.stderr + logs.stdout)
            }, 30_000)
            assert.equal(await responde(), true, 'sigue el cliente cargado antes')
        })
    },
)
