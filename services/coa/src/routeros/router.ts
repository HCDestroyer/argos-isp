import { descifrar } from '../cifrado.ts'
import { ClienteRouterOS, type Bitacora, type ConexionRouterOS } from './cliente.ts'

/**
 * Datos de `network.routers` que hacen falta para hablar con su API REST. `api_password` va cifrada
 * (`v1`, `AAA_PPP_KEY`); se descifra aquí y nunca sale del proceso. Los campos de URL y TLS son
 * opcionales: hasta que A1 los agregue al modelo (`.claude/integration/a2.md`) se usa `https://<host>`
 * y la verificación de certificado por defecto (`ROUTEROS_TLS_VERIFICAR`).
 */
export interface RouterApi {
    id: number
    host: string
    api_usuario: string | null
    api_password: string | null
    /** `https://host:puerto` explícito; si no viene se arma con `host` */
    api_url?: string | null
    /** null = el valor por defecto del entorno */
    api_tls_verificar?: boolean | null
    /** CA en PEM para routers con certificado propio */
    api_ca?: string | null
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
    /** Por defecto para routers sin `api_tls_verificar` (true salvo que el entorno diga otra cosa) */
    verificarTls?: boolean
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
            verificar: router.api_tls_verificar ?? op.verificarTls ?? true,
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
