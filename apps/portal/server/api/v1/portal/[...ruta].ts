/**
 * Proxy en el mismo origen hacia `apps/api` para los endpoints del portal.
 *
 * El navegador del cliente suspendido solo alcanza el portal (walled garden), así que la API no
 * necesita estar expuesta ni tener CORS: Nitro reenvía `/api/v1/portal/**` a `apiBaseInternal`
 * con la IP de origen en `X-Forwarded-For` (ver `server/utils/reenvioApi.ts`). Cookies y
 * `Set-Cookie` viajan sin cambios.
 *
 * Nodo portal remoto (`NUXT_NODO_PORTAL_TOKEN`): la API está en otro servidor, por HTTPS; en vez
 * de `X-Forwarded-For` se manda el token del nodo y la IP del cliente ya resuelta
 * (`cabecerasReenvio`, contrato `nodo-portal.md`).
 *
 * Si la API no responde (caída o más de `TIEMPO_MAXIMO_API_MS`), el navegador recibe un
 * problem+json 502/504 en español en lugar del error genérico de h3: la página muestra el error
 * con "Reintentar" (`problemaApiNoDisponible`).
 */
export default defineEventHandler(async (event) => {
    const { apiBaseInternal, nodoPortalToken, portal } = useRuntimeConfig(event)
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

    // Lo que el navegador mande como cabeceras del nodo (o como cadena de proxies, con token) no
    // llega a la API: las pone solo este servidor.
    const entrantes = event.node.req.headers
    const xffEntrante = getRequestHeader(event, 'x-forwarded-for')
    const xfProtoEntrante = getRequestHeader(event, 'x-forwarded-proto')
    delete entrantes['x-argos-nodo-token']
    delete entrantes['x-argos-cliente-ip']
    delete entrantes['x-argos-cliente-proto']
    const token = String(nodoPortalToken ?? '').trim()
    if (token) {
        delete entrantes['x-forwarded-for']
        delete entrantes['x-forwarded-proto']
        if (!apiAdmiteToken(apiBaseInternal)) {
            console.error('[nodo portal] NUXT_API_BASE_INTERNAL debe ser https:// para mandar el token del nodo')
            const problema = problemaApiNoDisponible(new Error('api sin https'))
            setResponseStatus(event, problema.status)
            setResponseHeaders(event, { 'Content-Type': 'application/problem+json', 'Cache-Control': 'no-store' })
            return problema
        }
    }
    const headers = cabecerasReenvio({
        token,
        proxiesConfiables: String(portal?.proxiesConfiables ?? ''),
        ipSocket: getRequestIP(event),
        protoSocket: getRequestProtocol(event, { xForwardedProto: false }),
        xff: xffEntrante,
        xfProto: xfProtoEntrante,
        host,
    })

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
