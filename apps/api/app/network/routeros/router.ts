import { descifrar } from '#shared/cifrado'
import { ClienteRouterOS, type Bitacora, type ConexionRouterOS } from '#network/routeros/cliente'

/**
 * Datos de `network.routers` que hacen falta para hablar con su API REST (columnas de A1, contrato en
 * `contratos/routeros.md`, "Conexión del router"). `api_password` va cifrada (`v1`, `AAA_PPP_KEY`);
 * se descifra aquí y nunca sale del proceso.
 */
export interface RouterApi {
    id: number
    host: string
    api_usuario: string | null
    api_password: string | null
    /** `https://host:puerto` explícito; null = `https://<host>` */
    api_url: string | null
    /**
     * Verificar el certificado del router (columna NOT NULL, por defecto true). Es la única fuente:
     * para un certificado autofirmado se carga `api_ca` o se pone false en ese router.
     */
    api_tls_verificar: boolean
    /** CA en PEM para routers con certificado propio */
    api_ca: string | null
}

export class RouterSinCredenciales extends Error {
    constructor(routerId: number, motivo: string) {
        super(`router ${routerId}: ${motivo}`)
        this.name = 'RouterSinCredenciales'
    }
}

export interface OpcionesRouter {
    clave: Buffer
    bitacora?: Bitacora
    timeoutMs?: number
    reintentos?: number
    esperaMs?: number
}

export function urlDeRouter(router: Pick<RouterApi, 'host' | 'api_url'>): string {
    if (router.api_url) return router.api_url
    return router.host.includes('://') ? router.host : `https://${router.host}`
}

export function conexionDeRouter(router: RouterApi, op: OpcionesRouter): ConexionRouterOS {
    if (!router.api_usuario || !router.api_password) {
        throw new RouterSinCredenciales(router.id, 'sin api_usuario o api_password')
    }
    let password: string
    try {
        password = descifrar(router.api_password, op.clave)
    } catch {
        throw new RouterSinCredenciales(router.id, 'api_password no se puede descifrar')
    }
    return {
        routerId: router.id,
        url: urlDeRouter(router),
        usuario: router.api_usuario,
        password,
        tls: {
            verificar: router.api_tls_verificar,
            ...(router.api_ca ? { ca: router.api_ca } : {}),
        },
        timeoutMs: op.timeoutMs,
        reintentos: op.reintentos,
        esperaMs: op.esperaMs,
    }
}

export function clienteDeRouter(router: RouterApi, op: OpcionesRouter): ClienteRouterOS {
    return new ClienteRouterOS(conexionDeRouter(router, op), { bitacora: op.bitacora })
}
