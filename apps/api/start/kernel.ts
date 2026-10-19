/*
|--------------------------------------------------------------------------
| Middleware HTTP
|--------------------------------------------------------------------------
*/
import router from '@adonisjs/core/services/router'
import server from '@adonisjs/core/services/server'

server.errorHandler(() => import('#exceptions/handler'))

/**
 * Corre en todas las peticiones, incluso sin ruta.
 */
server.use([
    () => import('#middleware/container_bindings_middleware'),
    () => import('#middleware/request_id_middleware'),
    () => import('@adonisjs/cors/cors_middleware'),
])

/**
 * Corre en las peticiones con ruta.
 */
router.use([
    () => import('@adonisjs/core/bodyparser_middleware'),
    () => import('@adonisjs/auth/initialize_auth_middleware'),
])

export const middleware = router.named({
    auth: () => import('#middleware/auth_middleware'),
    autorizar: () => import('#middleware/autorizar_middleware'),
    empresa: () => import('#middleware/empresa_middleware'),
    idempotencia: () => import('#middleware/idempotencia_middleware'),
    interno: () => import('#middleware/interno_middleware'),
    sesionONodo: () => import('#portal/sesion_o_nodo_middleware'),
})
