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

/**
 * Sonda de conectividad de un sistema operativo o navegador. Si recibe su respuesta "de éxito"
 * (`exito`), el equipo cree que hay Internet y no abre la página de corte; por eso el portal
 * nunca la da: responde 302 a `/corte`.
 */
export interface SondaPortalCautivo {
    sistema: string
    /** Host con el que pregunta (el que se ve en el MikroTik). */
    host: string
    ruta: string
    /** Lo que espera recibir cuando hay Internet (lo que el portal NUNCA responde). */
    exito: { status: number, cuerpo?: string }
}

/**
 * Catálogo de sondas conocidas (README del portal, tabla "Sondas de portal cautivo").
 * Las sondas que piden la raíz de un host (`networkcheck.kde.org/`, `captive.apple.com/`) no
 * necesitan entrada: cualquier Host ajeno ya recibe 302 a `/corte`.
 */
export const SONDAS: readonly SondaPortalCautivo[] = [
    { sistema: 'Android / ChromeOS / Chrome', host: 'connectivitycheck.gstatic.com', ruta: '/generate_204', exito: { status: 204 } },
    { sistema: 'Android (antiguo)', host: 'clients3.google.com', ruta: '/generate_204', exito: { status: 204 } },
    { sistema: 'Android (Google)', host: 'www.google.com', ruta: '/gen_204', exito: { status: 204 } },
    { sistema: 'Samsung (One UI)', host: 'connectivitycheck.samsung.com', ruta: '/generate_204', exito: { status: 204 } },
    { sistema: 'Xiaomi (MIUI / HyperOS)', host: 'connect.rom.miui.com', ruta: '/generate_204', exito: { status: 204 } },
    { sistema: 'Huawei / Honor', host: 'connectivitycheck.platform.hicloud.com', ruta: '/generate_204', exito: { status: 204 } },
    {
        sistema: 'iOS / iPadOS / macOS',
        host: 'captive.apple.com',
        ruta: '/hotspot-detect.html',
        exito: { status: 200, cuerpo: '<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>' },
    },
    {
        sistema: 'iOS / macOS (antiguo)',
        host: 'www.apple.com',
        ruta: '/library/test/success.html',
        exito: { status: 200, cuerpo: '<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>' },
    },
    { sistema: 'Windows 10 / 11', host: 'www.msftconnecttest.com', ruta: '/connecttest.txt', exito: { status: 200, cuerpo: 'Microsoft Connect Test' } },
    { sistema: 'Windows 10 / 11 (IPv6)', host: 'ipv6.msftconnecttest.com', ruta: '/connecttest.txt', exito: { status: 200, cuerpo: 'Microsoft Connect Test' } },
    { sistema: 'Windows 10 / 11 (abre el navegador)', host: 'www.msftconnecttest.com', ruta: '/redirect', exito: { status: 200 } },
    { sistema: 'Windows 7 / 8', host: 'www.msftncsi.com', ruta: '/ncsi.txt', exito: { status: 200, cuerpo: 'Microsoft NCSI' } },
    { sistema: 'Firefox', host: 'detectportal.firefox.com', ruta: '/success.txt', exito: { status: 200, cuerpo: 'success\n' } },
    { sistema: 'Firefox (portal)', host: 'detectportal.firefox.com', ruta: '/canonical.html', exito: { status: 200 } },
    { sistema: 'GNOME / NetworkManager', host: 'nmcheck.gnome.org', ruta: '/check_network_status.txt', exito: { status: 200, cuerpo: 'NetworkManager is online\n' } },
    { sistema: 'Fedora / NetworkManager', host: 'fedoraproject.org', ruta: '/static/hotspot.txt', exito: { status: 200, cuerpo: 'OK' } },
    { sistema: 'Ubuntu', host: 'connectivity-check.ubuntu.com', ruta: '/connectivity-check.html', exito: { status: 204 } },
    { sistema: 'Kindle', host: 'spectrum.s3.amazonaws.com', ruta: '/kindle-wifi/wifistub.html', exito: { status: 200 } },
    { sistema: 'Kindle (portal)', host: 'spectrum.s3.amazonaws.com', ruta: '/kindle-wifi/wifiredirect.html', exito: { status: 200 } },
    { sistema: 'Huawei / Honor (antiguo)', host: 'connectivitycheck.platform.hicloud.com', ruta: '/mobile/status.php', exito: { status: 204 } },
]

/** Rutas que usan los sistemas operativos y navegadores para detectar un portal cautivo. */
export const RUTAS_DETECCION: ReadonlySet<string> = new Set(SONDAS.map(sonda => sonda.ruta))

/** Recursos de la propia página de corte que se sirven aunque el Host sea ajeno. */
const PREFIJOS_RECURSOS = ['/_nuxt/', '/api/v1/portal/', '/api/_nuxt_icon/', '/_payload', '/__nuxt', '/iconos/']
const RECURSOS_EXACTOS = new Set(['/favicon.ico', '/favicon.svg', '/robots.txt', '/manifest.webmanifest'])

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

/** `/Generate_204/` también cuenta: sin mayúsculas ni barra final. */
export function esSonda(ruta: string): boolean {
    const normal = ruta.toLowerCase()
    return RUTAS_DETECCION.has(normal.length > 1 && normal.endsWith('/') ? normal.slice(0, -1) : normal)
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
    if (esSonda(ruta)) {
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

/**
 * URL de corte del operador (`empresas.url_corte`, `GET /api/v1/portal/destino-corte`): solo se usa si es
 * `http(s)://` con host. Cualquier otra cosa (vacía, otro esquema) cae a la `/corte` del portal.
 */
export function destinoDelOperador(url: unknown): string | null {
    if (typeof url !== 'string' || url.trim() === '') {
        return null
    }
    try {
        const valor = new URL(url.trim())
        return (valor.protocol === 'http:' || valor.protocol === 'https:') && valor.hostname ? valor.toString() : null
    }
    catch {
        return null
    }
}

/** Ruta de la API que dice a dónde redirigir al suspendido de la IP de origen. */
export const RUTA_DESTINO_CORTE = '/api/v1/portal/destino-corte'

/** Espera máxima de esa consulta: si la API tarda, se usa la `/corte` del portal. */
export const ESPERA_DESTINO_MS = 1500

/**
 * Código de corte de `/corte?c=<código>` (lo pone el proxy del router en modo código), o null en otra
 * ruta o sin código con formato (13 símbolos base32; la API decide si existe).
 */
export function codigoCorteDeLaRuta(ruta: string, valor: unknown): string | null {
    if (ruta !== RUTA_CORTE || typeof valor !== 'string') {
        return null
    }
    const codigo = valor.trim().toUpperCase()
    return /^[0-9A-HJKMNP-TV-Z]{13}$/.test(codigo) ? codigo : null
}

/**
 * Destino del 302 con el código de la suspensión (`?c=`), que la API emite cuando identificó al suspendido
 * por su IP en el primer salto (túnel WireGuard, LAN del ISP o IPv6; `contratos/corte-identificacion.md`
 * §5 ter.1). Absoluto (`https://<portal>/corte?c=`) o relativo (`/corte?c=`, sin URL pública: A′). Sin código,
 * el destino tal cual.
 */
export function conCodigoCorte(destino: string, codigo: string | null): string {
    if (!codigo) {
        return destino
    }
    const c = encodeURIComponent(codigo)
    if (destino.startsWith('/')) {
        return `${destino}${destino.includes('?') ? '&' : '?'}c=${c}`
    }
    try {
        const url = new URL(destino)
        url.searchParams.set('c', codigo)
        return url.toString()
    }
    catch {
        return destino
    }
}
