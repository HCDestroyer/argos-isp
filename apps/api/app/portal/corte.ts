import { isIPv4, isIPv6 } from 'node:net'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'

/**
 * Configuración del portal de corte (`core.portal_corte`, una fila global; pedido del PM, 6 nov): a
 * dónde mandan los routers el HTTP de los suspendidos (dst-nat → `/corte`) y cómo se suspende una
 * sesión PPPoE (`desconectar` | `coa`). Se edita con `portal_corte.configurar` (`PUT /corte/configuracion`).
 *
 * Global, no por empresa: un router sirve servicios de varias empresas y su NAT de corte es uno solo; la
 * página por empresa sigue en `core.empresas.url_corte` (el portal responde 302 a ella).
 *
 * Las variables de entorno de antes (`ROUTERS_SERVICIO_PORTAL_V4`, `_V6`, `_PUERTO` y `COA_SUSPENDER`)
 * solo siembran: mientras la fila tiene `version = 0` (nadie la guardó) la vista sale de ellas
 * (`origen: 'entorno'`); desde la primera edición manda la fila y el entorno ya no se lee.
 *
 * Sin caché: el reconciliador, el diagnóstico y `GET /internal/corte/configuracion` leen la fila cada vez. Quien
 * guarde una copia (`services/coa`) la relee con `portal.config_cambiada`.
 */

export const MODOS_SUSPENSION = ['desconectar', 'coa'] as const
export type ModoSuspension = (typeof MODOS_SUSPENSION)[number]

/** Lo que el panel edita. */
export const CAMPOS_PORTAL_CORTE = ['portal_v4', 'portal_v6', 'portal_puerto', 'modo_suspension'] as const
export type CampoPortalCorte = (typeof CAMPOS_PORTAL_CORTE)[number]

/** Campos que cambian las reglas de los routers (los demás, como `modo_suspension`, no). */
export const CAMPOS_RED_PORTAL = new Set<string>(['url_corte', 'portal_v4', 'portal_v6', 'portal_puerto'])

export interface DatosPortalCorte {
    /** IPv4 del `to-addresses` del dst-nat; null = se deduce de `PORTAL_URL_PUBLICA` (IP o FQDN) */
    portal_v4: string | null
    /** IPv6 del portal para el NAT de IPv6; null = el HTTP por IPv6 recibe reset y el equipo cae a IPv4 */
    portal_v6: string | null
    /** `to-ports` del dst-nat (80, u 8088 con el puerto dedicado del Caddy de Argos) */
    portal_puerto: number
    modo_suspension: ModoSuspension
}

export interface PortalCorteVista extends DatosPortalCorte {
    /** `entorno`: nunca se guardó y los valores salen de las variables de antes; `configuracion`: de la fila */
    origen: 'configuracion' | 'entorno'
    /** `PORTAL_URL_PUBLICA` (solo lectura): de ahí sale la IPv4 cuando `portal_v4` es null */
    portal_url: string | null
    /** 0 = nunca se guardó */
    version: number
    updated_at: string | null
}

const limpio = (v: string | undefined) => v?.trim() || null

/** Valores iniciales desde el entorno (compatibilidad con las instalaciones de antes de v1.12). */
export function semillaPortalCorte(entorno: NodeJS.ProcessEnv = process.env): DatosPortalCorte {
    const v4 = limpio(entorno.ROUTERS_SERVICIO_PORTAL_V4)
    const v6 = limpio(entorno.ROUTERS_SERVICIO_PORTAL_V6)
    const puerto = Number(limpio(entorno.ROUTERS_SERVICIO_PORTAL_PUERTO) ?? 80)
    return {
        portal_v4: v4 && isIPv4(v4) ? v4 : null,
        portal_v6: v6 && isIPv6(v6) ? v6.toLowerCase() : null,
        portal_puerto: Number.isInteger(puerto) && puerto > 0 && puerto < 65536 ? puerto : 80,
        modo_suspension: limpio(entorno.COA_SUSPENDER) === 'coa' ? 'coa' : 'desconectar',
    }
}

interface FilaPortalCorte {
    portal_v4: string | null
    portal_v6: string | null
    portal_puerto: number
    modo_suspension: ModoSuspension
    version: number
    updated_at: Date | string | null
}

/** `inet` llega como `192.0.2.20` o `192.0.2.20/32` según el driver: sin máscara. */
const sinMascara = (ip: string | null) => (ip ? ip.split('/')[0]! : null)

export async function verPortalCorte(
    cliente: QueryClientContract = db.connection(),
    entorno: NodeJS.ProcessEnv = process.env,
): Promise<PortalCorteVista> {
    const fila = (await cliente
        .from('core.portal_corte')
        .where('id', 1)
        .select('portal_v4', 'portal_v6', 'portal_puerto', 'modo_suspension', 'version', 'updated_at')
        .first()) as FilaPortalCorte | null
    const portalUrl = limpio(entorno.PORTAL_URL_PUBLICA)
    if (!fila || Number(fila.version) === 0) {
        return {
            ...semillaPortalCorte(entorno),
            origen: 'entorno',
            portal_url: portalUrl,
            version: 0,
            updated_at: null,
        }
    }
    return {
        portal_v4: sinMascara(fila.portal_v4),
        portal_v6: sinMascara(fila.portal_v6),
        portal_puerto: Number(fila.portal_puerto),
        modo_suspension: fila.modo_suspension,
        origen: 'configuracion',
        portal_url: portalUrl,
        version: Number(fila.version),
        updated_at: fila.updated_at ? new Date(fila.updated_at).toISOString() : null,
    }
}

export function sinMetadatos(vista: PortalCorteVista): DatosPortalCorte {
    return {
        portal_v4: vista.portal_v4,
        portal_v6: vista.portal_v6,
        portal_puerto: vista.portal_puerto,
        modo_suspension: vista.modo_suspension,
    }
}
