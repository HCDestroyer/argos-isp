/**
 * Detección de portal cautivo y "cualquier Host y ruta → /corte" (ver `server/utils/portalCautivo.ts`).
 * Configuración: `NUXT_PORTAL_URL_PUBLICA` y `NUXT_PORTAL_HOSTS` (`.env.example`).
 */
let hostsCache: { clave: string, hosts: Set<string> } | undefined

export default defineEventHandler((event) => {
    const { portal } = useRuntimeConfig(event)
    const clave = `${portal.urlPublica}|${portal.hosts}`
    if (hostsCache?.clave !== clave) {
        hostsCache = { clave, hosts: hostsDelPortal(portal) }
    }

    const destino = redireccionPortalCautivo(
        { host: getRequestHost(event, { xForwardedHost: false }), ruta: event.path.split('?')[0] ?? '/' },
        portal,
        hostsCache.hosts,
    )
    if (!destino) {
        return
    }

    // Nunca en caché: la misma URL debe volver a responder normal cuando el servicio se reactive.
    setResponseHeaders(event, {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
    })
    return sendRedirect(event, destino, 302)
})
