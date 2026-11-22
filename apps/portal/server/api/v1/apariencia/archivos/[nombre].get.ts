/**
 * Archivos de la apariencia (logo y fondo del inicio de sesión, `contratos/apariencia.md` §7) en el
 * mismo origen del portal: la API da sus URLs relativas a ella (`/api/v1/apariencia/archivos/…`) y
 * la CSP del portal solo admite imágenes propias. Solo GET, solo nombres con la forma del contrato;
 * `ETag`, `Cache-Control: immutable`, `nosniff` y la CSP del SVG pasan tal cual, y `If-None-Match`
 * llega a la API (304).
 *
 * No es parte del walled garden de `/corte`: esa página no carga estos archivos, y con un Host ajeno
 * el portal cautivo redirige a `/corte` como con cualquier otra ruta.
 */
export default defineEventHandler(async (event) => {
    const nombre = getRouterParam(event, 'nombre') ?? ''
    if (!NOMBRE_ARCHIVO.test(nombre)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' })
    }
    const { apiBaseInternal } = useRuntimeConfig(event)
    const destino = `${String(apiBaseInternal).replace(/\/$/, '')}/api/v1/apariencia/archivos/${nombre}`
    // Solo lo que sirve para la caché: nada de cookies ni cabeceras del visitante (es público).
    const condicional = getRequestHeader(event, 'if-none-match')
    try {
        return await proxyRequest(event, destino, {
            headers: condicional ? { 'if-none-match': condicional } : {},
            fetchOptions: { signal: AbortSignal.timeout(TIEMPO_MAXIMO_API_MS) },
        })
    }
    catch {
        throw createError({ statusCode: 502, statusMessage: 'Bad Gateway' })
    }
})

/** Mismo patrón que `NOMBRE_ARCHIVO_APARIENCIA` de `app/utils/apariencia.ts` (contrato §7). */
const NOMBRE_ARCHIVO = /^(?:logo|fondo)-login-[0-9a-f]{16}\.(?:png|svg|jpe?g|webp)$/
