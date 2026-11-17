/**
 * Datos de la empresa responsable para `/privacidad`, `/terminos` y `/eliminar-datos`, leídos en el
 * servidor antes de renderizar (`leerEmpresaPoliticas`): la página sale con el nombre, NIT y contacto
 * en el HTML, sin depender de JavaScript (revisión de apps de Meta).
 *
 * Corre después de `portal-cautivo.ts` (orden alfabético): una petición con otro Host ya salió con
 * su 302 a `/corte` y no llega a pedir nada a la API. En modo fixtures no hace nada: la página lee
 * la empresa de los fixtures.
 */
export default defineEventHandler(async (event) => {
    if (event.method !== 'GET' && event.method !== 'HEAD') {
        return
    }
    const ruta = (event.path.split('?')[0] ?? '/').replace(/\/+$/, '') || '/'
    if (!RUTAS_POLITICAS.has(ruta) || useRuntimeConfig(event).public.useFixtures === true) {
        return
    }
    event.context.politicasEmpresa = await leerEmpresaPoliticas(event, empresaDeLaConsulta(getQuery(event).empresa))
})
