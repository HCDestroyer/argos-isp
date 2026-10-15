import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { claveDesdeEntorno } from '../cifrado.ts'
import { escribirClientes, leerRouters } from './generar.ts'

/**
 * `pnpm aaa:clients`: genera `services/aaa/freeradius/clients.d/router-<id>.conf` desde
 * `network.routers`. Variables: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_DATABASE, AAA_PPP_KEY,
 * AAA_CLIENTS_DIR (opcional) y RADIUS_LAB_NAS_IP (cliente fijo de clients.conf, se excluye).
 * Sale con 1 si algún router tiene datos inválidos (su archivo anterior se conserva).
 */

const dir =
    process.env.AAA_CLIENTS_DIR ?? fileURLToPath(new URL('../../freeradius/clients.d', import.meta.url))

const pool = new pg.Pool({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? 'argosisp',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE ?? 'argosisp',
    max: 1,
})

try {
    const clave = claveDesdeEntorno(process.env.AAA_PPP_KEY)
    const routers = await leerRouters(pool)
    const r = await escribirClientes({
        routers,
        clave,
        dir,
        excluirNasIps: process.env.RADIUS_LAB_NAS_IP ? [process.env.RADIUS_LAB_NAS_IP] : [],
    })
    console.log(`clients.d: ${dir}`)
    for (const a of r.escritos) console.log(`  escrito   ${a}`)
    for (const a of r.borrados) console.log(`  borrado   ${a}`)
    for (const o of r.omitidos) console.log(`  omitido   router ${o.id} (${o.nombre}): ${o.motivo}`)
    for (const o of r.errores) console.error(`  ERROR     router ${o.id} (${o.nombre}): ${o.motivo}`)
    console.log(
        'Reinicia FreeRADIUS para cargar los clientes: docker compose -f infra/docker-compose.yml restart freeradius',
    )
    process.exitCode = r.errores.length > 0 ? 1 : 0
} catch (e) {
    console.error(`aaa:clients: ${(e as Error).message}`)
    process.exitCode = 1
} finally {
    await pool.end()
}
