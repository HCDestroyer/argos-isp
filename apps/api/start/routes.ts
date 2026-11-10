/*
|--------------------------------------------------------------------------
| Router HTTP
|--------------------------------------------------------------------------
|
| Monta el registro de rutas (`start/routes/index.ts`) con su cadena de middleware:
| auth → empresa (X-Empresa-Id) → autorizar(permiso) → idempotencia → validación VineJS → handler
| (o 501).
|
*/
import router from '@adonisjs/core/services/router'
import { registroRutas } from '#start/routes/index'
import { montarRuta } from '#shared/montar_ruta'

router.get('/health', async () => ({ ok: true }))

// Prometheus (A6, app/monitoreo): fuera de /api/v1 y del OpenAPI; Bearer METRICS_TOKEN, 404 sin él.
router.get('/metrics', async ({ request, response }) => {
    const { autorizarScrape, recolectarMetricas } = await import('#monitoreo/metricas')
    const { TIPO_CONTENIDO } = await import('#monitoreo/prometheus')
    const rechazo = autorizarScrape(request.header('authorization'))
    if (rechazo) return response.status(rechazo).send('')
    return response.header('content-type', TIPO_CONTENIDO).send(await recolectarMetricas())
})

// Enlace de conexión de Horus (A6, contrato horus §1.4): el enlace `<API>/conectar#<código>` debe
// estar en el host de la API (Horus canjea en `<API>/api/v1/…`), pero quien lo abre en el navegador
// va a la página del panel que explica que se pega en Horus. El fragmento no llega al servidor y el
// navegador lo conserva en la redirección. Fuera de /api/v1 y del OpenAPI.
router.get('/conectar', async ({ response }) => {
    const { urlConectarPanel } = await import('#integraciones/horus/panel')
    return response.redirect().status(302).toPath(urlConectarPanel())
})

for (const ruta of registroRutas) montarRuta(ruta)
