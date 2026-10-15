import { assert } from '@japa/assert'
import { apiClient } from '@japa/api-client'
import app from '@adonisjs/core/services/app'
import type { Config } from '@japa/runner/types'
import { pluginAdonisJS } from '@japa/plugin-adonisjs'
import testUtils from '@adonisjs/core/services/test_utils'

/**
 * Las pruebas corren contra Postgres real (BD de `.env.test` o variables del entorno).
 * Al iniciar: rollback completo + migraciones + seed, para partir de un esquema limpio.
 * Las tablas de ledger y audit son inmutables, así que no se truncan: cada prueba usa datos únicos.
 */
export const plugins: Config['plugins'] = [assert(), apiClient(), pluginAdonisJS(app)]

export const runnerHooks: Required<Pick<Config, 'setup' | 'teardown'>> = {
    setup: [
        async () => {
            const ace = await app.container.make('ace')
            const rollback = await ace.exec('migration:rollback', ['--batch=0', '--force'])
            if (rollback.exitCode) throw rollback.error ?? new Error('Falló migration:rollback')
            const migrate = await ace.exec('migration:run', ['--force'])
            if (migrate.exitCode) throw migrate.error ?? new Error('Falló migration:run')
            const seed = await ace.exec('db:seed', [])
            if (seed.exitCode) throw seed.error ?? new Error('Falló db:seed')
        },
    ],
    teardown: [],
}

export const configureSuite: Config['configureSuite'] = (suite) => {
    suite.setup(() => testUtils.httpServer().start())
}
