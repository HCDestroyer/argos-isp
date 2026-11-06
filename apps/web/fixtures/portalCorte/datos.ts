import type { Schema } from '@argosisp/contracts'

/**
 * `GET /corte/configuracion` de una instalación que nunca guardó (A5): `version` 0, `origen: 'entorno'`
 * y los valores por defecto de la siembra (`semillaPortalCorte`: sin IPs, puerto 80, `desconectar`).
 * La IPv4 se deduce de la dirección pública del portal.
 */
export function portalCorteInicial(): Schema<'PortalCorte'> {
    return {
        portal_v4: null,
        portal_v6: null,
        portal_puerto: 80,
        modo_suspension: 'desconectar',
        origen: 'entorno',
        portal_url: 'http://portal.argosnet.gt',
        version: 0,
        updated_at: null,
    }
}
