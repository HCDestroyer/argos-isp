import { esErrorTls } from '#network/routeros/errores'

/**
 * Traduce un error del cliente REST de RouterOS a un `motivo` y un `detalle` en lenguaje simple, con
 * los comandos de RouterOS que lo arreglan (caso real del PM, 29 oct: `www-ssl` sin certificado →
 * `ssl3_read_bytes ... alert handshake failure ... SSL alert number 40`). El texto crudo de Node u
 * OpenSSL nunca es el detalle: queda en `error_tecnico`.
 *
 * Lo usan `routers.probar_conexion` (chequeo `api`) y el sondeo (`audit.red` del GET fallido).
 */

export const MOTIVOS_API = [
    'sin_credenciales',
    'sin_certificado',
    'certificado_no_confiable',
    'certificado_proposito',
    'puerto_cerrado',
    'protocolo',
    'credenciales',
    'politicas',
    'no_responde',
    'respuesta',
] as const
export type MotivoApi = (typeof MOTIVOS_API)[number]

export interface DiagnosticoRouterOS {
    motivo: MotivoApi
    detalle: string
    /** el mensaje original del cliente (Node/OpenSSL o RouterOS), solo para soporte */
    error_tecnico: string
}

export interface ErrorRouterOSLike {
    message: string
    tipo?: string
    codigo?: string | null
    status?: number | null
}

/** IP o nombre del router sin puerto (`172.31.250.54:443` → `172.31.250.54`). */
function soloHost(host: string | null | undefined): string {
    if (!host) return '<IP del router>'
    if (host.startsWith('[')) return host.slice(1, host.indexOf(']'))
    // `host:puerto` lleva un solo `:`; una IPv6 sin corchetes lleva varios
    return host.split(':').length === 2 ? host.split(':')[0]! : host
}

const esIp = (valor: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(valor)

/** Comandos para crear una CA en el router, firmar el certificado de `www-ssl` con ella y asignarlo. */
export function comandosCertificado(host: string): string {
    const san = esIp(host) ? `IP:${host}` : `DNS:${host}`
    return [
        '/certificate add name=argos-ca common-name=argos-ca key-usage=key-cert-sign,crl-sign days-valid=3650',
        '/certificate sign argos-ca',
        `/certificate add name=argosisp-api common-name=${host} subject-alt-name=${san} ` +
            'key-usage=digital-signature,key-encipherment,tls-server days-valid=3650',
        '/certificate sign argosisp-api ca=argos-ca',
        '/ip service set www-ssl certificate=argosisp-api disabled=no',
    ].join('\n')
}

/** Lo que hay que revisar ante `unsuitable certificate purpose` (y al pegar una `api_ca` que no es CA). */
export const MENSAJE_PROPOSITO =
    'El certificado que Argos usa para verificar no es una CA, o el del router no tiene el uso tls-server. ' +
    'Revisa: (1) en la CA del router (api_ca) va el certificado de la CA (argos-ca), no el del servicio ' +
    '(argosisp-api); (2) el certificado de www-ssl debe tener key-usage=...,tls-server y estar firmado con ' +
    'ca=argos-ca (/certificate add ... key-usage=digital-signature,key-encipherment,tls-server, luego ' +
    '/certificate sign argosisp-api ca=argos-ca)'

export function diagnosticarErrorRouterOS(
    error: ErrorRouterOSLike,
    hostRouter?: string | null,
): DiagnosticoRouterOS {
    const tecnico = error.message
    const texto = `${error.codigo ?? ''} ${tecnico}`
    const host = soloHost(hostRouter)
    const resultado = (motivo: MotivoApi, detalle: string): DiagnosticoRouterOS => ({
        motivo,
        detalle,
        error_tecnico: tecnico,
    })

    // RouterOS: sin la política `api` la REST responde «not allowed»; sin `rest-api`, 401 (A6, CHR 7.24.5)
    if (error.status === 403 || /not allowed|not enough permissions/i.test(tecnico)) {
        return resultado(
            'politicas',
            'El usuario de la API entra, pero su grupo no tiene las políticas necesarias. En el router: ' +
                '/user group set argosisp-api policy=read,write,api,rest-api',
        )
    }
    if (
        error.tipo === 'credenciales' ||
        error.status === 401 ||
        /credenciales de la API rechazadas/.test(tecnico)
    ) {
        return resultado(
            'credenciales',
            'El router rechazó el acceso (401): el usuario o la clave de la API no coinciden con los guardados en ' +
                'Argos, o al grupo le falta la política rest-api. Revisa la clave en la ficha del router o, en el ' +
                'router: /user group set argosisp-api policy=read,write,api,rest-api',
        )
    }
    if (/wrong version number/i.test(texto)) {
        return resultado(
            'protocolo',
            'Estás llamando por HTTPS a un puerto HTTP: la URL de la API apunta al servicio www (80) u otro puerto ' +
                'sin TLS. Usa el puerto de www-ssl (443 por defecto) en la URL de la API del router',
        )
    }
    if (/handshake failure|alert number 40|sslv3 alert handshake/i.test(texto)) {
        return resultado(
            'sin_certificado',
            `El router no tiene certificado en www-ssl, así que no puede hacer HTTPS. En el router (New Terminal):\n` +
                comandosCertificado(host),
        )
    }
    if (error.codigo === 'INVALID_PURPOSE' || /unsuitable certificate purpose/i.test(texto)) {
        return resultado('certificado_proposito', MENSAJE_PROPOSITO)
    }
    if (
        esErrorTls(error.codigo) ||
        /self.signed|unable to verify|unable to get local issuer|certificate has expired|altname/i.test(texto)
    ) {
        return resultado(
            'certificado_no_confiable',
            'El certificado del router no es de confianza para Argos. Dos opciones: desactiva «Verificar ' +
                'certificado TLS» en la ficha del router, o pega su CA en la ficha (en el router: ' +
                '/certificate export-certificate argos-ca y descarga el .crt desde Files)',
        )
    }
    if (
        error.codigo === 'ECONNREFUSED' ||
        error.codigo === 'ETIMEDOUT' ||
        /\bECONNREFUSED\b|\bETIMEDOUT\b/.test(tecnico) ||
        /sin respuesta en \d+ ms/.test(tecnico)
    ) {
        return resultado(
            'puerto_cerrado',
            'www-ssl está apagado o un firewall lo bloquea (o el router no es alcanzable desde Argos). En el router: ' +
                '/ip service set www-ssl disabled=no y revisa que /ip firewall filter acepte el 443 desde Argos ' +
                '(el script de conexión lo deja abierto solo por el túnel)',
        )
    }
    if (error.tipo === 'respuesta' || error.tipo === 'solicitud') {
        return resultado('respuesta', 'El router respondió algo que la API REST no esperaba (¿RouterOS 7?)')
    }
    return resultado(
        'no_responde',
        'El router no responde: está apagado, la IP o el host de la API son incorrectos o no hay ruta hasta él',
    )
}
