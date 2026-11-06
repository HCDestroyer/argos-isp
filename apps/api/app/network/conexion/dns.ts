import { BlockList, isIPv4, isIPv6 } from 'node:net'

/**
 * Redes de documentación (RFC 5737 y RFC 3849): nunca son resolutores reales. Un router con
 * `/ip dns servers=` en ellas no resuelve nada, y la página de corte no carga (`DNS_PROBE_STARTED`).
 */
export const REDES_DOCUMENTACION = [
    '192.0.2.0/24',
    '198.51.100.0/24',
    '203.0.113.0/24',
    '2001:db8::/32',
] as const

const documentacion = new BlockList()
documentacion.addSubnet('192.0.2.0', 24, 'ipv4')
documentacion.addSubnet('198.51.100.0', 24, 'ipv4')
documentacion.addSubnet('203.0.113.0', 24, 'ipv4')
documentacion.addSubnet('2001:db8::', 32, 'ipv6')

/** ¿La IP (sin máscara) es de una red de documentación? Lo que no es IP responde `false`. */
export function esIpDocumentacion(ip: string): boolean {
    const limpia = ip.trim().replace(/^\[|\]$/g, '')
    if (isIPv4(limpia)) return documentacion.check(limpia, 'ipv4')
    if (isIPv6(limpia)) return documentacion.check(limpia, 'ipv6')
    return false
}

/** Separa una lista de resolutores (`a,b` o con espacios/punto y coma). */
export function separarDns(valor: string | null | undefined): string[] {
    return (valor ?? '')
        .split(/[,;\s]+/)
        .map((x) => x.trim())
        .filter((x) => x !== '')
}

/** Los resolutores de la lista que son de documentación (vacío = ninguno). */
export function dnsDeDocumentacion(valor: string | null | undefined): string[] {
    return separarDns(valor).filter(esIpDocumentacion)
}
