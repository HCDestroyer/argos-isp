/**
 * Detección de portal cautivo y "cualquier Host y ruta → /corte" (ver `server/utils/portalCautivo.ts`).
 * Configuración: `NUXT_PORTAL_URL_PUBLICA` y `NUXT_PORTAL_HOSTS` (`.env.example`).
 */
import type { H3Event } from 'h3'

let hostsCache: { clave: string, hosts: Set<string> } | undefined

/**
 * URL de corte del operador para el suspendido de esta petición (por su IP), o null. Si la API no
 * responde a tiempo o falla, null: la sonda recibe igual el 302 a la `/corte` del portal, nunca un 204.
 */
async function urlDelOperador(event: H3Event): Promise<string | null> {
    const { apiBaseInternal, nodoPortalToken, portal } = useRuntimeConfig(event)
    const token = String(nodoPortalToken ?? '').trim()
    if (!apiBaseInternal || (token && !apiAdmiteToken(apiBaseInternal))) {
        return null
    }
    const headers = cabecerasReenvio({
        token,
        proxiesConfiables: String(portal?.proxiesConfiables ?? ''),
        ipSocket: getRequestIP(event),
        protoSocket: getRequestProtocol(event, { xForwardedProto: false }),
        xff: token ? undefined : getRequestHeader(event, 'x-forwarded-for'),
        xfProto: token ? undefined : getRequestHeader(event, 'x-forwarded-proto'),
        host: getRequestHost(event, { xForwardedHost: false }),
    })
    try {
        const respuesta = await $fetch<{ url?: unknown }>(`${apiBaseInternal.replace(/\/$/, '')}${RUTA_DESTINO_CORTE}`, {
            headers,
            signal: AbortSignal.timeout(ESPERA_DESTINO_MS),
        })
        return destinoDelOperador(respuesta?.url)
    }
    catch {
        return null
    }
}

export default defineEventHandler(async (event) => {
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
    // La URL de corte del operador (si su empresa la configuró) o la `/corte` del portal.
    return sendRedirect(event, (await urlDelOperador(event)) ?? destino, 302)
})
