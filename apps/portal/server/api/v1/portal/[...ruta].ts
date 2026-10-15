/**
 * Proxy en el mismo origen hacia `apps/api` para los endpoints del portal.
 *
 * El navegador del cliente suspendido solo alcanza el portal (walled garden), así que la API no
 * necesita estar expuesta ni tener CORS: Nitro reenvía `/api/v1/portal/**` a `apiBaseInternal`
 * con la IP de origen en `X-Forwarded-For` (ver `server/utils/reenvioApi.ts`). Cookies y
 * `Set-Cookie` viajan sin cambios.
 */
export default defineEventHandler((event) => {
    const { apiBaseInternal } = useRuntimeConfig(event)
    const destino = destinoReenvio(event.path, apiBaseInternal)
    if (!destino) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' })
    }

    const xff = cadenaReenvio(getRequestHeader(event, 'x-forwarded-for'), getRequestIP(event))
    const headers: Record<string, string> = {
        'x-canal': 'portal',
        'x-forwarded-proto': getRequestProtocol(event, { xForwardedProto: false }),
        'x-forwarded-host': getRequestHost(event, { xForwardedHost: false }),
    }
    if (xff) {
        headers['x-forwarded-for'] = xff
    }

    return proxyRequest(event, destino, { headers })
})
