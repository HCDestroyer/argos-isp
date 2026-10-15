import { createSocket, type Socket } from 'node:dgram'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import radius from 'radius'
import { verificarPeticion } from '../src/firma.ts'
import { aplanar } from '../src/nas.ts'

/**
 * NAS simulado: un `/radius incoming` como el de RouterOS (UDP, RFC 5176). Verifica el Request
 * Authenticator y el Message-Authenticator con el secret (`firma.ts`; si no cuadran no responde,
 * como el MikroTik) y contesta ACK, NAK con `Error-Cause` o nada, según `modo`.
 *
 * También corre como proceso (lo usa la prueba de punta a punta de `apps/api`):
 *   node services/coa/test/nas_simulado.ts --ip 127.0.0.5 --secret s --modo ack
 * imprime `{"listo":true,"puerto":N}` y luego una línea JSON por paquete recibido.
 */

export type Modo = 'ack' | 'nak' | 'silencio'

export interface PaqueteRecibido {
    codigo: string
    atributos: Record<string, unknown>
    /** Request Authenticator y Message-Authenticator correctos para el secret (RFC 5176) */
    firmaValida: boolean
    messageAuthenticator: boolean
    respondido: string | null
}

export class NasSimulado {
    readonly recibidos: PaqueteRecibido[] = []
    modo: Modo | ((n: number) => Modo) = 'ack'
    puerto = 0
    readonly #socket: Socket
    readonly #ip: string
    readonly #secret: string
    alRecibir?: (p: PaqueteRecibido) => void

    constructor(opciones: { ip?: string; secret: string; modo?: Modo }) {
        this.#ip = opciones.ip ?? '127.0.0.1'
        this.#secret = opciones.secret
        if (opciones.modo) this.modo = opciones.modo
        this.#socket = createSocket('udp4')
        this.#socket.on('message', (mensaje, remoto) => this.#atender(mensaje, remoto))
    }

    async iniciar(puerto = 0): Promise<void> {
        await new Promise<void>((resolver) => this.#socket.bind(puerto, this.#ip, resolver))
        this.puerto = (this.#socket.address() as AddressInfo).port
    }

    async cerrar(): Promise<void> {
        await new Promise<void>((resolver) => this.#socket.close(() => resolver()))
    }

    #atender(mensaje: Buffer, remoto: { address: string; port: number }) {
        let decodificado
        try {
            decodificado = radius.decode_without_secret({ packet: mensaje })
        } catch {
            return
        }
        // Como RouterOS: con firma inválida (otro secret) no responde.
        const valido = verificarPeticion(mensaje, this.#secret)
        const n = this.recibidos.length + 1
        const modo = typeof this.modo === 'function' ? this.modo(n) : this.modo
        const tipo = decodificado.code === 'CoA-Request' ? 'CoA' : 'Disconnect'
        const recibido: PaqueteRecibido = {
            codigo: decodificado.code,
            atributos: aplanar(decodificado.attributes as Record<string, unknown>),
            firmaValida: valido,
            messageAuthenticator: 'Message-Authenticator' in (decodificado.attributes as object),
            respondido: null,
        }
        if (valido && modo !== 'silencio') {
            const codigo = modo === 'ack' ? `${tipo}-ACK` : `${tipo}-NAK`
            const respuesta = radius.encode_response({
                packet: decodificado,
                code: codigo,
                secret: this.#secret,
                attributes: modo === 'nak' ? [['Error-Cause', 'Session-Context-Not-Found']] : [],
            })
            this.#socket.send(respuesta, remoto.port, remoto.address)
            recibido.respondido = codigo
        }
        this.recibidos.push(recibido)
        this.alRecibir?.(recibido)
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const arg = (nombre: string, porDefecto?: string) => {
        const i = process.argv.indexOf(`--${nombre}`)
        return i >= 0 ? process.argv[i + 1] : porDefecto
    }
    const nas = new NasSimulado({
        ip: arg('ip', '127.0.0.1'),
        secret: arg('secret', 'secreto')!,
        modo: arg('modo', 'ack') as Modo,
    })
    nas.alRecibir = (p) => console.log(JSON.stringify(p))
    await nas.iniciar(Number(arg('puerto', '0')))
    console.log(JSON.stringify({ listo: true, puerto: nas.puerto }))
    process.on('SIGTERM', () => void nas.cerrar().then(() => process.exit(0)))
}
