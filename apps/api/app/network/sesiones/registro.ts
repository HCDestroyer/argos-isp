import { isIP } from 'node:net'

/**
 * Job de la cola `aaa-accounting` tal como lo encola `services/aaa` (`src/accounting.ts`).
 * Contrato: `.claude/integration/contratos/accounting.md`. Se vuelve a validar aquí porque llega por
 * Redis: un job mal formado no debe romper el worker ni meter basura en `network.sesiones`.
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

export interface RegistroAccounting {
    tipo: TipoAccounting
    nas_ip: string
    acct_session_id: string
    user_ppp: string
    ipv4: string | null
    prefijo_enlace_v6: string | null
    prefijo_delegado_v6: string | null
    /** octetos como texto decimal (pueden superar 2^53) */
    bytes_in: string
    bytes_out: string
    duracion_s: number | null
    causa_fin: string | null
    /** ISO 8601 UTC */
    evento_en: string
}

export class RegistroInvalido extends Error {}

type Obj = Record<string, unknown>

function texto(o: Obj, campo: string, vacio = false): string {
    const v = o[campo]
    if (typeof v !== 'string' || (!vacio && v === '')) throw new RegistroInvalido(`${campo} inválido`)
    return v
}

function opcional(o: Obj, campo: string, valido: (v: string) => boolean): string | null {
    const v = o[campo]
    if (v === null || v === undefined) return null
    if (typeof v !== 'string' || !valido(v)) throw new RegistroInvalido(`${campo} inválido`)
    return v
}

function esPrefijoV6(v: string): boolean {
    const [direccion, largo, ...resto] = v.split('/')
    const n = Number(largo)
    return resto.length === 0 && isIP(direccion ?? '') === 6 && Number.isInteger(n) && n >= 1 && n <= 128
}

function octetos(o: Obj, campo: string): string {
    const v = o[campo]
    if (typeof v !== 'string' || !/^\d{1,19}$/.test(v)) throw new RegistroInvalido(`${campo} inválido`)
    // bigint de Postgres: máximo 2^63 − 1
    if (BigInt(v) > 9_223_372_036_854_775_807n) throw new RegistroInvalido(`${campo} fuera de rango`)
    return v
}

export function parsearRegistro(dato: unknown): RegistroAccounting {
    if (typeof dato !== 'object' || dato === null) throw new RegistroInvalido('job sin datos')
    const o = dato as Obj
    const tipo = texto(o, 'tipo')
    if (!(TIPOS_ACCOUNTING as readonly string[]).includes(tipo)) {
        throw new RegistroInvalido(`tipo desconocido: ${tipo}`)
    }
    const general = tipo === 'Accounting-On' || tipo === 'Accounting-Off'
    const nasIp = texto(o, 'nas_ip')
    if (isIP(nasIp) === 0) throw new RegistroInvalido('nas_ip inválida')
    const eventoEn = texto(o, 'evento_en')
    if (Number.isNaN(new Date(eventoEn).getTime())) throw new RegistroInvalido('evento_en inválido')
    const duracion = o.duracion_s
    if (
        duracion !== null &&
        duracion !== undefined &&
        (!Number.isInteger(duracion) || (duracion as number) < 0)
    ) {
        throw new RegistroInvalido('duracion_s inválida')
    }
    return {
        tipo: tipo as TipoAccounting,
        nas_ip: nasIp,
        acct_session_id: texto(o, 'acct_session_id', general),
        user_ppp: texto(o, 'user_ppp', general),
        ipv4: opcional(o, 'ipv4', (v) => isIP(v) === 4),
        prefijo_enlace_v6: opcional(o, 'prefijo_enlace_v6', esPrefijoV6),
        prefijo_delegado_v6: opcional(o, 'prefijo_delegado_v6', esPrefijoV6),
        bytes_in: octetos(o, 'bytes_in'),
        bytes_out: octetos(o, 'bytes_out'),
        duracion_s: (duracion as number | null | undefined) ?? null,
        causa_fin: opcional(o, 'causa_fin', (v) => v.length <= 64),
        evento_en: new Date(eventoEn).toISOString(),
    }
}
