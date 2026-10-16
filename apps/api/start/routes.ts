/*
|--------------------------------------------------------------------------
| Router HTTP
|--------------------------------------------------------------------------
|
| Monta el registro de rutas (`start/routes/index.ts`) con su cadena de middleware:
| auth → autorizar(permiso) → idempotencia → validación VineJS → handler (o 501).
|
*/
import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'
import { registroRutas } from '#start/routes/index'
import { PREFIJO_API, despachar, esParametroEntero, parametrosDeRuta } from '#shared/rutas'

router.get('/health', async () => ({ ok: true }))

// Prometheus (A6, app/monitoreo): fuera de /api/v1 y del OpenAPI; Bearer METRICS_TOKEN, 404 sin él.
router.get('/metrics', async ({ request, response }) => {
    const { autorizarScrape, recolectarMetricas } = await import('#monitoreo/metricas')
    const { TIPO_CONTENIDO } = await import('#monitoreo/prometheus')
    const rechazo = autorizarScrape(request.header('authorization'))
    if (rechazo) return response.status(rechazo).send('')
    return response.header('content-type', TIPO_CONTENIDO).send(await recolectarMetricas())
})

for (const ruta of registroRutas) {
    const seguridad = ruta.seguridad ?? 'sesion'
    const cadena = []
    if (seguridad === 'sesion') {
        cadena.push(middleware.auth())
        if (ruta.permiso) cadena.push(middleware.autorizar({ permiso: ruta.permiso }))
    }
    if (seguridad === 'interno') cadena.push(middleware.interno())
    if (ruta.idempotente) cadena.push(middleware.idempotencia())

    const montada = router[ruta.metodo](PREFIJO_API + ruta.ruta, (ctx) => despachar(ruta, ctx))
        .as(ruta.operacion)
        .use(cadena)

    for (const nombre of parametrosDeRuta(ruta.ruta)) {
        if (esParametroEntero(nombre)) montada.where(nombre, router.matchers.number())
    }
}
