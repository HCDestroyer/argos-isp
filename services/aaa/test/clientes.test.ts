import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import pg from 'pg'
import { cifrar } from '../src/cifrado.ts'
import {
    escribirClientes,
    huboCambio,
    leerRouters,
    renderCliente,
    type RouterRadius,
} from '../src/clientes/generar.ts'
import { CLAVE } from './ayudas.ts'
import { CONF, exec, IMAGEN_FREERADIUS, motivoSinDocker } from './docker.ts'

const router = (id: number, nas_ip: string, secret: string | null, nombre = `r${id}`): RouterRadius => ({
    id,
    nombre,
    nas_ip,
    radius_secret: secret === null ? null : cifrar(secret, CLAVE),
})

describe('aaa:clients · generación', () => {
    let dir = ''

    before(async () => {
        dir = await mkdtemp(join(tmpdir(), 'a2-clients-'))
    })

    after(async () => {
        await rm(dir, { recursive: true, force: true })
    })

    it('renderiza un cliente con el secret escapado y Message-Authenticator obligatorio', () => {
        const texto = renderCliente(
            { id: 7, nombre: 'Torre "Norte"\n', nas_ip: '192.0.2.7', radius_secret: null },
            'se"cr\\eto-largo',
        )
        assert.match(texto, /^client router-7 \{$/m)
        assert.match(texto, /^\tipaddr = 192\.0\.2\.7$/m)
        assert.match(texto, /^\tsecret = "se\\"cr\\\\eto-largo"$/m)
        assert.match(texto, /^\trequire_message_authenticator = yes$/m)
        assert.doesNotMatch(texto, /Norte"\n/, 'el nombre no rompe el comentario')
    })

    it('rechaza IPs inválidas y secrets cortos o con saltos de línea', () => {
        const r = { id: 1, nombre: 'x', nas_ip: '192.0.2.1', radius_secret: null }
        assert.throws(() => renderCliente({ ...r, nas_ip: '192.0.2.1/24' }, 'secreto-largo'))
        assert.throws(() => renderCliente(r, 'corto'))
        assert.throws(() => renderCliente(r, 'secreto\nlargo'))
    })

    it('escribe uno por router (0640), omite excluidos y sin secret, borra los obsoletos', async () => {
        await writeFile(join(dir, 'router-99.conf'), 'viejo')
        await writeFile(join(dir, 'otro.conf'), 'no es nuestro')
        const r = await escribirClientes({
            routers: [
                router(1, '192.0.2.1', 'secreto-uno-1234'),
                router(2, '2001:db8::2', 'secreto-dos-1234'),
                router(3, '192.0.2.3', null),
                router(4, '10.255.255.2', 'secreto-lab-1234'),
            ],
            clave: CLAVE,
            dir,
            excluirNasIps: ['10.255.255.2'],
        })
        assert.deepEqual(r.escritos, ['router-1.conf', 'router-2.conf'])
        assert.deepEqual(r.borrados, ['router-99.conf'])
        assert.deepEqual(
            r.omitidos.map((o) => o.id),
            [3, 4],
        )
        assert.deepEqual(r.errores, [])
        assert.deepEqual((await readdir(dir)).sort(), ['otro.conf', 'router-1.conf', 'router-2.conf'])
        assert.equal((await stat(join(dir, 'router-1.conf'))).mode & 0o777, 0o640)
        assert.match(await readFile(join(dir, 'router-2.conf'), 'utf8'), /secret = "secreto-dos-1234"/)
    })

    it('un archivo con el mismo contenido no se reescribe: sin cambios no hay que recargar', async () => {
        const routers = [
            router(1, '192.0.2.1', 'secreto-uno-1234'),
            router(2, '2001:db8::2', 'secreto-dos-1234'),
        ]
        const antes = (await stat(join(dir, 'router-1.conf'))).mtimeMs
        const r = await escribirClientes({ routers, clave: CLAVE, dir })
        assert.deepEqual(r.escritos, [])
        assert.deepEqual(r.sinCambios, ['router-1.conf', 'router-2.conf'])
        assert.deepEqual(r.borrados, [])
        assert.equal(huboCambio(r), false)
        assert.equal((await stat(join(dir, 'router-1.conf'))).mtimeMs, antes)
        const otro = await escribirClientes({
            routers: [router(1, '10.255.0.2', 'secreto-uno-1234'), routers[1]!],
            clave: CLAVE,
            dir,
        })
        assert.deepEqual(otro.escritos, ['router-1.conf'])
        assert.equal(huboCambio(otro), true)
        assert.match(await readFile(join(dir, 'router-1.conf'), 'utf8'), /ipaddr = 10\.255\.0\.2$/m)
    })

    it('un secret que no descifra es error y conserva el archivo anterior', async () => {
        const malo = { ...router(1, '192.0.2.1', null), radius_secret: cifrar('x', Buffer.alloc(32, 1)) }
        const r = await escribirClientes({ routers: [malo], clave: CLAVE, dir })
        assert.equal(r.errores.length, 1)
        assert.deepEqual(r.borrados, ['router-2.conf'])
        assert.match(await readFile(join(dir, 'router-1.conf'), 'utf8'), /secreto-uno-1234/)
    })

    it('FreeRADIUS acepta clients.conf con los clientes generados (radiusd -XC)', async (t) => {
        const motivo = motivoSinDocker()
        if (motivo) return t.skip(motivo)
        await escribirClientes({
            routers: [
                router(1, '192.0.2.1', 'secreto-uno-1234'),
                router(2, '2001:db8::2', 'secreto-dos-1234'),
            ],
            clave: CLAVE,
            dir,
        })
        await rm(join(dir, 'otro.conf'))
        const { stdout } = await exec('docker', [
            'run',
            '--rm',
            '-e',
            'AAA_URL=http://127.0.0.1:3100',
            '-e',
            'RADIUS_LOCAL_SECRET=prueba-local-secret',
            '-e',
            'RADIUS_LAB_NAS_IP=192.0.2.250',
            '-e',
            'RADIUS_LAB_SECRET=prueba-lab-secret',
            '-v',
            `${CONF}/mods-enabled:/etc/freeradius/mods-enabled:ro`,
            '-v',
            `${CONF}/sites-enabled:/etc/freeradius/sites-enabled:ro`,
            '-v',
            `${CONF}/clients.conf:/etc/freeradius/clients.conf:ro`,
            '-v',
            `${dir}:/etc/freeradius/clients.d:ro`,
            IMAGEN_FREERADIUS,
            'radiusd',
            '-XC',
        ])
        assert.match(stdout, /client router-1 \{/)
        assert.match(stdout, /client router-2 \{/)
        assert.match(stdout, /Configuration appears to be OK/)
    })
})

describe('aaa:clients · lectura de network.routers (Postgres)', () => {
    // Base propia de A2 (no la de CI ni la de otros agentes). Se omite si no existe o no está migrada.
    const pool = new pg.Pool({
        host: process.env.DB_HOST ?? '127.0.0.1',
        port: Number(process.env.DB_PORT ?? 5432),
        user: process.env.DB_USER ?? 'argosisp',
        password: process.env.DB_PASSWORD ?? 'argosisp',
        database: process.env.AAA_PRUEBAS_DB ?? 'argosisp_test_a2',
        max: 2,
        connectionTimeoutMillis: 2000,
    })
    const sufijo = Math.random().toString(16).slice(2, 8)
    const ids: number[] = []
    let motivo: string | null = null

    before(async () => {
        try {
            const { rows } = await pool.query<{ t: string | null }>(
                "SELECT to_regclass('network.routers') AS t",
            )
            if (!rows[0]?.t) motivo = 'network.routers no existe (migra la base de pruebas de A2)'
        } catch (e) {
            motivo = `sin Postgres de pruebas: ${(e as Error).message}`
        }
    })

    after(async () => {
        if (ids.length > 0) await pool.query('DELETE FROM network.routers WHERE id = ANY($1)', [ids])
        await pool.end()
    })

    it('devuelve solo routers activos en modo radius, con nas_ip sin máscara', async (t) => {
        if (motivo) return t.skip(motivo)
        const filas: [string, string, string, boolean][] = [
            ['radius', '198.51.100.', 'radius', true],
            ['api', '198.51.100.', 'api', true],
            ['inactivo', '198.51.100.', 'radius', false],
        ]
        for (const [i, [nombre, red, modo, activo]] of filas.entries()) {
            const { rows } = await pool.query<{ id: string }>(
                `INSERT INTO network.routers (nombre, host, nas_ip, radius_secret, modo_seguridad, activo)
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
                [
                    `a2-${nombre}-${sufijo}`,
                    'router.example',
                    `${red}${(parseInt(sufijo, 16) % 200) + i + 1}`,
                    cifrar('secreto-largo-1', CLAVE),
                    modo,
                    activo,
                ],
            )
            ids.push(Number(rows[0]?.id))
        }
        const propios = (await leerRouters(pool)).filter((r) => ids.includes(r.id))
        assert.equal(propios.length, 1)
        assert.equal(propios[0]?.nombre, `a2-radius-${sufijo}`)
        assert.match(propios[0]?.nas_ip ?? '', /^198\.51\.100\.\d+$/)
    })
})
