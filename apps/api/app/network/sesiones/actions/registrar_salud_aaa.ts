import db from '@adonisjs/lucid/services/db'
import { DomainAction, type Transaccion } from '#shared/domain_action'

/**
 * Caída y recuperación de un nodo `aaa` (tarea 9 de A2). Las llama solo el vigía
 * (`node ace aaa:vigilar`, `app/network/sesiones/vigia_aaa.ts`); no son acciones de una persona y no
 * tienen permiso en el ACL (como las de accounting).
 *
 * Idempotentes por nodo: dentro de la transacción toman un advisory lock del nodo y miran el último
 * `aaa.caido` / `aaa.recuperado` de ese nodo en `audit.outbox`. Solo se emite `aaa.caido` si el
 * último no fue una caída, y `aaa.recuperado` solo si el último fue una caída. Así un vigía que se
 * reinicia, pierde su estado en Redis o corre dos veces no duplica la alerta de Telegram (A6).
 */

export interface EntradaCaida {
    nodo: string
    /** ISO 8601: primer health check fallido */
    desde: string
    ultimo_error: string | null
}

export interface EntradaRecuperacion {
    nodo: string
    /** ISO 8601: primer health check bueno */
    hasta: string
    /** último error visto antes de recuperarse; si falta, el de la caída */
    ultimo_error?: string | null
}

/** Último `aaa.caido` / `aaa.recuperado` de cada nodo (lectura sin lock, para el vigía). */
export async function estadoRegistrado(nodos: string[]): Promise<Map<string, 'caido' | 'arriba'>> {
    const estados = new Map<string, 'caido' | 'arriba'>(nodos.map((n) => [n, 'arriba']))
    if (nodos.length === 0) return estados
    const { rows } = (await db.rawQuery(
        `SELECT DISTINCT ON (payload->>'nodo') payload->>'nodo' AS nodo, evento
         FROM audit.outbox
         WHERE evento IN ('aaa.caido', 'aaa.recuperado') AND payload->>'nodo' = ANY(?)
         ORDER BY payload->>'nodo', id DESC`,
        [nodos],
    )) as { rows: Array<{ nodo: string; evento: string }> }
    for (const f of rows) estados.set(f.nodo, f.evento === 'aaa.caido' ? 'caido' : 'arriba')
    return estados
}

export interface SalidaSalud {
    nodo: string
    emitido: boolean
}

interface UltimoEvento {
    evento: 'aaa.caido' | 'aaa.recuperado'
    payload: { desde?: string; ultimo_error?: string | null }
}

async function ultimoEvento(t: Transaccion, nodo: string): Promise<UltimoEvento | null> {
    await t.trx.rawQuery(`SELECT pg_advisory_xact_lock(hashtext(?))`, [`aaa-salud:${nodo}`])
    const fila = (await t.trx
        .from('audit.outbox')
        .whereIn('evento', ['aaa.caido', 'aaa.recuperado'])
        .whereRaw(`payload->>'nodo' = ?`, [nodo])
        .orderBy('id', 'desc')
        .select('evento', 'payload')
        .first()) as UltimoEvento | null
    return fila ?? null
}

export class RegistrarCaidaAaa extends DomainAction<EntradaCaida, SalidaSalud> {
    readonly nombre = 'aaa.registrar_caida'

    protected async handle(input: EntradaCaida, t: Transaccion): Promise<SalidaSalud> {
        const ultimo = await ultimoEvento(t, input.nodo)
        if (ultimo?.evento === 'aaa.caido') {
            return { nodo: input.nodo, emitido: false }
        }
        await t.emit('aaa.caido', {
            nodo: input.nodo,
            desde: input.desde,
            ultimo_error: input.ultimo_error,
        })
        return { nodo: input.nodo, emitido: true }
    }
}

export class RegistrarRecuperacionAaa extends DomainAction<EntradaRecuperacion, SalidaSalud> {
    readonly nombre = 'aaa.registrar_recuperacion'

    protected async handle(input: EntradaRecuperacion, t: Transaccion): Promise<SalidaSalud> {
        const caida = await ultimoEvento(t, input.nodo)
        if (caida?.evento !== 'aaa.caido') return { nodo: input.nodo, emitido: false }
        await t.emit('aaa.recuperado', {
            nodo: input.nodo,
            // `desde` de la caída registrada: no depende del estado del vigía en Redis
            desde: caida.payload.desde ?? input.hasta,
            hasta: input.hasta,
            ultimo_error: input.ultimo_error ?? caida.payload.ultimo_error ?? null,
        })
        return { nodo: input.nodo, emitido: true }
    }
}
