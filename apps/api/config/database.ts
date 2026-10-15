import env from '#start/env'
import { defineConfig } from '@adonisjs/lucid'
import pg from 'pg'

/**
 * `bigint` (int8) llega como número: los ids caben de sobra en 2^53.
 * `numeric` (dinero) se deja como string y se maneja con decimal.js.
 */
pg.types.setTypeParser(pg.types.builtins.INT8, (valor) => Number.parseInt(valor, 10))

const dbConfig = defineConfig({
    connection: 'postgres',
    connections: {
        postgres: {
            client: 'pg',
            connection: {
                host: env.get('DB_HOST'),
                port: env.get('DB_PORT'),
                user: env.get('DB_USER'),
                password: env.get('DB_PASSWORD'),
                database: env.get('DB_DATABASE'),
            },
            pool: {
                min: 0,
                max: env.get('DB_POOL_MAX') ?? 10,
            },
            migrations: {
                naturalSort: true,
                paths: ['database/migrations'],
                tableName: 'adonis_schema',
            },
            seeders: {
                paths: ['database/seeders'],
            },
        },
    },
})

export default dbConfig
