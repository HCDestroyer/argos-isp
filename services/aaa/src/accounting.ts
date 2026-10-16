import { isIP } from 'node:net'
import { Queue, type ConnectionOptions } from 'bullmq'
import type { AtributosPeticion } from './radius.ts'

/**
 * Accounting RADIUS → cola BullMQ `aaa-accounting` → worker de `apps/api` (`node ace sesiones:worker`),
 * que escribe `network.sesiones` y emite `sesion.iniciada` / `sesion.terminada`.
 *
 * `aaa` no escribe en Postgres: normaliza el paquete y lo encola. Si no puede encolar responde 503,
 * FreeRADIUS no contesta Accounting-Response y el NAS reintenta (no se pierde el paquete).
 * Contrato del job: `.claude/integration/contratos/accounting.md`.
 */

export const NOMBRE_COLA_ACCOUNTING = 'aaa-accounting'

export const TIPOS_ACCOUNTING = [
    'Start',
    'Interim-Update',
    'Stop',
    'Accounting-On',
    'Accounting-Off',
] as const
export type TipoAccounting = (typeof TIPOS_ACCOUNTING)[number]

/** Acct-Status-Type numérico (RFC 2866) por si rlm_rest no lo traduce a texto. */
const TIPOS_NUMERICOS: Record<string, TipoAccounting> = {
    '1': 'Start',
    '2': 'Stop',
    '3': 'Interim-Update',
    '7': 'Accounting-On',
    '8': 'Accounting-Off',
}

/** Datos del job (todo serializable a JSON). Bytes como texto: superan 2^53 con gigawords. */
export interface RegistroAccounting {
    tipo: TipoAccounting
    nas_ip: string
    /** vacío en Accounting-On/Off */
    acct_session_id: string
    /** vacío en Accounting-On/Off */
    user_ppp: string
    ipv4: string | null
    /** `Framed-IPv6-Prefix` que reporta el NAS (/64 de enlace) */
    prefijo_enlace_v6: string | null
    /** `Delegated-IPv6-Prefix` si el NAS lo reporta (RouterOS 7.24.5 no lo manda) */
    prefijo_delegado_v6: string | null
    /** octetos recibidos del cliente (Acct-Input-Octets + Gigawords · 2^32) */
    bytes_in: string
    /** octetos enviados al cliente (Acct-Output-Octets + Gigawords · 2^32) */
    bytes_out: string
    /** Acct-Session-Time en segundos */
    duracion_s: number | null
    /** Acct-Terminate-Cause (solo Stop) */
    causa_fin: string | null
    /** Instante del hecho (UTC, ISO 8601): Event-Timestamp o recepción − Acct-Delay-Time */
    evento_en: string
}

export class ErrorAccounting extends Error {}

function entero(valor: string | undefined): bigint {
    if (valor === undefined || !/^\d+$/.test(valor)) return 0n
    return BigInt(valor)
}

function octetos(atributos: AtributosPeticion, base: string, gigawords: string): string {
    return (entero(atributos.get(base)) + entero(atributos.get(gigawords)) * 4_294_967_296n).toString()
}

function ipv4(valor: string | undefined): string | null {
    return valor && isIP(valor) === 4 ? valor : null
}

function prefijoV6(valor: string | undefined): string | null {
    if (!valor) return null
    const [direccion, largo, ...resto] = valor.split('/')
    if (resto.length > 0 || !direccion || isIP(direccion) !== 6) return null
    const n = Number(largo)
    if (!Number.isInteger(n) || n < 1 || n > 128) return null
    return `${direccion}/${n}`
}

/** Event-Timestamp llega como texto de fecha ("Oct 15 2026 14:10:00 UTC") o como epoch. */
function instante(atributos: AtributosPeticion, ahora: Date): string {
    const ts = atributos.get('Event-Timestamp')
    if (ts) {
        const fecha = /^\d+$/.test(ts) ? new Date(Number(ts) * 1000) : new Date(ts)
        if (!Number.isNaN(fecha.getTime())) return fecha.toISOString()
    }
    const retraso = Number(atributos.get('Acct-Delay-Time') ?? 0)
    const ms = Number.isFinite(retraso) && retraso > 0 ? retraso * 1000 : 0
    return new Date(ahora.getTime() - ms).toISOString()
}

/**
 * Traduce los atributos de rlm_rest a un `RegistroAccounting`. Lanza `ErrorAccounting` si el paquete
 * no sirve (sin tipo conocido, sin NAS, o sin sesión/usuario en Start/Interim/Stop).
 */
export function normalizarAccounting(atributos: AtributosPeticion, ahora = new Date()): RegistroAccounting {
    const crudo = atributos.get('Acct-Status-Type') ?? ''
    const tipo = (TIPOS_ACCOUNTING as readonly string[]).includes(crudo)
        ? (crudo as TipoAccounting)
        : TIPOS_NUMERICOS[crudo]
    if (!tipo) throw new ErrorAccounting(`Acct-Status-Type no soportado: ${crudo || '(vacío)'}`)

    const nasIp = atributos.get('NAS-IP-Address') ?? atributos.get('NAS-IPv6-Address')
    if (!nasIp || isIP(nasIp) === 0) throw new ErrorAccounting('accounting sin NAS-IP-Address')

    const general = tipo === 'Accounting-On' || tipo === 'Accounting-Off'
    const sesion = atributos.get('Acct-Session-Id') ?? ''
    const usuario = atributos.get('User-Name') ?? ''
    if (!general && (!sesion || !usuario)) {
        throw new ErrorAccounting(`${tipo} sin Acct-Session-Id o User-Name`)
    }

    const duracion = Number(atributos.get('Acct-Session-Time'))
    return {
        tipo,
        nas_ip: nasIp,
        acct_session_id: general ? '' : sesion,
        user_ppp: general ? '' : usuario,
        ipv4: ipv4(atributos.get('Framed-IP-Address')),
        prefijo_enlace_v6: prefijoV6(atributos.get('Framed-IPv6-Prefix')),
        prefijo_delegado_v6: prefijoV6(atributos.get('Delegated-IPv6-Prefix')),
        bytes_in: octetos(atributos, 'Acct-Input-Octets', 'Acct-Input-Gigawords'),
        bytes_out: octetos(atributos, 'Acct-Output-Octets', 'Acct-Output-Gigawords'),
        duracion_s: Number.isFinite(duracion) && duracion >= 0 ? Math.floor(duracion) : null,
        causa_fin: tipo === 'Stop' ? (atributos.get('Acct-Terminate-Cause') ?? null) : null,
        evento_en: instante(atributos, ahora),
    }
}

/** Lo que `/aaa/accounting` necesita para encolar (BullMQ en producción, falso en pruebas). */
export interface ColaAccounting {
    encolar(registro: RegistroAccounting): Promise<void>
}

export interface OpcionesColaBullmq {
    conexion: ConnectionOptions
    /** Prefijo de BullMQ (`COLAS_PREFIJO`): el mismo que usa el worker de `apps/api`. */
    prefijo: string
    /** Intentos del worker si Postgres falla (backoff exponencial desde `esperaMs`). */
    intentos?: number
    esperaMs?: number
}

export class ColaAccountingBullmq implements ColaAccounting {
    readonly cola: Queue
    readonly #intentos: number
    readonly #esperaMs: number
    /**
     * Lote del tick actual. En una reconexión masiva llegan cientos de paquetes a la vez: en lugar
     * de un `add` (script Lua + escritura al socket) por paquete, los del mismo tick salen juntos
     * con `addBulk` (un pipeline). Cada paquete se responde solo cuando su job quedó en Redis.
     */
    #lote: Array<{ registro: RegistroAccounting; resolver: () => void; rechazar: (e: unknown) => void }> = []

    constructor(opciones: OpcionesColaBullmq) {
        this.cola = new Queue(NOMBRE_COLA_ACCOUNTING, {
            connection: opciones.conexion,
            prefix: opciones.prefijo,
        })
        // Sin Redis el error debe salir rápido (503 → el NAS reintenta), no quedarse esperando.
        this.cola.on('error', () => {})
        this.#intentos = opciones.intentos ?? 8
        this.#esperaMs = opciones.esperaMs ?? 1000
    }

    encolar(registro: RegistroAccounting): Promise<void> {
        return new Promise<void>((resolver, rechazar) => {
            if (this.#lote.length === 0) setImmediate(() => void this.#vaciar())
            this.#lote.push({ registro, resolver, rechazar })
        })
    }

    async #vaciar(): Promise<void> {
        const lote = this.#lote
        this.#lote = []
        const opts = {
            attempts: this.#intentos,
            backoff: { type: 'exponential' as const, delay: this.#esperaMs },
            removeOnComplete: { age: 3600, count: 10_000 },
            removeOnFail: { age: 7 * 24 * 3600 },
        }
        try {
            await this.cola.addBulk(
                lote.map(({ registro }) => ({ name: registro.tipo, data: registro, opts })),
            )
            for (const p of lote) p.resolver()
        } catch (e) {
            for (const p of lote) p.rechazar(e)
        }
    }

    async cerrar(): Promise<void> {
        await this.cola.close()
    }
}
