import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import {
    configCorte,
    conUrlsCorte,
    configCorteResuelta,
    resolverIPv4,
    type ConfigCorte,
    type PortalCorteRed,
    type ResolverIPv4,
} from '#network/routeros/corte_router'
import { urlsCorte } from '#network/routeros/consultas'
import { verPortalCorte } from '#portal/corte'

/** Destino del NAT de corte guardado en «Portal de corte» (o la siembra del entorno si nunca se guardó). */
export async function portalCorteRed(
    cliente: QueryClientContract = db.connection(),
): Promise<PortalCorteRed> {
    const vista = await verPortalCorte(cliente)
    return {
        portal_v4: vista.portal_v4,
        portal_v6: vista.portal_v6,
        portal_puerto: vista.portal_puerto,
        origen: vista.origen,
    }
}

/**
 * La configuración de corte que se escribe en los routers y que revisa el diagnóstico: entorno de la API
 * (walled garden, DNS, redes), destino del NAT de `core.portal_corte`, FQDN resuelto en cada llamada y
 * hosts de las `url_corte` de las empresas. Sin caché: `portal.config_cambiada` reconcilia los routers.
 */
export async function configCorteVigente(
    resolver: ResolverIPv4 = resolverIPv4,
    cliente: QueryClientContract = db.connection(),
): Promise<ConfigCorte> {
    const portal = await portalCorteRed(cliente)
    return conUrlsCorte(await configCorteResuelta(process.env, resolver, portal), await urlsCorte(cliente))
}

/**
 * URL de `/corte` para las reglas por servicio del proxy (modo código): la pública del portal o, sin
 * ella, el destino del NAT. Sin resolver el FQDN (no hace falta para una URL con nombre).
 */
export async function corteUrlVigente(
    cliente: QueryClientContract = db.connection(),
): Promise<string | null> {
    return configCorte(process.env, await portalCorteRed(cliente)).corte_url
}
