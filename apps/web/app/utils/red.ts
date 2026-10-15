/** Utilidades de direcciones para validar en el formulario lo que la API también valida. */

const OCTETO = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
export const PATRON_IPV4 = new RegExp(`^${OCTETO}(\\.${OCTETO}){3}$`)
/** Igual que `prefijoV6()` del backend. */
export const PATRON_PREFIJO_V6 = /^[0-9a-fA-F:]+\/([0-9]|[1-9][0-9]|1[01][0-9]|12[0-8])$/
/** Igual que la regla de `mac` del validador de servicios. */
export const PATRON_MAC = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/

/** `100.64.10.5` → entero sin signo de 32 bits, o `null` si no es IPv4. */
export function ipv4ANumero(ip: string): number | null {
    if (!PATRON_IPV4.test(ip)) {
        return null
    }
    return ip.split('.').reduce((total, octeto) => total * 256 + Number(octeto), 0)
}

/** ¿La IPv4 cae dentro de la red `a.b.c.d/n`? */
export function ipEnCidr(ip: string, cidr: string): boolean {
    const [red = '', prefijoTexto = ''] = cidr.split('/')
    const prefijo = Number(prefijoTexto)
    const numeroIp = ipv4ANumero(ip)
    const numeroRed = ipv4ANumero(red)
    if (numeroIp === null || numeroRed === null || !Number.isInteger(prefijo) || prefijo < 0 || prefijo > 32) {
        return false
    }
    const tamano = 2 ** (32 - prefijo)
    const inicio = Math.floor(numeroRed / tamano) * tamano
    return numeroIp >= inicio && numeroIp < inicio + tamano
}

/** Kbps a texto corto: `10000` → `10 Mbps`, `512` → `512 kbps`. */
export function formatearVelocidad(kbps: number): string {
    if (kbps >= 1000 && kbps % 1000 === 0) {
        return `${kbps / 1000} Mbps`
    }
    if (kbps >= 1000) {
        return `${(kbps / 1000).toFixed(1)} Mbps`
    }
    return `${kbps} kbps`
}
