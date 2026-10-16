/**
 * Proxy en el mismo origen hacia `apps/api` para los endpoints del portal.
 *
 * El navegador del cliente suspendido solo alcanza el portal (walled garden), así que la API no
 * necesita estar expuesta ni tener CORS: Nitro reenvía `/api/v1/portal/**` a `apiBaseInternal`
 * con la IP de origen en `X-Forwarded-For` (ver `server/utils/reenvioApi.ts`). Cookies y
 * `Set-Cookie` viajan sin cambios.
 *
 * Si la API no responde (caída o más de `TIEMPO_MAXIMO_API_MS`), el navegador recibe un
 * problem+json 502/504 en español en lugar del error genérico de h3: la página muestra el error
 * con "Reintentar" (`problemaApiNoDisponible`).
 */
export default defineEventHandler(async (event) => {
    const { apiBaseInternal } = useRuntimeConfig(event)
    const destino = destinoReenvio(event.path, apiBaseInternal)
    if (!destino) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' })
    }
    const host = getRequestHost(event, { xForwardedHost: false })
    if (!origenPermitido(event.method, host, getRequestHeader(event, 'origin'), getRequestHeader(event, 'sec-fetch-site'))) {
        setResponseStatus(event, 403)
        setResponseHeaders(event, { 'Content-Type': 'application/problem+json', 'Cache-Control': 'no-store' })
        return {
            type: 'urn:argosisp:problema:origen_no_permitido',
            title: 'Origen no permitido',
            status: 403,
            detail: 'Esta acción solo se puede hacer desde el portal.',
        }
    }

    const xff = cadenaReenvio(getRequestHeader(event, 'x-forwarded-for'), getRequestIP(event))
    const headers: Record<string, string> = {
        'x-canal': 'portal',
        'x-forwarded-proto': getRequestProtocol(event, { xForwardedProto: false }),
        'x-forwarded-host': host,
    }
    if (xff) {
        headers['x-forwarded-for'] = xff
    }

    try {
        return await proxyRequest(event, destino, {
            headers,
            fetchOptions: { signal: AbortSignal.timeout(TIEMPO_MAXIMO_API_MS) },
        })
    }
    catch (error) {
        const problema = problemaApiNoDisponible(error)
        setResponseStatus(event, problema.status)
        setResponseHeaders(event, {
            'Content-Type': 'application/problem+json',
            'Cache-Control': 'no-store',
        })
        return problema
    }
})
