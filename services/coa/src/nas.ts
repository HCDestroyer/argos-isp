import { createSocket, type Socket } from 'node:dgram'
import { isIP } from 'node:net'
import { fileURLToPath } from 'node:url'
import radius from 'radius'
import { firmarPeticion, verificarRespuesta } from './firma.ts'

/**
 * Envío de CoA-Request y Disconnect-Request (RFC 5176) al `/radius incoming` del NAS (UDP 3799)
 * con el paquete `radius`. Un socket por envío: el NAS responde al puerto de origen y así cada
 * respuesta se empareja sin tabla de identificadores.
 *
 * Todo paquete lleva `Message-Authenticator` (RouterOS 7.15+ lo exige desde Blast-RADIUS) y la
 * respuesta se verifica con el secret antes de creerla. Las firmas se calculan en `firma.ts`.
 */

radius.add_dictionary(fileURLToPath(new URL('../diccionarios/dictionary.mikrotik', import.meta.url)))

export type TipoPaquete = 'coa' | 'disconnect'

export interface Envio {
    tipo: TipoPaquete
    nasIp: string
    puerto: number
    secret: string
    /** Identificación de la sesión (`User-Name`, `Acct-Session-Id`) + atributos a cambiar. */
    atributos: Record<string, string>
    timeoutMs: number
}

export interface Respuesta {
    resultado: 'ack' | 'nak' | 'timeout' | 'error'
    /** Código RADIUS recibido (`CoA-ACK`, `Disconnect-NAK`…) */
    codigo?: string
    /** Atributos de la respuesta (p. ej. `Error-Cause` en un NAK) */
    atributos?: Record<string, unknown>
    error?: string
    rttMs: number
}

/** Lo que el dispatcher necesita para hablar con el NAS (UDP real o falso en pruebas). */
export interface ClienteNas {
    enviar(envio: Envio): Promise<Respuesta>
}

const VSA_MIKROTIK = 'Mikrotik-'

/** Atributos planos → formato del paquete `radius` (los `Mikrotik-*` van como Vendor-Specific). */
export function atributosRadius(atributos: Record<string, string>): unknown[] {
    const salida: unknown[] = []
    for (const [nombre, valor] of Object.entries(atributos)) {
        if (nombre.startsWith(VSA_MIKROTIK)) salida.push(['Vendor-Specific', 'Mikrotik', [[nombre, valor]]])
        else salida.push([nombre, valor])
    }
    return salida
}

/** Aplana `Vendor-Specific` de un paquete decodificado. */
export function aplanar(atributos: Record<string, unknown>): Record<string, unknown> {
    const salida: Record<string, unknown> = {}
    for (const [nombre, valor] of Object.entries(atributos)) {
        if (nombre === 'Message-Authenticator') continue
        if (nombre === 'Vendor-Specific' && typeof valor === 'object' && valor !== null) {
            Object.assign(salida, valor)
        } else salida[nombre] = Buffer.isBuffer(valor) ? valor.toString('hex') : valor
    }
    return salida
}

const ACK = { coa: 'CoA-ACK', disconnect: 'Disconnect-ACK' } as const
const NAK = { coa: 'CoA-NAK', disconnect: 'Disconnect-NAK' } as const

export class ClienteNasUdp implements ClienteNas {
    readonly #origen: string | undefined

    /** @param origen IP local desde la que se envía (debe ser la que el NAS tiene en `/radius`). */
    constructor(origen?: string) {
        this.#origen = origen
    }

    enviar(envio: Envio): Promise<Respuesta> {
        const inicio = performance.now()
        const rtt = () => Math.round(performance.now() - inicio)
        const familia = isIP(envio.nasIp) === 6 ? 'udp6' : 'udp4'
        const paquete = firmarPeticion(
            radius.encode({
                code: envio.tipo === 'coa' ? 'CoA-Request' : 'Disconnect-Request',
                secret: envio.secret,
                identifier: Math.floor(Math.random() * 256),
                attributes: [
                    ...atributosRadius(envio.atributos),
                    ['Message-Authenticator', Buffer.alloc(16)],
                ],
                add_message_authenticator: false,
            }),
            envio.secret,
        )

        return new Promise<Respuesta>((resolver) => {
            const socket: Socket = createSocket(familia)
            let terminado = false
            const terminar = (r: Respuesta) => {
                if (terminado) return
                terminado = true
                clearTimeout(temporizador)
                socket.close()
                resolver(r)
            }
            const temporizador = setTimeout(
                () => terminar({ resultado: 'timeout', rttMs: rtt() }),
                envio.timeoutMs,
            )

            socket.on('error', (e) => terminar({ resultado: 'error', error: e.message, rttMs: rtt() }))
            socket.on('message', (mensaje, remoto) => {
                if (remoto.address !== envio.nasIp && remoto.address !== `::ffff:${envio.nasIp}`) return
                // Respuesta a otro paquete o con otro secret: se descarta y se sigue esperando.
                if (!verificarRespuesta(paquete, mensaje, envio.secret)) return
                let decodificado
                try {
                    decodificado = radius.decode_without_secret({ packet: mensaje })
                } catch {
                    return
                }
                const codigo = decodificado.code
                const atributos = aplanar(decodificado.attributes as Record<string, unknown>)
                if (codigo === ACK[envio.tipo])
                    terminar({ resultado: 'ack', codigo, atributos, rttMs: rtt() })
                else if (codigo === NAK[envio.tipo])
                    terminar({ resultado: 'nak', codigo, atributos, rttMs: rtt() })
            })
            socket.bind({ port: 0, address: this.#origen }, () => {
                socket.send(paquete, envio.puerto, envio.nasIp, (e) => {
                    if (e) terminar({ resultado: 'error', error: e.message, rttMs: rtt() })
                })
            })
        })
    }
}
