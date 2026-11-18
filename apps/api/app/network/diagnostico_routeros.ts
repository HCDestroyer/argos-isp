import { esErrorTls } from '#network/routeros/errores'
import { MENSAJE_PROXY_DEVICE_MODE } from '#network/routeros/corte_router'

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
    /** RouterOS respondió y rechazó un comando (400): el detalle dice cuál y el texto del router */
    'rechazado',
    /** El device-mode del router (RouterOS 7.17+) no permite una función que Argos usa (el proxy web) */
    'device_mode',
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
    /** `tipo` del cliente (`inalcanzable`, `credenciales`, `solicitud`, `respuesta`) o `sin_credenciales` */
    tipo?: string
    codigo?: string | null
    status?: number | null
    /** Comando que falló, estilo RouterOS (`ip/proxy/access add`) */
    operacion?: string | null
}

/** Códigos de Node de un problema de red (el router no es alcanzable). */
const CODIGOS_RED =
    /\b(EHOSTUNREACH|ENETUNREACH|EHOSTDOWN|ENOTFOUND|EAI_AGAIN|ECONNRESET|EPIPE|ECONNABORTED)\b/

/** Mensaje de un 400 de RouterOS (`Bad Request: failure: invalid local port`) sin el prefijo HTTP. */
function textoRouter(mensaje: string): string {
    return mensaje.replace(/^Bad Request: /, '')
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

    // Device-mode (RouterOS 7.17+): «not allowed by device-mode» no es un problema de políticas del usuario.
    if (/device-mode/i.test(tecnico)) return resultado('device_mode', MENSAJE_PROXY_DEVICE_MODE)
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
    // El router respondió y rechazó un comando: se dice cuál y qué contestó, nunca «no responde».
    if (error.tipo === 'solicitud') {
        const comando = error.operacion ? `«${error.operacion}»` : 'un comando'
        const rechazo = textoRouter(tecnico)
        const pista = /invalid local port/i.test(rechazo)
            ? ' Si el router es RouterOS 7.17 o más nuevo, revisa el device-mode (/system/device-mode/print): ' +
              MENSAJE_PROXY_DEVICE_MODE
            : ''
        return resultado('rechazado', `RouterOS rechazó ${comando}: ${rechazo}.${pista}`)
    }
    if (error.tipo === 'respuesta') {
        return resultado('respuesta', 'El router respondió algo que la API REST no esperaba (¿RouterOS 7?)')
    }
    if (error.tipo === 'sin_credenciales') {
        return resultado(
            'sin_credenciales',
            'Argos no tiene el usuario y la clave de la API REST de este router. Cárgalos en la ficha del router',
        )
    }
    // «No responde» solo cuando es de red: el cliente lo marcó inalcanzable o Node dio un código de red.
    if (error.tipo === 'inalcanzable' || CODIGOS_RED.test(texto)) {
        return resultado(
            'no_responde',
            'El router no responde: está apagado, la IP o el host de la API son incorrectos o no hay ruta hasta él',
        )
    }
    return resultado('respuesta', `Error al hablar con el router: ${textoRouter(tecnico)}`)
}
