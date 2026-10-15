import env from '#start/env'
import app from '@adonisjs/core/services/app'
import { Secret } from '@adonisjs/core/helpers'
import { defineConfig } from '@adonisjs/core/http'

/**
 * Clave de la aplicación: cifrado de valores y firmas.
 */
export const appKey = new Secret(env.get('APP_KEY'))

export const http = defineConfig({
    /**
     * El request id lo gestiona `request_id_middleware` (header X-Request-Id).
     */
    generateRequestId: false,
    allowMethodSpoofing: false,
    useAsyncLocalStorage: false,
    cookie: {
        domain: '',
        path: '/',
        maxAge: '2h',
        httpOnly: true,
        secure: app.inProduction,
        sameSite: 'lax',
    },
})
