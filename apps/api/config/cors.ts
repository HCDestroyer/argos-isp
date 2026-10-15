import env from '#start/env'
import app from '@adonisjs/core/services/app'
import { defineConfig } from '@adonisjs/cors'

const origenes = (env.get('CORS_ORIGINS') ?? '')
    .split(',')
    .map((origen) => origen.trim())
    .filter(Boolean)

export default defineConfig({
    enabled: true,
    origin: origenes.length > 0 ? origenes : !app.inProduction,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'],
    headers: true,
    exposeHeaders: ['x-request-id', 'idempotent-replayed'],
    credentials: true,
    maxAge: 90,
})
