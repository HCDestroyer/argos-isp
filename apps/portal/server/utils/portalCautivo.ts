/**
 * Portal cautivo: qué peticiones se redirigen a la página de corte.
 *
 * El MikroTik hace dst-nat de TCP/80 de los suspendidos hacia el portal (`portalCortePuerto` en
 * `infra/mikrotik/lab.rsc`), así que aquí llegan peticiones con cualquier `Host` y ruta:
 * `http://example.com/noticias`, la prueba de conectividad del teléfono, etc.
 *
 * - Rutas de detección de portal cautivo (Android, Apple, Windows, Firefox, Linux…): siempre 302
 *   a `/corte`, para que el sistema operativo muestre "Iniciar sesión en la red" y abra la página.
 * - `Host` ajeno al portal: 302 a `/corte` salvo los recursos que la propia página necesita
 *   (`/_nuxt/`, `/api/v1/portal/`, iconos). Con `urlPublica` la redirección es absoluta hacia el
 *   portal; sin ella es relativa (`/corte` en el mismo Host ajeno, que vuelve a pasar por el dst-nat).
 * - `Host` del portal: rutas normales.
 *
 * Funciones puras, sin h3, para probarlas sin servidor.
 */

/** Rutas que usan los sistemas operativos y navegadores para detectar un portal cautivo. */
export const RUTAS_DETECCION: ReadonlySet<string> = new Set([
    // Android / ChromeOS (connectivitycheck.gstatic.com, clients3.google.com)
    '/generate_204',
    '/gen_204',
    // Apple (captive.apple.com, www.apple.com)
    '/hotspot-detect.html',
    '/library/test/success.html',
    // Windows (www.msftncsi.com, www.msftconnecttest.com)
    '/ncsi.txt',
    '/connecttest.txt',
    '/redirect',
    // Firefox (detectportal.firefox.com)
    '/success.txt',
    '/canonical.html',
    // GNOME / NetworkManager (nmcheck.gnome.org), KDE (networkcheck.kde.org)
    '/check_network_status.txt',
    // Ubuntu (connectivity-check.ubuntu.com)
    '/connectivity-check.html',
    // Kindle, Huawei/Honor, Xiaomi, Samsung
    '/kindle-wifi/wifistub.html',
    '/mobile/status.php',
])

/** Recursos de la propia página de corte que se sirven aunque el Host sea ajeno. */
const PREFIJOS_RECURSOS = ['/_nuxt/', '/api/v1/portal/', '/api/_nuxt_icon/', '/_payload', '/__nuxt']
const RECURSOS_EXACTOS = new Set(['/favicon.ico', '/robots.txt'])

export const RUTA_CORTE = '/corte'

export interface ConfigPortalCautivo {
    /** URL pública del portal, p. ej. `http://portal.argosisp.example` (vacía = redirección relativa). */
    urlPublica?: string
    /** Hosts (sin puerto) que se atienden como el portal además de los locales y el de `urlPublica`. */
    hosts?: string
}

export interface SolicitudPortalCautivo {
    /** Header `Host` tal como llega (puede traer puerto o corchetes IPv6). */
    host: string | undefined
    /** Ruta sin query. */
    ruta: string
}

const HOSTS_LOCALES = ['localhost', '127.0.0.1', '::1']

/** `Portal.Example:8080` → `portal.example`; `[2001:db8::1]:80` → `2001:db8::1`. */
export function nombreHost(host: string | undefined): string {
    const valor = (host ?? '').trim().toLowerCase()
    if (valor.startsWith('[')) {
        const cierre = valor.indexOf(']')
        return cierre > 0 ? valor.slice(1, cierre) : valor
    }
    // Más de un ":" sin corchetes: IPv6 sin puerto.
    if (valor.split(':').length > 2) {
        return valor
    }
    return valor.split(':')[0] ?? ''
}

export function hostsDelPortal(config: ConfigPortalCautivo): Set<string> {
    const hosts = new Set(HOSTS_LOCALES)
    if (config.urlPublica) {
        try {
            hosts.add(nombreHost(new URL(config.urlPublica).host))
        }
        catch {
            // URL inválida: se ignora y la redirección queda relativa.
        }
    }
    for (const host of (config.hosts ?? '').split(',')) {
        const nombre = nombreHost(host)
        if (nombre) {
            hosts.add(nombre)
        }
    }
    return hosts
}

function destinoCorte(config: ConfigPortalCautivo): string {
    if (config.urlPublica) {
        try {
            return new URL(RUTA_CORTE, config.urlPublica).toString()
        }
        catch {
            // URL inválida: redirección relativa.
        }
    }
    return RUTA_CORTE
}

function esRecursoDeLaPagina(ruta: string): boolean {
    return RECURSOS_EXACTOS.has(ruta) || PREFIJOS_RECURSOS.some(prefijo => ruta.startsWith(prefijo))
}

/**
 * Devuelve la URL a la que hay que redirigir (302) o `null` si la petición sigue su curso.
 * `hosts` se puede precalcular con `hostsDelPortal(config)`.
 */
export function redireccionPortalCautivo(
    solicitud: SolicitudPortalCautivo,
    config: ConfigPortalCautivo,
    hosts: Set<string> = hostsDelPortal(config),
): string | null {
    const ruta = solicitud.ruta || '/'
    const destino = destinoCorte(config)
    if (RUTAS_DETECCION.has(ruta.toLowerCase())) {
        return destino
    }
    if (hosts.has(nombreHost(solicitud.host))) {
        return null
    }
    if (esRecursoDeLaPagina(ruta)) {
        return null
    }
    // Host ajeno con redirección relativa: /corte se sirve en ese mismo Host (evita el bucle).
    if (destino === RUTA_CORTE && ruta === RUTA_CORTE) {
        return null
    }
    return destino
}
