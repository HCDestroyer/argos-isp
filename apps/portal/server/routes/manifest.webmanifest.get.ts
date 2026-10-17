/**
 * `/manifest.webmanifest` (ver `server/utils/manifiesto.ts`). Se sirve también con Host ajeno
 * (`RECURSOS_EXACTOS` del portal cautivo) para que la página de corte lo encuentre.
 */
export default defineEventHandler((event) => {
    const { empresa } = useRuntimeConfig(event).public
    setResponseHeaders(event, {
        'Content-Type': 'application/manifest+json; charset=utf-8',
        // Corto: si cambia el nombre de la empresa, el teléfono lo ve pronto.
        'Cache-Control': 'public, max-age=3600',
    })
    return JSON.stringify(manifiestoPwa(empresa.nombre))
})
