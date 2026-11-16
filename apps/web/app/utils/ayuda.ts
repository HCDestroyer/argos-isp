/**
 * Botón «Ayuda» del panel (contrato `documentacion.md` §6): cada pantalla abre
 * `<docsUrl>/ayuda/?pantalla=<clave>` y el sitio de documentación redirige a la página del manual
 * que la explica.
 *
 * La clave es la ruta del archivo de la pantalla en `apps/web/app/pages`, sin `.vue` ni `/index`.
 * Se calcula desde la ruta de Nuxt (`route.matched`), que la escribe con la sintaxis de vue-router:
 *
 * - `/clientes/:id()` → `/clientes/[id]`
 * - `/foo/:id?` → `/foo/[[id]]` (parámetro opcional)
 * - `/foo/:resto(.*)*` → `/foo/[...resto]` (comodín)
 */

/** Pantallas sin botón «Ayuda» (no son pantallas de trabajo). */
const SIN_AYUDA = new Set(['/login'])

/** Clave de ayuda de una ruta de Nuxt (`/clientes/:id()` → `/clientes/[id]`). */
export function claveAyuda(rutaNuxt: string): string {
    const clave = rutaNuxt
        .replace(/:(\w+)\(\.\*\)\*/g, '[...$1]')
        .replace(/:(\w+)\(\)/g, '[$1]')
        .replace(/:(\w+)\?/g, '[[$1]]')
        .replace(/\/+$/, '')
    return clave === '' ? '/' : clave
}

/** Clave de la pantalla actual desde `route.matched` (el último registro es la página). */
export function claveAyudaDeRuta(matched: ReadonlyArray<{ path: string }>): string | null {
    const pagina = matched.at(-1)
    if (!pagina) {
        return null
    }
    const clave = claveAyuda(pagina.path)
    return SIN_AYUDA.has(clave) ? null : clave
}

/** URL de la ayuda de una pantalla en el sitio de documentación. */
export function urlAyuda(docsUrl: string, clave: string): string {
    const base = docsUrl.endsWith('/') ? docsUrl : `${docsUrl}/`
    return `${base}ayuda/?pantalla=${encodeURIComponent(clave)}`
}
