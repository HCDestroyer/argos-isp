/**
 * Manifiesto PWA del portal (`/manifest.webmanifest`): "Agregar a pantalla de inicio" con el nombre
 * de la empresa y la marca de ArgosIsp. Función pura para probarla sin servidor.
 *
 * Sin service worker: el portal debe mostrar siempre el estado real (corte, saldo, reactivación),
 * nunca una copia en caché.
 *
 * Multiempresa: el nombre sale de `NUXT_PUBLIC_EMPRESA_NOMBRE` (la empresa principal). Cuando cada
 * empresa tenga su marca, el manifiesto puede tomar la empresa del Host o de la sesión aquí mismo.
 */
export const TEMA_MARCA = '#0f766e'

export interface ManifiestoPwa {
    name: string
    short_name: string
    description: string
    lang: string
    dir: 'ltr'
    start_url: string
    scope: string
    display: 'standalone'
    orientation: 'portrait'
    theme_color: string
    background_color: string
    icons: { src: string, sizes: string, type: string, purpose: 'any' | 'maskable' }[]
}

/** El nombre corto cabe bajo el ícono (≈ 12 caracteres); si no, "Mi servicio". */
export function nombreCorto(empresa: string): string {
    const limpio = empresa.trim()
    return limpio.length > 0 && limpio.length <= 12 ? limpio : 'Mi servicio'
}

export function manifiestoPwa(empresa: string): ManifiestoPwa {
    const nombre = empresa.trim() || 'ArgosIsp'
    return {
        name: `${nombre} · Portal del cliente`,
        short_name: nombreCorto(nombre),
        description: 'Estado de tu servicio, facturas y pagos.',
        lang: 'es',
        dir: 'ltr',
        // Con sesión abre el inicio del cliente; sin sesión, `/cuenta` lleva a entrar con el código.
        start_url: '/cuenta?origen=pwa',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: TEMA_MARCA,
        background_color: '#ffffff',
        icons: [
            { src: '/iconos/icono-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/iconos/icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/iconos/icono-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
    }
}
