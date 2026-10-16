import { createHash } from 'node:crypto'

/**
 * Cabeceras de seguridad del portal (revisión de la semana 3, `docs/seguridad/portal.md`).
 * Funciones puras para probarlas sin servidor; las aplican `server/middleware/0-seguridad.ts`
 * (todas las respuestas) y `server/plugins/seguridad.ts` (la CSP de cada página HTML).
 */

/** Para toda respuesta: páginas, redirecciones del portal cautivo y el proxy a la API. */
export const CABECERAS_BASE: Readonly<Record<string, string>> = {
    // Nadie puede meter el portal en un iframe (clickjacking sobre "Pagar" o el código).
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    // La URL (`/corte?pago=<id>`) no sale hacia otros sitios.
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
}

/** Contenido de cada `<script>` en línea que el navegador ejecuta (sin `src`; no JSON). */
export function scriptsEnLinea(html: string): string[] {
    const scripts: string[] = []
    for (const coincidencia of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        const atributos = coincidencia[1] ?? ''
        if (/\bsrc\s*=/i.test(atributos)) {
            continue
        }
        const tipo = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(atributos)?.[1]?.toLowerCase()
        // Bloques de datos (`__NUXT_DATA__`): el navegador no los ejecuta y la CSP no los mira.
        if (tipo && tipo !== 'module' && tipo !== 'importmap' && !tipo.includes('javascript')) {
            continue
        }
        scripts.push(coincidencia[2] ?? '')
    }
    return scripts
}

export function hashScript(contenido: string): string {
    return `'sha256-${createHash('sha256').update(contenido, 'utf8').digest('base64')}'`
}

/**
 * CSP de una página: todo del mismo origen (walled garden: nada externo), scripts en línea solo
 * por su hash (el estado de Nuxt, el modo de color y el importmap), nunca `unsafe-inline` ni
 * `unsafe-eval` en scripts. Los estilos en línea sí (Nuxt UI pone variables de color en `<style>` y
 * Vue en `style=""`). `blob:` en imágenes es la vista previa del comprobante antes de subirlo.
 */
export function politicaCsp(hashes: readonly string[]): string {
    const scripts = ['\'self\'', ...new Set(hashes)].join(' ')
    return [
        'default-src \'self\'',
        `script-src ${scripts}`,
        'style-src \'self\' \'unsafe-inline\'',
        'img-src \'self\' data: blob:',
        'font-src \'self\' data:',
        'connect-src \'self\'',
        'object-src \'none\'',
        'base-uri \'self\'',
        'form-action \'self\'',
        'frame-ancestors \'none\'',
    ].join('; ')
}

/** CSP para el HTML ya renderizado. */
export function cspDeHtml(html: string): string {
    return politicaCsp(scriptsEnLinea(html).map(hashScript))
}
