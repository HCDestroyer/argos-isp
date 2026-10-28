import { createHash, randomBytes, randomInt } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { verRouter } from '#network/consultas/routers'

/**
 * Lecturas de `network.routers_conexion` y utilidades de secretos. El token de registro, su hash y
 * la clave pendiente de la API nunca salen por la API.
 */

export const ESTADOS_CONEXION = ['sin_configurar', 'pendiente', 'conectado'] as const
export type EstadoConexion = (typeof ESTADOS_CONEXION)[number]

/** Un handshake más viejo que esto ya no cuenta como túnel activo (`handshake_reciente`). */
export const HANDSHAKE_RECIENTE_S = 180
/** Vigencia del token de registro (contrato §1). */
export const VIGENCIA_TOKEN_H = 24
export const USUARIO_API = 'argosisp-api'
export const GRUPO_API = 'argosisp-api'

export interface ConexionVista {
    router_id: number
    /** `sin_configurar`: nunca se generó un script */
    estado: EstadoConexion
    ip_tunel: string | null
    /** clave pública WireGuard del router (no es secreta) */
    public_key: string | null
    ultimo_handshake: string | null
    /** hubo handshake en los últimos `HANDSHAKE_RECIENTE_S` segundos */
    handshake_reciente: boolean
    registrado_en: string | null
    /** vencimiento del token del último script; null si ya se usó o nunca hubo */
    token_vence: string | null
    version: number
}

export interface FilaConexion {
    router_id: number
    ip_tunel: string
    public_key: string | null
    estado: 'pendiente' | 'conectado'
    ultimo_handshake: Date | null
    registrado_en: Date | null
    token_hash: string | null
    token_vence: Date | null
    token_usado_en: Date | null
    api_password_pendiente: string | null
    version: number
}

const COLUMNAS = [
    'router_id',
    db.raw('host(ip_tunel) AS ip_tunel'),
    'public_key',
    'estado',
    'ultimo_handshake',
    'registrado_en',
    'token_hash',
    'token_vence',
    'token_usado_en',
    'api_password_pendiente',
    'version',
]

export async function filaConexion(
    routerId: number,
    cliente: QueryClientContract = db.connection(),
    bloquear = false,
): Promise<FilaConexion | null> {
    const consulta = cliente.from('network.routers_conexion').where('router_id', routerId).select(COLUMNAS)
    if (bloquear) consulta.forUpdate()
    return ((await consulta.first()) ?? null) as FilaConexion | null
}

const iso = (valor: Date | null) => (valor ? new Date(valor).toISOString() : null)

export function vistaConexion(
    routerId: number,
    fila: FilaConexion | null,
    ahora = new Date(),
): ConexionVista {
    if (!fila) {
        return {
            router_id: routerId,
            estado: 'sin_configurar',
            ip_tunel: null,
            public_key: null,
            ultimo_handshake: null,
            handshake_reciente: false,
            registrado_en: null,
            token_vence: null,
            version: 0,
        }
    }
    const handshake = fila.ultimo_handshake ? new Date(fila.ultimo_handshake) : null
    const tokenVigente = fila.token_hash && !fila.token_usado_en && fila.token_vence
    return {
        router_id: routerId,
        estado: fila.estado,
        ip_tunel: fila.ip_tunel,
        public_key: fila.public_key,
        ultimo_handshake: iso(handshake),
        handshake_reciente:
            handshake !== null && ahora.getTime() - handshake.getTime() <= HANDSHAKE_RECIENTE_S * 1000,
        registrado_en: iso(fila.registrado_en),
        token_vence: tokenVigente ? iso(fila.token_vence) : null,
        version: fila.version,
    }
}

/** `GET /routers/:id/conexion`: 404 si el router no existe. */
export async function verConexion(
    routerId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<ConexionVista> {
    await verRouter(routerId, cliente)
    return vistaConexion(routerId, await filaConexion(routerId, cliente))
}

/** Lo auditable de la conexión (sin token ni clave pendiente). */
export function auditableConexion(fila: FilaConexion | null) {
    if (!fila) return null
    return {
        ip_tunel: fila.ip_tunel,
        public_key: fila.public_key,
        estado: fila.estado,
        registrado_en: iso(fila.registrado_en),
        token_vence: iso(fila.token_vence),
    }
}

export interface PeerWireguard {
    router_id: number
    public_key: string
    ip_tunel: string
}

/** Peers que el servicio `wireguard` aplica con `wg syncconf` (los routers con clave registrada). */
export async function listarPeers(cliente: QueryClientContract = db.connection()): Promise<PeerWireguard[]> {
    return (await cliente
        .from('network.routers_conexion')
        .whereNotNull('public_key')
        .orderBy('router_id')
        .select('router_id', 'public_key', db.raw('host(ip_tunel) AS ip_tunel'))) as PeerWireguard[]
}

export function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
}

/** Token de registro: 32 caracteres base64url (seguros dentro de un string de RouterOS). */
export function generarToken(): { valor: string; hash: string } {
    const valor = randomBytes(24).toString('base64url')
    return { valor, hash: hashToken(valor) }
}

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

/** Clave aleatoria de 32 caracteres alfanuméricos para el usuario `argosisp-api` (contrato §1). */
export function generarClaveApi(largo = 32): string {
    let clave = ''
    for (let i = 0; i < largo; i++) clave += ALFABETO[randomInt(ALFABETO.length)]
    return clave
}
