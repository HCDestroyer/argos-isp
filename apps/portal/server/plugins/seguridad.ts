/**
 * CSP de cada página HTML con los hashes de sus scripts en línea (`cspDeHtml`), y sin
 * `X-Powered-By`. En desarrollo no se pone CSP (Vite inyecta scripts y websockets).
 */
export default defineNitroPlugin((nitroApp) => {
    nitroApp.hooks.hook('render:response', (respuesta) => {
        if (import.meta.dev || typeof respuesta.body !== 'string') {
            return
        }
        respuesta.headers = { ...respuesta.headers, 'Content-Security-Policy': cspDeHtml(respuesta.body) }
    })
    // El renderer de Nuxt pone `X-Powered-By: Nuxt`: se quita justo antes de responder.
    nitroApp.hooks.hook('beforeResponse', (event) => {
        removeResponseHeader(event, 'x-powered-by')
    })
})
