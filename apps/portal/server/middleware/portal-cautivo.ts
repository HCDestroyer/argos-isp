/**
 * Detección de portal cautivo y "cualquier Host y ruta → /corte" (ver `server/utils/portalCautivo.ts`).
 * Configuración: `NUXT_PORTAL_URL_PUBLICA` y `NUXT_PORTAL_HOSTS` (`.env.example`).
 */
import type { H3Event } from 'h3'

let hostsCache: { clave: string, hosts: Set<string> } | undefined

interface DestinoApi {
    /** URL de corte del operador (`url_corte` de la empresa), o null */
    url: string | null
    /** código de la suspensión que emitió la API al identificar por una IP de cliente, o null */
    codigo: string | null
}

const SIN_DESTINO: DestinoApi = { url: null, codigo: null }

/**
 * Destino del suspendido de esta petición según la API (`GET /portal/destino-corte`): la URL de corte del
 * operador y, si la API lo identificó por una IP de cliente (túnel, LAN o IPv6, sin NAT), el código de su
 * suspensión (`contratos/corte-identificacion.md` §5 ter.1). Si la API no responde a tiempo o falla, nada:
 * la sonda recibe igual el 302 a la `/corte` del portal, nunca un 204.
 */
async function destinoDeLaApi(event: H3Event, codigo: string | null = null): Promise<DestinoApi> {
    const { apiBaseInternal, nodoPortalToken, portal } = useRuntimeConfig(event)
    const token = String(nodoPortalToken ?? '').trim()
    if (!apiBaseInternal || (token && !apiAdmiteToken(apiBaseInternal))) {
        return SIN_DESTINO
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
    if (codigo) {
        headers['x-argos-corte'] = codigo
    }
    try {
        const respuesta = await $fetch<{ url?: unknown, codigo?: unknown }>(`${apiBaseInternal.replace(/\/$/, '')}${RUTA_DESTINO_CORTE}`, {
            headers,
            signal: AbortSignal.timeout(ESPERA_DESTINO_MS),
        })
        return { url: destinoDelOperador(respuesta?.url), codigo: codigoCorteDeLaRuta(RUTA_CORTE, respuesta?.codigo) }
    }
    catch {
        return SIN_DESTINO
    }
}

export default defineEventHandler(async (event) => {
    const { portal } = useRuntimeConfig(event)
    const clave = `${portal.urlPublica}|${portal.hosts}`
    if (hostsCache?.clave !== clave) {
        hostsCache = { clave, hosts: hostsDelPortal(portal) }
    }

    const ruta = event.path.split('?')[0] ?? '/'
    const destino = redireccionPortalCautivo(
        { host: getRequestHost(event, { xForwardedHost: false }), ruta },
        portal,
        hostsCache.hosts,
    )
    if (!destino) {
        // `/corte?c=<código>` (el proxy del router en modo código, `contratos/corte-identificacion.md`):
        // Argos identifica por el código y, si la empresa del servicio tiene su URL de corte, va allí
        // (decisión del PM P3). Sin URL de la empresa, la página sigue con el código.
        const codigo = codigoCorteDeLaRuta(ruta, getQuery(event).c)
        if (!codigo) {
            return
        }
        const operador = (await destinoDeLaApi(event, codigo)).url
        if (!operador) {
            return
        }
        setResponseHeaders(event, { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' })
        return sendRedirect(event, operador, 302)
    }

    // Nunca en caché: la misma URL debe volver a responder normal cuando el servicio se reactive.
    setResponseHeaders(event, {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
    })
    // La URL de corte del operador (si su empresa la configuró) o la `/corte` del portal; con el código de la
    // suspensión si la API identificó al cliente por su IP en este primer salto (túnel, LAN o IPv6).
    const api = await destinoDeLaApi(event)
    return sendRedirect(event, api.url ?? conCodigoCorte(destino, api.codigo), 302)
})
