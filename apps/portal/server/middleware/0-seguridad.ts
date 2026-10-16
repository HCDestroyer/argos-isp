/**
 * Cabeceras de seguridad en toda respuesta del portal (`server/utils/cabecerasSeguridad.ts`).
 * Corre antes que `portal-cautivo.ts` (orden alfabético), así que las redirecciones también las
 * llevan. La CSP de las páginas la pone `server/plugins/seguridad.ts`.
 */
export default defineEventHandler((event) => {
    setResponseHeaders(event, CABECERAS_BASE)
})
