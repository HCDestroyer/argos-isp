/**
 * Errores tipados del cliente REST de RouterOS 7. `tipo` permite decidir sin `instanceof` (p. ej.
 * en logs o en `routeros.fallido`) y `reintentable` dice si tiene sentido volver a intentarlo.
 */

export type TipoErrorRouterOS = 'inalcanzable' | 'credenciales' | 'solicitud' | 'respuesta'

export class ErrorRouterOS extends Error {
    readonly tipo: TipoErrorRouterOS
    /** Código HTTP si el router respondió */
    readonly status: number | null
    readonly reintentable: boolean

    constructor(tipo: TipoErrorRouterOS, mensaje: string, status: number | null, reintentable: boolean) {
        super(mensaje)
        this.name = 'ErrorRouterOS'
        this.tipo = tipo
        this.status = status
        this.reintentable = reintentable
    }
}

/** Sin conexión, timeout, TLS inválido o 5xx: se reintenta con backoff. */
export class RouterOSInalcanzable extends ErrorRouterOS {
    /** Código de Node (`ECONNREFUSED`, `ETIMEDOUT`, `DEPTH_ZERO_SELF_SIGNED_CERT`…) */
    readonly codigo: string | null

    constructor(mensaje: string, codigo: string | null = null, status: number | null = null) {
        // Un certificado inválido no se arregla reintentando.
        super('inalcanzable', mensaje, status, !esErrorTls(codigo))
        this.name = 'RouterOSInalcanzable'
        this.codigo = codigo
    }
}

/** 401/403: usuario o contraseña de la API incorrectos, o usuario sin la política `rest-api`. */
export class RouterOSCredenciales extends ErrorRouterOS {
    constructor(status: number, mensaje = 'credenciales de la API rechazadas') {
        super('credenciales', mensaje, status, false)
        this.name = 'RouterOSCredenciales'
    }
}

/**
 * 400 (o 404/406…) de RouterOS: el comando es inválido para el equipo. `detalle` es el texto del
 * router (`failure: already have such entry`, `no such command prefix`…).
 */
export class RouterOSSolicitud extends ErrorRouterOS {
    readonly detalle: string

    constructor(status: number, mensaje: string, detalle: string) {
        super('solicitud', detalle ? `${mensaje}: ${detalle}` : mensaje, status, false)
        this.name = 'RouterOSSolicitud'
        this.detalle = detalle
    }
}

/** El router respondió algo que no es JSON o no tiene la forma esperada. */
export class RouterOSRespuesta extends ErrorRouterOS {
    constructor(mensaje: string, status: number | null) {
        super('respuesta', mensaje, status, false)
        this.name = 'RouterOSRespuesta'
    }
}

const CODIGOS_TLS = new Set([
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'CERT_HAS_EXPIRED',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'CERT_NOT_YET_VALID',
])

export function esErrorTls(codigo: string | null | undefined): boolean {
    return codigo !== null && codigo !== undefined && CODIGOS_TLS.has(codigo)
}
