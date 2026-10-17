import { defineConfig } from '@adonisjs/cors'
import { origenPermitido } from '#core/auth/origenes'

/**
 * CORS con credenciales (cookie de sesión del panel) solo para los orígenes permitidos de
 * `app/core/auth/origenes.ts` (`CORS_ORIGINS`; sin lista, localhost en dev y ninguno en
 * producción). Un origen no permitido no recibe `Access-Control-Allow-Origin`.
 */
export default defineConfig({
    enabled: true,
    origin: (origen) => origenPermitido(origen),
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'],
    headers: true,
    // `retry-after`: el panel lee los segundos del 429 de login (`POST /auth/sesion`) desde otro origen
    exposeHeaders: ['x-request-id', 'idempotent-replayed', 'retry-after'],
    credentials: true,
    maxAge: 90,
})
