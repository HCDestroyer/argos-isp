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
/** Marca del gateway que sale de la primera IP utilizable (red sin gateway; `red-acceso.md` §2). */
export const MARCA_GATEWAY_DERIVADO = 'derivado (primera IP de la red)'

export function formatearVelocidad(kbps: number): string {
    if (kbps >= 1000 && kbps % 1000 === 0) {
        return `${kbps / 1000} Mbps`
    }
    if (kbps >= 1000) {
        return `${(kbps / 1000).toFixed(1)} Mbps`
    }
    return `${kbps} kbps`
}

/** Error de una IPv4 fija en un campo del formulario (`ipv4` o `red_id`). */
export interface ProblemaIpv4Fija {
    campo: 'ipv4' | 'red_id'
    mensaje: string
}

/**
 * Lo que se revisa al elegir una IPv4 fija de una red del router, igual en el alta y en la edición
 * del servicio: IPv4 válida, red elegida (si se exige) y, con la red a la vista, que la IP caiga en
 * ella. La API además revisa que no sea red, broadcast ni gateway y que esté libre.
 */
export function problemasIpv4Fija(
    datos: { ipv4: string, red_id?: number },
    opciones: { exigirRed: boolean, redes?: readonly { id: number, cidr: string }[] },
): ProblemaIpv4Fija[] {
    const problemas: ProblemaIpv4Fija[] = []
    const valida = PATRON_IPV4.test(datos.ipv4)
    if (!valida) {
        problemas.push({ campo: 'ipv4', mensaje: 'Escribe una IPv4 válida' })
    }
    if (datos.red_id === undefined) {
        if (opciones.exigirRed) {
            problemas.push({ campo: 'red_id', mensaje: 'Elige la red de la IP fija' })
        }
        return problemas
    }
    const red = opciones.redes?.find(r => r.id === datos.red_id)
    if (valida && red && !ipEnCidr(datos.ipv4, red.cidr)) {
        problemas.push({ campo: 'ipv4', mensaje: `Escribe una IP dentro de ${red.cidr} o elige otra red` })
    }
    return problemas
}

/** `100.64.10.0/24 · estática`: cómo se nombra una red IPv4 del router en los selectores. */
export function etiquetaRedIpv4(red: { cidr: string, tipo: string }): string {
    return `${red.cidr} · ${red.tipo === 'pool' ? 'pool' : 'estática'}`
}
