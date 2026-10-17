/**
 * `/manifest.webmanifest` (ver `server/utils/manifiesto.ts`). Se sirve también con Host ajeno
 * (`RECURSOS_EXACTOS` del portal cautivo) para que la página de corte lo encuentre.
 *
 * Con `?empresa=<id>` (lo enlaza `/cuenta` con la empresa principal del cliente) el nombre sale de
 * esa empresa por la API; si no viene, no existe o la API no responde, el nombre configurado.
 */
const TIEMPO_MAXIMO_MS = 3000

export default defineEventHandler(async (event) => {
    const { apiBaseInternal, public: { empresa } } = useRuntimeConfig(event)
    const empresaId = empresaDelManifiesto(getQuery(event).empresa)
    let nombre = empresa.nombre
    if (empresaId !== null) {
        // La API limita por la IP del cliente, igual que el proxy de `/api/v1/portal/**`.
        const xff = cadenaReenvio(getRequestHeader(event, 'x-forwarded-for'), getRequestIP(event))
        try {
            const datos = await $fetch<{ nombre?: unknown }>(`/api/v1/portal/empresa?empresa_id=${empresaId}`, {
                baseURL: apiBaseInternal,
                headers: { 'x-canal': 'portal', ...(xff ? { 'x-forwarded-for': xff } : {}) },
                signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
            })
            if (typeof datos.nombre === 'string' && datos.nombre.trim()) {
                nombre = datos.nombre
            }
        }
        catch {
            // Sin la API el manifiesto sale con el nombre configurado: nunca un error al instalar.
        }
    }
    setResponseHeaders(event, {
        'Content-Type': 'application/manifest+json; charset=utf-8',
        // Corto: si cambia el nombre de la empresa, el teléfono lo ve pronto.
        'Cache-Control': 'public, max-age=3600',
    })
    return JSON.stringify(manifiestoPwa(nombre))
})
