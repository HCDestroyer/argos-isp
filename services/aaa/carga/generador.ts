import { createHash, createHmac, randomBytes } from 'node:crypto'
import { createSocket, type Socket } from 'node:dgram'
import { isIPv4 } from 'node:net'

/**
 * Generador de carga RADIUS: N reconexiones PPPoE simultáneas como las haría un MikroTik tras un
 * corte de energía. Por cliente: Accounting Stop de la sesión anterior → Access-Request CHAP →
 * Accounting Start dual-stack (IPv4, /64 y /56). Sin dependencias: codifica los paquetes a mano
 * (RFC 2865/2866, 3162, 4818) y firma `Message-Authenticator` como RouterOS 7.15+.
 *
 * La latencia de autorización se mide en el cliente (Access-Request → Accept/Reject), es decir
 * FreeRADIUS + rlm_rest + aaa (+ Redis o el respaldo). Un timeout es lo que el MikroTik vería
 * como "no responde" (`/radius timeout`, 1 s por defecto en el laboratorio).
 */

export interface UsuarioCarga {
    user: string
    clave: string
    ipv4: string
    /** /64 de enlace */
    enlace: string
    /** /56 delegado (solo en el Start si `enviarDelegado`; RouterOS 7.24 no lo manda) */
    delegado?: string
    /** Acct-Session-Id de la sesión anterior (se cierra con Stop antes de reconectar) */
    sesionAnterior?: string
}

export interface OpcionesCarga {
    host: string
    puertoAuth: number
    puertoAcct: number
    secret: string
    nasIp: string
    usuarios: UsuarioCarga[]
    /** Espera por respuesta, ms (por defecto 1000, como `/radius timeout=1s`) */
    timeoutMs?: number
    /** Incluir Delegated-IPv6-Prefix en el Start */
    enviarDelegado?: boolean
}

export interface ResultadoCarga {
    clientes: number
    accept: number
    reject: number
    timeoutsAuth: number
    /** Accepts sin Framed-IPv6-Prefix o sin Delegated-IPv6-Prefix */
    sinDualStack: number
    latenciaMs: { p50: number; p95: number; p99: number; max: number; media: number }
    acct: { start: number; stop: number; timeouts: number }
    duracionMs: number
    /** Acct-Session-Id del Start de cada usuario (para la siguiente vuelta) */
    sesiones: Record<string, string>
    rechazados: string[]
}

const CODIGO = { accessRequest: 1, accessAccept: 2, accessReject: 3, acctRequest: 4, acctResponse: 5 }

const ATR = {
    userName: 1,
    chapPassword: 3,
    nasIp: 4,
    nasPort: 5,
    serviceType: 6,
    framedProtocol: 7,
    framedIp: 8,
    callingStationId: 31,
    nasIdentifier: 32,
    acctStatusType: 40,
    acctInputOctets: 42,
    acctOutputOctets: 43,
    acctSessionId: 44,
    acctSessionTime: 46,
    acctTerminateCause: 49,
    eventTimestamp: 55,
    chapChallenge: 60,
    nasPortType: 61,
    messageAuthenticator: 80,
    framedIpv6Prefix: 97,
    delegatedIpv6Prefix: 123,
} as const

type Atributo = [tipo: number, valor: Buffer]

const texto = (t: number, v: string): Atributo => [t, Buffer.from(v, 'utf8')]
const entero = (t: number, v: number): Atributo => {
    const b = Buffer.alloc(4)
    b.writeUInt32BE(v >>> 0)
    return [t, b]
}
const ipv4 = (t: number, v: string): Atributo => {
    if (!isIPv4(v)) throw new Error(`IPv4 inválida: ${v}`)
    return [t, Buffer.from(v.split('.').map(Number))]
}

/** `2001:db8::/64` → bytes del prefijo (RFC 3162: reservado, longitud, prefijo truncado). */
export function prefijoIpv6(t: number, cidr: string): Atributo {
    const [direccion, largo] = cidr.split('/') as [string, string]
    const bits = Number(largo)
    const [izq, der = ''] = direccion.split('::') as [string, string?]
    const a = izq ? izq.split(':') : []
    const b = der ? der.split(':') : []
    const grupos = [...a, ...Array(8 - a.length - b.length).fill('0'), ...b]
    const bytes = Buffer.alloc(16)
    grupos.forEach((g, i) => bytes.writeUInt16BE(parseInt(g || '0', 16), i * 2))
    return [t, Buffer.concat([Buffer.from([0, bits]), bytes.subarray(0, Math.ceil(bits / 8))])]
}

function codificar(codigo: number, id: number, autenticador: Buffer, atributos: Atributo[]): Buffer {
    const cuerpo = Buffer.concat(
        atributos.map(([t, v]) => Buffer.concat([Buffer.from([t, v.length + 2]), v])),
    )
    const cabecera = Buffer.alloc(20)
    cabecera.writeUInt8(codigo, 0)
    cabecera.writeUInt8(id, 1)
    cabecera.writeUInt16BE(20 + cuerpo.length, 2)
    autenticador.copy(cabecera, 4)
    return Buffer.concat([cabecera, cuerpo])
}

function accessRequest(
    id: number,
    u: UsuarioCarga,
    nasIp: string,
    secret: string,
): { paquete: Buffer; autenticador: Buffer } {
    const autenticador = randomBytes(16)
    const desafio = randomBytes(16)
    const chapId = randomBytes(1)
    const hash = createHash('md5').update(chapId).update(u.clave).update(desafio).digest()
    const atributos: Atributo[] = [
        texto(ATR.userName, u.user),
        [ATR.chapPassword, Buffer.concat([chapId, hash])],
        [ATR.chapChallenge, desafio],
        entero(ATR.serviceType, 2),
        entero(ATR.framedProtocol, 1),
        entero(ATR.nasPortType, 15),
        entero(ATR.nasPort, 0x00f0_0000 + id),
        texto(
            ATR.callingStationId,
            `02:00:00:00:${((id >> 8) & 0xff).toString(16).padStart(2, '0')}:${(id & 0xff).toString(16).padStart(2, '0')}`,
        ),
        texto(ATR.nasIdentifier, 'argos-carga'),
        ipv4(ATR.nasIp, nasIp),
        [ATR.messageAuthenticator, Buffer.alloc(16)],
    ]
    const paquete = codificar(CODIGO.accessRequest, id & 0xff, autenticador, atributos)
    const mac = createHmac('md5', secret).update(paquete).digest()
    mac.copy(paquete, paquete.length - 16)
    return { paquete, autenticador }
}

function acctRequest(
    id: number,
    atributos: Atributo[],
    secret: string,
): { paquete: Buffer; autenticador: Buffer } {
    const paquete = codificar(CODIGO.acctRequest, id & 0xff, Buffer.alloc(16), atributos)
    const autenticador = createHash('md5').update(paquete).update(secret).digest()
    autenticador.copy(paquete, 4)
    return { paquete, autenticador }
}

/** Verifica el Response Authenticator y devuelve los tipos de atributo recibidos. */
function leerRespuesta(
    r: Buffer,
    autenticadorPeticion: Buffer,
    secret: string,
): { codigo: number; tipos: Set<number> } | null {
    if (r.length < 20) return null
    const largo = r.readUInt16BE(2)
    const copia = Buffer.from(r.subarray(0, largo))
    const recibido = Buffer.from(copia.subarray(4, 20))
    autenticadorPeticion.copy(copia, 4)
    const esperado = createHash('md5').update(copia).update(secret).digest()
    if (!esperado.equals(recibido)) return null
    const tipos = new Set<number>()
    for (let i = 20; i + 2 <= largo;) {
        const l = r[i + 1]!
        if (l < 2) break
        tipos.add(r[i]!)
        i += l
    }
    return { codigo: r[0]!, tipos }
}

/** Envía y espera la respuesta en un socket propio (como un NAS por cliente: sin colisión de ids). */
function intercambiar(
    socket: Socket,
    host: string,
    puerto: number,
    paquete: Buffer,
    timeoutMs: number,
): Promise<Buffer | null> {
    return new Promise((resolver) => {
        const reloj = setTimeout(() => {
            socket.off('message', alRecibir)
            resolver(null)
        }, timeoutMs)
        const alRecibir = (msg: Buffer) => {
            if (msg[1] !== paquete[1]) return
            clearTimeout(reloj)
            socket.off('message', alRecibir)
            resolver(msg)
        }
        socket.on('message', alRecibir)
        socket.send(paquete, puerto, host)
    })
}

function percentil(ordenado: number[], p: number): number {
    if (ordenado.length === 0) return 0
    const i = Math.min(ordenado.length - 1, Math.ceil((p / 100) * ordenado.length) - 1)
    return Math.round(ordenado[Math.max(0, i)]! * 10) / 10
}

let siguienteSesion = 0

export async function reconexiones(op: OpcionesCarga): Promise<ResultadoCarga> {
    const timeoutMs = op.timeoutMs ?? 1000
    const latencias: number[] = []
    const resultado: ResultadoCarga = {
        clientes: op.usuarios.length,
        accept: 0,
        reject: 0,
        timeoutsAuth: 0,
        sinDualStack: 0,
        latenciaMs: { p50: 0, p95: 0, p99: 0, max: 0, media: 0 },
        acct: { start: 0, stop: 0, timeouts: 0 },
        duracionMs: 0,
        sesiones: {},
        rechazados: [],
    }
    const inicio = performance.now()
    const prefijo = `${Date.now().toString(16)}`

    await Promise.all(
        op.usuarios.map(async (u, i) => {
            const socket = createSocket('udp4')
            await new Promise<void>((r) => socket.bind(0, () => r()))
            try {
                let id = i & 0xff
                const comunes = (sesion: string): Atributo[] => [
                    texto(ATR.userName, u.user),
                    ipv4(ATR.nasIp, op.nasIp),
                    entero(ATR.nasPort, 0x00f0_0000 + i),
                    entero(ATR.nasPortType, 15),
                    texto(ATR.acctSessionId, sesion),
                    entero(ATR.serviceType, 2),
                    entero(ATR.framedProtocol, 1),
                    ipv4(ATR.framedIp, u.ipv4),
                    prefijoIpv6(ATR.framedIpv6Prefix, u.enlace),
                    entero(ATR.eventTimestamp, Math.floor(Date.now() / 1000)),
                ]
                const contabilizar = async (atributos: Atributo[], tipo: 'start' | 'stop') => {
                    const { paquete, autenticador } = acctRequest(++id, atributos, op.secret)
                    const r = await intercambiar(socket, op.host, op.puertoAcct, paquete, timeoutMs * 3)
                    const leido = r ? leerRespuesta(r, autenticador, op.secret) : null
                    if (leido?.codigo === CODIGO.acctResponse) resultado.acct[tipo]++
                    else resultado.acct.timeouts++
                }

                // 1. El NAS cierra la sesión anterior (Lost-Carrier) al caerse el enlace.
                if (u.sesionAnterior) {
                    await contabilizar(
                        [
                            entero(ATR.acctStatusType, 2),
                            ...comunes(u.sesionAnterior),
                            entero(ATR.acctSessionTime, 3600),
                            entero(ATR.acctInputOctets, 1_000_000),
                            entero(ATR.acctOutputOctets, 9_000_000),
                            entero(ATR.acctTerminateCause, 2),
                        ],
                        'stop',
                    )
                }

                // 2. Access-Request CHAP.
                const { paquete, autenticador } = accessRequest(++id, u, op.nasIp, op.secret)
                const t0 = performance.now()
                const r = await intercambiar(socket, op.host, op.puertoAuth, paquete, timeoutMs)
                const ms = performance.now() - t0
                const leido = r ? leerRespuesta(r, autenticador, op.secret) : null
                if (!leido) {
                    resultado.timeoutsAuth++
                    resultado.rechazados.push(`${u.user}: timeout`)
                    return
                }
                latencias.push(ms)
                if (leido.codigo !== CODIGO.accessAccept) {
                    resultado.reject++
                    resultado.rechazados.push(`${u.user}: reject`)
                    return
                }
                resultado.accept++
                if (!leido.tipos.has(ATR.framedIpv6Prefix) || !leido.tipos.has(ATR.delegatedIpv6Prefix)) {
                    resultado.sinDualStack++
                }

                // 3. Start de la sesión nueva, dual-stack.
                const sesion = `${prefijo}${(++siguienteSesion).toString(16).padStart(6, '0')}`
                resultado.sesiones[u.user] = sesion
                await contabilizar(
                    [
                        entero(ATR.acctStatusType, 1),
                        ...comunes(sesion),
                        ...(op.enviarDelegado && u.delegado
                            ? [prefijoIpv6(ATR.delegatedIpv6Prefix, u.delegado)]
                            : []),
                    ],
                    'start',
                )
            } finally {
                socket.close()
            }
        }),
    )

    resultado.duracionMs = Math.round(performance.now() - inicio)
    const ordenado = latencias.sort((a, b) => a - b)
    resultado.latenciaMs = {
        p50: percentil(ordenado, 50),
        p95: percentil(ordenado, 95),
        p99: percentil(ordenado, 99),
        max: percentil(ordenado, 100),
        media: ordenado.length
            ? Math.round((ordenado.reduce((a, b) => a + b, 0) / ordenado.length) * 10) / 10
            : 0,
    }
    return resultado
}
