import type { Schema } from '@argosisp/contracts'
import * as z from 'zod'

export type PortalCorte = Schema<'PortalCorte'>
export type ModoSuspension = PortalCorte['modo_suspension']

/**
 * Espejo de `configurarPortalCorteValidator` (`apps/api/app/portal/validators.ts`): IPv4 e IPv6 del
 * portal (vacías = `null`), puerto entero de 1 a 65535 y el modo de suspensión. La `version` la pone
 * la pantalla con la que leyó.
 */
export const esquemaPortalCorte = z.object({
    portal_v4: z.string().trim()
        .refine(v => v === '' || z.ipv4().safeParse(v).success, 'Escribe una IPv4, p. ej. 190.56.10.20, o déjala vacía')
        .transform(v => (v === '' ? null : v)),
    portal_v6: z.string().trim()
        .refine(v => v === '' || z.ipv6().safeParse(v).success, 'Escribe una IPv6, p. ej. 2803:d100::20, o déjala vacía')
        .transform(v => (v === '' ? null : v.toLowerCase())),
    portal_puerto: z.number('Escribe el puerto').int('Solo números enteros').min(1, 'De 1 a 65535').max(65535, 'De 1 a 65535'),
    modo_suspension: z.enum(['desconectar', 'coa']),
})

export type EntradaPortalCorte = z.input<typeof esquemaPortalCorte>
export type SalidaPortalCorte = z.output<typeof esquemaPortalCorte>

export function entradaPortalCorte(config: PortalCorte): EntradaPortalCorte {
    return {
        portal_v4: config.portal_v4 ?? '',
        portal_v6: config.portal_v6 ?? '',
        portal_puerto: config.portal_puerto,
        modo_suspension: config.modo_suspension,
    }
}

/** Campos que reescriben las reglas de corte de los routers (el modo de suspensión no las toca). */
export function cambiaReglasRouters(antes: PortalCorte, despues: SalidaPortalCorte): boolean {
    return antes.portal_v4 !== despues.portal_v4
        || antes.portal_v6 !== despues.portal_v6
        || antes.portal_puerto !== despues.portal_puerto
}

export const MODOS_SUSPENSION: Record<ModoSuspension, { etiqueta: string, descripcion: string }> = {
    desconectar: {
        etiqueta: 'Desconectar la sesión',
        descripcion: 'Recomendado. El equipo del cliente se vuelve a conectar ya suspendido y ve la página de corte de inmediato, sin conexiones abiertas de antes.',
    },
    coa: {
        etiqueta: 'Mantener la sesión y cambiar velocidad (CoA)',
        descripcion: 'El cliente no se desconecta: el router le cambia el perfil en caliente. Descargas o llamadas ya abiertas pueden seguir hasta que se cierren.',
    },
}

const OCTETO = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

/**
 * Qué IPv4 usan los routers cuando el campo queda vacío: la de la dirección pública del portal
 * (`portal_url`), o el nombre que el servidor resuelve. `null` si el servidor no tiene esa dirección.
 */
export function ipv4Deducida(portalUrl: string | null): { tipo: 'ip' | 'nombre', valor: string } | null {
    if (!portalUrl) {
        return null
    }
    let host: string
    try {
        host = new URL(portalUrl).hostname
    }
    catch {
        return null
    }
    if (!host) {
        return null
    }
    return OCTETO.test(host) ? { tipo: 'ip', valor: host } : { tipo: 'nombre', valor: host }
}

/** Ayuda del campo IPv4 vacío: qué dirección se usará en su lugar. */
export function ayudaIpv4Vacia(portalUrl: string | null): string {
    const deducida = ipv4Deducida(portalUrl)
    if (!deducida) {
        return 'Vacía: el servidor no tiene la dirección pública del portal, así que los routers no sabrían a dónde mandar a los suspendidos. Escribe la IPv4.'
    }
    if (deducida.tipo === 'ip') {
        return `Vacía: se usa ${deducida.valor}, la de la dirección pública del portal (${portalUrl}).`
    }
    return `Vacía: se usa la IPv4 de ${deducida.valor} (dirección pública del portal), que el servidor consulta cada vez que revisa los routers.`
}
