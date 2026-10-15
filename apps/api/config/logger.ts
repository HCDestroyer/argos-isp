import env from '#start/env'
import app from '@adonisjs/core/services/app'
import { defineConfig, targets } from '@adonisjs/core/logger'

const loggerConfig = defineConfig({
    default: 'app',

    loggers: {
        app: {
            enabled: true,
            name: 'argosisp-api',
            level: env.get('LOG_LEVEL'),
            transport: {
                targets: targets()
                    .pushIf(!app.inProduction && !app.inTest, targets.pretty())
                    .pushIf(app.inProduction || app.inTest, targets.file({ destination: 1 }))
                    .toArray(),
            },
        },
    },
})

export default loggerConfig

declare module '@adonisjs/core/types' {
    export interface LoggersList extends InferLoggers<typeof loggerConfig> {}
}
